// The phone link: where it listens, then pairing, the person's yes, grants, approvals and removal through the real
// daemon, with @byokit/link's own device side as the phone. The Noise handshake and frames are the package's, tested there.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer as http1, request as http1Request } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { DeviceLink, pairWithOffer, type DeviceGrant, type LinkStatus } from '@byokit/link';
import { Link, NEWS, linkHosts, phoneAddresses, tailscalePeer } from '../src/link.ts';
import { Store } from '../src/db.ts';
import { decodeTyped, encodeTyped } from '../src/typed-code.ts';
import { b64url } from '@byokit/link';

test('typed envelope carries addresses, port, key and one-use secret; errors are plain', () => {
  const o = { v: 1 as const, host: b64url(new Uint8Array(32).fill(3)), ticket: b64url(new Uint8Array(16).fill(7)),
    name: 'your computer', role: 'control' as const, expires: Date.now() + 120_000,
    urls: ['ws://192.168.1.2:9443/link', 'ws://100.101.2.3:9443/link'] };
  const code = encodeTyped(o);
  assert.deepEqual({ ...decodeTyped(code), name: o.name }, { ...o, expires: Math.floor(o.expires / 1000) * 1000 });
  assert.throws(() => decodeTyped(code.replace(/[23456789ABCDEFGHJKMNPQRSTUVWXYZ]/, 'Z')), /match/);
  assert.throws(() => decodeTyped(code, o.expires + 1000), /run out/);
});

test('the link binds loopback and Tailscale by default; the home network only when turned on', () => {
  const at = (address: string, internal = false) => [{ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null }] as any;
  const ifaces = { lo: at('127.0.0.1', true), wlan0: at('192.168.1.20'), tailscale0: at('100.101.2.3'), docker0: at('172.17.0.1') };
  assert.deepEqual(linkHosts('', false, ifaces), ['127.0.0.1', '100.101.2.3']);
  assert.deepEqual(linkHosts('', true, ifaces), ['0.0.0.0']);
  assert.deepEqual(linkHosts('10.0.0.5, 127.0.0.1', true, ifaces), ['10.0.0.5', '127.0.0.1'], 'CREWHOUSE_LINK_HOST pins the addresses');
  assert.deepEqual(phoneAddresses(['127.0.0.1', '100.101.2.3'], ifaces), ['100.101.2.3'], 'the QR offers loopback only when there is nothing else');
  assert.deepEqual(phoneAddresses(['127.0.0.1'], ifaces), ['127.0.0.1']);
  assert.deepEqual(phoneAddresses(['0.0.0.0'], ifaces), ['192.168.1.20', '100.101.2.3'], 'home network first; container bridges skipped');
  assert.deepEqual(linkHosts('', false, { lo: at('127.0.0.1', true), eth0: at('192.168.1.20') }), ['127.0.0.1'], 'no Tailscale: loopback only');
});

test('paired phone dispatch preserves its member for the shared page API', async () => {
  const db = new Store(temp('crewhouse-phone-member'));
  const calls: number[] = [];
  const link = new Link({} as any, db, async (_method, _path, _body, member) => { calls.push(member); return { member }; }) as any;
  const reply = await link.request('GET /api/bots/scout', {}, { id: 'guest-phone', role: 'control', meta: { member: 2 } });
  assert.deepEqual(reply, { status: 200, body: { member: 2 } });
  assert.deepEqual(calls, [2]);
  db.close();
});

test('quiet hours hold the push and send exactly one when they end, even across a restart', () => {
  const dir = temp('crewhouse-held');
  const sent: { id: string; to: string[] }[] = [];
  let quiet = true;
  const link = (db: Store) => Object.assign(new Link({} as any, db, async () => null) as any, {
    client: { notify: async (n: any) => { sent.push(n); return {}; } }, relayStatus: 'online', quiet: (m: number) => m === 1 && quiet,
    host: { devices: () => [{ id: 'pixel', meta: { member: 1 } }, { id: 'ipad', meta: { member: 2 } }] },
  });
  let db = new Store(dir);
  const a = link(db);
  // 2 am: a failed job, then a not-sure one, for member 1 in their quiet hours; member 2 is awake.
  a.news({ seq: 1, kind: 'alert', data: { member: 1 }, bot: null });
  a.news({ seq: 2, kind: 'alert', data: { member: 1 }, bot: null });
  a.sendHeld();
  assert.equal(sent.length, 0, 'nothing reaches the phone in quiet hours');
  a.news({ seq: 3, kind: 'alert', data: { member: 2 }, bot: null });
  assert.deepEqual(sent.map((n) => n.to), [['ipad']], 'someone awake is told at once');

  // crewd restarts overnight; the hold is in the store.
  db.close();
  db = new Store(dir);
  const b = link(db);
  quiet = false;
  b.sendHeld();
  b.sendHeld();
  assert.deepEqual(sent.map((n) => n.to), [['ipad'], ['pixel']], 'one push when quiet hours end, for however much came in');
  db.close();
});

test('push through a stubbed Expo: exactly one content-free push per paired phone, and a missing credential said once', async () => {
  const got: any[][] = [];
  let answer = (msgs: any[]) => msgs.map(() => ({ status: 'ok' }));
  const expo = http1((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { got.push(JSON.parse(b)); res.end(JSON.stringify({ data: answer(got.at(-1)!) })); }); });
  await new Promise<void>((r) => expo.listen(0, '127.0.0.1', r));
  after(() => expo.close());
  const db = new Store(temp('crewhouse-push'));
  const devices = [{ id: 'pixel', meta: { member: 1 } }, { id: 'moto', meta: { member: 1 } }, { id: 'ipad', meta: { member: 2 } }];
  const link = Object.assign(new Link({} as any, db, async () => null) as any, { host: { devices: () => devices }, pushUrl: `http://127.0.0.1:${(expo.address() as AddressInfo).port}/push` });
  const phone = (id: string, body: unknown) => link.request('POST /api/push', body, { id, meta: devices.find((d) => d.id === id)!.meta });
  assert.equal((await phone('pixel', { expo: 'ExponentPushToken[pixel-1]' })).status, 200);
  assert.equal((await phone('moto', { expo: 'ExponentPushToken[moto-1]' })).status, 200);
  assert.equal((await phone('ipad', { expo: 'not a token' })).status, 409, 'only an Expo token, or saying why there is none');
  assert.equal(link.status().push, 'ready');

  // A job fails for member 1: each of their phones gets "Crewhouse has news" and nothing else; member 2's gets nothing.
  link.news({ seq: 7, kind: 'alert', data: { member: 1, words: 'Reel could not pay the dentist' }, bot: null });
  for (const end = Date.now() + 5000; !got.length && Date.now() < end;) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, [[
    { to: 'ExponentPushToken[pixel-1]', title: NEWS, sound: 'default', collapseId: 'e7' },
    { to: 'ExponentPushToken[moto-1]', title: NEWS, sound: 'default', collapseId: 'e7' },
  ]]);

  // Expo has no Android credential for the app yet: Settings says so, once, rather than pushes vanishing.
  answer = (msgs) => msgs.map(() => ({ status: 'error', details: { error: 'InvalidCredentials' } }));
  await link.tell(1, 'e8');
  assert.equal(link.status().push, 'missing');
  answer = (msgs) => msgs.map((_m, i) => (i ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }));
  await link.tell(1, 'e9');
  assert.equal(link.status().push, 'ready', 'a push that goes through clears it');
  await link.tell(1, 'e10');
  assert.deepEqual(got.at(-1)!.map((m: any) => m.to), ['ExponentPushToken[pixel-1]'], 'a phone Expo no longer knows is dropped');

  // The app build itself has no push credential: the phone says so, and Settings shows it; said no to notifications is per phone.
  await phone('ipad', { missing: true });
  assert.equal(link.status().push, 'missing');
  await phone('ipad', { off: true });
  assert.equal(link.status().push, 'ready');
  db.close();
});

test('the computer tells a phone whether its Tailscale has that phone as a peer', async () => {
  const dir = temp('crewhouse-peer');
  const cli = (name: string, out: string) => { const bin = join(dir, name); writeFileSync(bin, `#!/bin/sh\ncat <<'X'\n${out}\nX\n`, { mode: 0o755 }); return bin; };
  const ts = cli('ts', JSON.stringify({ Self: { TailscaleIPs: ['100.101.2.3'] }, Peer: { k1: { TailscaleIPs: ['100.90.1.1'] } } }));
  assert.equal(await tailscalePeer('100.90.1.1', ts), true, 'shared with this phone\'s account');
  assert.equal(await tailscalePeer('100.90.9.9', ts), false, 'not shared: the computer never sees it');
  assert.equal(await tailscalePeer('100.90.1.1', cli('broken', 'no')), undefined, 'no Tailscale here to ask');
});

test('a paired phone renews the Add-a-phone code it is looking at; the rest of phone admin stays on the computer', async () => {
  const db = new Store(temp('crewhouse-renew'));
  const seen: string[] = [];
  const link = new Link({} as any, db, async (m: string, path: string) => { seen.push(`${m} ${path}`); return { message: 7, token: 'fresh' }; });
  const owner = { id: 'pixel', meta: { member: 1 } };
  const renew = (g: { id: string; meta: { member: number } }, op: string) => (link as any).request(op, { message: 7 }, g);
  assert.deepEqual(await renew(owner, 'POST /api/phones/refresh'), { status: 200, body: { message: 7, token: 'fresh' } }, "the owner's phone asks for its own fresh code");
  assert.deepEqual(seen, ['POST /api/phones/refresh'], 'the ask reaches crewd, which answers only the owner');
  assert.equal((await renew(owner, 'POST /api/phones/pair')).status, 403, 'minting a first code stays on the computer');
  assert.equal((await renew(owner, 'DELETE /api/phones/pixel')).status, 403, 'removing a phone stays on the computer');
  assert.equal((await renew({ id: 'ipad', meta: { member: 2 } }, 'POST /api/phones/refresh')).status, 403, 'another member administers nothing');
  db.close();
});

const root = temp('crewhouse-link');
// Ports the OS says are free, not random guesses that another run may hold.
const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const port = await free();
const linkPort = await free();
const base = `http://127.0.0.1:${port}`;
const daemon = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
  env: { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PAIR_MS: '3000', CREWHOUSE_HOLD_MS: '5000', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: String(linkPort),
    CREWHOUSE_LINK_HOST: '127.0.0.1', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
after(() => daemon.kill());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = { 'x-crewhouse': '1' }) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 10_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = await fn(); if (v) return v; }
  throw new Error('timed out');
}

/** A phone scans the QR; the person at the computer checks the two words and answers. */
async function pairPhone(qr: string, name: string, yes = true) {
  let words = '';
  const paired = pairWithOffer(qr, { name, onWords: (w) => { words = w; } });
  const asking = await until(async () => (await http('GET', '/api/phones/link')).body.asking.find((a: any) => a.name === name));
  assert.equal(asking.words, words, 'the computer shows the same two words as the phone');
  assert.match(words, /^[a-z]+ [a-z]+$/);
  await http('POST', '/api/phones/answer', { id: asking.id, yes });
  return paired;
}

/** A paired phone's live link, answered like HTTP (as the app's transport reads it). */
function open(grant: DeviceGrant) {
  const events: any[] = [];
  let status: LinkStatus = 'connecting';
  const link = new DeviceLink(grant, { onEvent: (e) => events.push(e), onStatus: (s) => { status = s; } });
  const req = async (method: string, path: string, body?: unknown) => {
    try { return await link.request(`${method} ${path}`, body) as { status: number; body: any }; }
    catch (e: any) { return { status: e.code === 'view-only' ? 403 : 0, body: { error: e.code } }; }
  };
  return { link, req, events, status: () => status };
}

test('pairing with a yes at the computer, grants, approvals from the phone, and removal', async () => {
  await until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
  assert.equal(statSync(join(root, 'state', 'link.key')).mode & 0o777, 0o600, 'the link key is private to the owner');
  assert.deepEqual((await http('GET', '/api/phones')).body, [], 'docs/ui-contract.md: a list');

  // Only this computer can widen the link, show a code or answer a phone.
  assert.equal((await http('PUT', '/api/phones/lan', { on: true }, {})).status, 403);
  assert.equal((await http('POST', '/api/phones/pair', { role: 'control' }, {})).status, 403);
  assert.equal((await http('POST', '/api/phones/answer', { id: 1, yes: true }, {})).status, 403);

  // A no at the computer stores nothing, and the phone is told.
  const first = (await http('POST', '/api/phones/pair', { role: 'control' })).body;
  assert.deepEqual(first.urls, [`ws://127.0.0.1:${linkPort}/link`]);
  await assert.rejects(pairPhone(first.qr, 'Stranger', false), /said no/);
  assert.deepEqual((await http('GET', '/api/phones')).body, []);

  const grant = await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Pixel');
  assert.equal(grant.device.role, 'control');
  const late = (await http('POST', '/api/phones/pair', { role: 'control' })).body.qr;
  await sleep(3200);
  await assert.rejects(pairWithOffer(late, { name: 'Late', onWords: () => {} }), /run out/, 'codes expire');

  // The grant is durable: the phone connects with its key alone, as the member whose screen showed the code.
  const a = open(grant);
  const state = await a.req('GET', '/api/state');
  assert.equal(state.status, 200);
  assert.ok(state.body.bots.some((x: any) => x.id === 'chief'));
  assert.equal((await a.req('POST', '/api/phones/pair', { role: 'control' })).status, 403, 'a phone cannot show pairing codes');
  assert.equal((await a.req('GET', '/api/phones')).status, 403, 'or list phones');
  assert.equal((await a.req('GET', '/api/accounts')).status, 403, 'AI account sign-ins stay on the computer');
  assert.equal((await a.req('POST', '/api/people', { name: 'Mallory' })).status, 403, 'and so does adding people');
  assert.equal((await a.req('POST', '/api/connections/notion')).status, 403, 'and connecting apps');
  assert.equal((await a.req('PUT', '/api/house/google', { id: 'x', secret: 'y' })).status, 403, 'and the house Google app');
  assert.equal((await a.req('GET', '/api/people')).status, 200);
  assert.equal((await a.req('GET', '/files/chief/x')).status, 404);
  // The phone says which route it came by; Settings shows when each phone last reached the computer, and how.
  assert.deepEqual(Object.keys((await a.req('GET', '/api/reach', { via: 'home' })).body.reached), ['home']);
  await a.req('GET', '/api/reach', { via: 'anything' });
  assert.deepEqual(Object.keys((await http('GET', '/api/phones')).body[0].reached), ['home'], 'only a route it knows');

  // Live events arrive over the link.
  await a.req('POST', '/api/onboard', { address: 'Sir' });
  await until(async () => a.events.find((e) => e.kind === 'person.onboarded'));

  await http('POST', '/api/bots/chief/messages', { text: 'pair my phone' });
  const card = (await http('GET', '/api/bots/chief')).body.phoneOffer;
  assert.ok(card.token && card.qr);
  const pairing = pairWithOffer(card.qr, { name: 'Inline phone', onWords: () => {} });
  const waiting = await until(async () => (await http('GET', '/api/bots/chief')).body.phoneOffer.waiting);
  assert.equal(waiting.name, 'Inline phone');
  assert.equal((await http('POST', '/api/phones/answer', { id: waiting.id, yes: true, offer: 'wrong' })).status, 403);
  assert.equal((await a.req('POST', '/api/phones/answer', { id: waiting.id, yes: true, offer: card.token })).status, 403, 'phone cannot approve itself');
  const sam = (await http('POST', '/api/people', { name: 'Sam' })).body;
  assert.equal((await http('POST', '/api/phones/answer', { id: waiting.id, yes: true, offer: card.token }, { 'x-crewhouse': '1', 'x-crewhouse-member': String(sam.id) })).status, 403);
  assert.equal((await http('POST', '/api/phones/answer', { id: waiting.id, yes: true, offer: card.token })).status, 200);
  await pairing;
  await until(async () => (await http('GET', '/api/bots/chief')).body.phoneOffer.joined === 'Inline phone');
  const refreshed = (await http('POST', '/api/phones/refresh', { message: card.message })).body;
  assert.notEqual(refreshed.token, card.token, 'a card whose phone already joined is done: it does not refresh');
  const inline = (await http('GET', '/api/phones')).body.find((p: any) => p.name === 'Inline phone');
  await http('DELETE', `/api/phones/${inline.id}`);

  // An approval answered from the phone: the gate holds the bot's write until the phone says yes.
  await http('POST', '/api/recruit', { template: 'reel', name: 'Reel' });
  const outside = join(root, 'Documents', 'from-phone.txt');
  const job = (await a.req('POST', '/api/bots/reel/messages', { text: `save it [tool crew_write ${JSON.stringify({ path: outside, content: 'from the phone' })}]` })).body.task;
  const ask = await until(async () => (await a.req('GET', '/api/state')).body.asks.find((x: any) => x.kind === 'permission'));
  assert.match(ask.title, /Reel wants to change a file/);
  assert.equal((await a.req('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow' })).status, 200);
  await until(async () => (await http('GET', '/api/bots/reel')).body.tasks.find((x: any) => x.id === job && x.state === 'done'));
  assert.equal(readFileSync(outside, 'utf8'), 'from the phone');

  // Another member cannot mint a code; the owner's view-only tablet can watch but not answer.
  assert.equal((await http('POST', '/api/phones/pair', { role: 'view' }, { 'x-crewhouse': '1', 'x-crewhouse-member': String(sam.id) })).status, 403);
  assert.equal((await http('POST', '/api/phones/code', { role: 'view' }, { 'x-crewhouse': '1', 'x-crewhouse-member': String(sam.id) })).status, 403);
  const offer = (await http('POST', '/api/phones/pair', { role: 'view' })).body;
  const watcher = open(await pairPhone(offer.qr, 'Tablet'));
  assert.equal(watcher.link.grant.device.role, 'view');
  assert.equal((await watcher.req('GET', '/api/state')).body.person.id, 1);
  assert.equal((await watcher.req('POST', '/api/bots/chief/messages', { text: 'hi' })).status, 403);

  // The owner's paired phone renews a code that is showing, so its card refreshes itself (docs/ui-contract.md).
  await http('POST', '/api/bots/chief/messages', { text: 'pair my phone' });
  const live = (await http('GET', '/api/bots/chief')).body.phoneOffer;
  const fromPhone = await a.req('POST', '/api/phones/refresh', { message: live.message });
  assert.equal(fromPhone.status, 200);
  assert.ok(fromPhone.body.token && fromPhone.body.token !== live.token, 'a fresh code, minted at the phone\'s ask');

  // Settings lists both; removing one closes its link, the phone forgets its grant, and its key is refused.
  const phones = (await http('GET', '/api/phones')).body;
  assert.deepEqual(phones.map((d: any) => [d.name, d.role, d.member, d.online]), [['Pixel', 'control', 1, true], ['Tablet', 'view', 1, true]]);
  assert.equal((await http('DELETE', `/api/phones/${phones[0].id}`)).status, 200);
  await until(async () => a.status() === 'removed');
  const again = open(grant);
  await until(async () => again.status() === 'removed', 15_000);
  assert.equal((await watcher.req('GET', '/api/state')).status, 200, 'other phones are untouched');
  watcher.link.stop();
});

test('a direct typed code and exact local CLI words pair once', async () => {
  await until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
  const cli = (...args: string[]) => execFileSync(join(import.meta.dirname, '..', 'crewhouse'), ['phones', ...args],
    { encoding: 'utf8', env: { ...process.env, CREWHOUSE_PORT: String(port) } });
  const offer = (await http('POST', '/api/phones/pair', { role: 'control' })).body;
  const typed = decodeTyped(offer.typed);
  assert.deepEqual(typed.urls, offer.urls);
  const qr = `byokit-link:1:${b64url(new TextEncoder().encode(JSON.stringify(typed)))}`;
  let words = '';
  const pairing = pairWithOffer(qr, { name: 'Typed phone', onWords: (w) => { words = w; } });
  await until(async () => (await http('GET', '/api/phones/pending')).body.find((a: any) => a.name === 'Typed phone'));
  assert.match(cli('pending'), /Typed phone/);
  assert.throws(() => cli('approve', 'wrong words'), /Command failed/);
  assert.equal((await http('GET', '/api/phones/pending')).body.length, 1);
  assert.match(cli('approve', words), /approved/);
  const grant = await pairing;
  assert.equal(grant.device.role, 'control');
  await assert.rejects(pairWithOffer(qr, { name: 'Again', onWords: () => {} }), /code|used|match|run out/i);
  assert.equal((await http('POST', '/api/phones/approve', { words }, {})).status, 403);
  const lan = await new Promise<number>((resolve, reject) => {
    const req = http1Request({ hostname: '127.0.0.1', port, path: '/api/phones/approve', method: 'POST',
      headers: { host: '192.168.1.2:7711', 'x-crewhouse': '1', 'content-type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject); req.end(JSON.stringify({ words }));
  });
  assert.equal(lan, 403, 'a LAN-addressed request cannot approve');
  assert.match(cli('code'), /Works once; expires/);
});

test('the relay address: none built in, the family can set their own, and phones cannot', async () => {
  await until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
  const relay = async (url?: unknown, headers?: Record<string, string>) => (await http('PUT', '/api/phones/relay', { url }, headers));
  assert.equal((await http('GET', '/api/phones/link')).body.relay, '', 'no relay unless the family sets one');
  assert.equal((await relay('https://relay.example/ignored/path')).body.relay, 'https://relay.example', 'kept as an origin');
  assert.equal((await relay('ftp://nope')).status, 400);
  assert.equal((await relay('wss://elsewhere.example', {})).status, 403, 'only this computer changes it');
  assert.deepEqual((await relay(null)).body.relay, '', 'back to the default');
});

test('a bot\'s screen over the link: a watch-only phone may open it, and crewd answers as on the computer\'s own socket', async () => {
  await until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
  const grant = await pairPhone((await http('POST', '/api/phones/pair', { role: 'view' })).body.qr, 'Watcher');
  const w = open(grant);
  await until(async () => w.status() === 'online');
  const s = await w.link.stream('desktop', { bot: 'chief' });
  const lines: any[] = [];
  let buf = '';
  s.onData = (c) => { buf += new TextDecoder().decode(c); for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) lines.push(JSON.parse(buf.slice(0, i))); };
  await s.write(JSON.stringify({ id: 1, method: 'session.open', params: { permissions: ['view'] } }) + '\n');
  const reply = await until(async () => lines.find((l) => l.id === 1));
  assert.equal(reply.error.code, 'no-screen', 'Chief has no computer; said as the computer\'s socket says it');
  s.end();
  // Watching isn't hiring: a watch-only phone can't add a helper; a phone that can answer adds one from the gallery.
  assert.equal((await w.req('POST', '/api/recruit', { template: 'scribe', name: 'Quill' })).status, 403);
  const c = open(await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Helper-adder'));
  const added = await c.req('POST', '/api/recruit', { template: 'scribe', name: 'Quill' });
  assert.deepEqual([added.status, added.body.id], [200, 'quill']);
  c.link.stop();
  // A stream for anything else, or a bot name that isn't one, is turned away.
  const bad = await w.link.stream('desktop', { bot: '../x' });
  const ended = await new Promise<string | undefined>((r) => { bad.onEnd = r; });
  assert.equal(ended, 'not-supported');
  w.link.stop();
});

test('the owner picks whose phone it is: the grant acts as that member alone, and nobody else can pick', async () => {
  await until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
  // Three people in the house: the owner, Nadia and Zara.
  const nadia = (await http('POST', '/api/people', { name: 'Nadia' })).body.id;
  const zara = (await http('POST', '/api/people', { name: 'Zara' })).body.id;
  const as = (id: number) => ({ 'x-crewhouse': '1', 'x-crewhouse-member': String(id) });

  // Only the owner mints a code, for anyone; the person has to exist.
  for (const member of [nadia, zara, 1, undefined]) {
    assert.equal((await http('POST', '/api/phones/pair', { role: 'control', member }, as(nadia))).status, 403, `Nadia cannot pair a phone for ${member}`);
    assert.equal((await http('POST', '/api/phones/code', { role: 'control', member }, as(zara))).status, 403, `Zara cannot type one for ${member}`);
  }
  assert.equal((await http('POST', '/api/phones/pair', { role: 'control', member: 999 })).status, 404, 'nobody by that number');
  assert.equal((await http('POST', '/api/phones/pair', { role: 'control', member: 'Nadia' })).status, 404, 'a name is not a person id');

  // The owner pairs Nadia's phone and their own; the computer's question says whose it will be.
  let words = '';
  const pairing = pairWithOffer((await http('POST', '/api/phones/pair', { role: 'control', member: nadia })).body.qr, { name: 'Nadia phone', onWords: (w) => { words = w; } });
  const asking = await until(async () => (await http('GET', '/api/phones/link')).body.asking.find((a: any) => a.name === 'Nadia phone'));
  assert.equal(asking.member, nadia);
  assert.equal(asking.words, words);
  assert.equal((await http('POST', '/api/phones/answer', { id: asking.id, yes: true }, as(nadia))).status, 403, 'Nadia cannot approve her own phone');
  await http('POST', '/api/phones/answer', { id: asking.id, yes: true });
  const n = open(await pairing);
  const o = open(await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Owner phone'));
  const listed = (await http('GET', '/api/phones')).body;
  assert.deepEqual([listed.find((p: any) => p.name === 'Nadia phone')].map((p) => [p.member, p.person]), [[nadia, 'Nadia']]);
  assert.equal(listed.find((p: any) => p.name === 'Owner phone').member, 1, 'no choice means the owner');

  // Nadia's phone acts as Nadia: her state, her thread, her events; never the owner's or Zara's.
  assert.equal((await n.req('GET', '/api/state')).body.person.id, nadia);
  assert.equal((await o.req('GET', '/api/state')).body.person.id, 1);
  await http('POST', '/api/bots/chief/messages', { text: 'owner private words' });
  await http('POST', '/api/bots/chief/messages', { text: 'zara private words' }, as(zara));
  assert.equal((await n.req('POST', '/api/bots/chief/messages', { text: 'nadia own words' })).status, 200);
  const said = (e: any, text: string) => e.kind === 'message' && e.data.text === text;
  await until(async () => o.events.find((e) => said(e, 'owner private words')));
  await until(async () => n.events.find((e) => said(e, 'nadia own words')));
  await until(async () => (await http('GET', '/api/bots/chief', undefined, as(zara))).body.messages.some((m: any) => m.text === 'zara private words'));
  assert.ok(!n.events.some((e) => said(e, 'owner private words') || said(e, 'zara private words')), "the owner's and Zara's words never reach Nadia's phone");
  assert.ok(!o.events.some((e) => said(e, 'nadia own words') || said(e, 'zara private words')), "and Nadia's and Zara's never reach the owner's");
  const thread = (await n.req('GET', '/api/bots/chief')).body.messages.map((m: any) => m.text);
  assert.ok(thread.includes('nadia own words') && !thread.some((t: string) => /owner private|zara private/.test(t)), 'her Chief thread is hers alone');
  assert.equal((await n.req('GET', '/api/bots/chief')).body.phoneOffer, null, 'no pairing card for a member');
  assert.ok((await n.req('GET', '/api/events')).body.every((e: any) => !said(e, 'owner private words') && !said(e, 'zara private words')));

  // Chief's card: the owner switches it to Zara, and the phone that joins through it is Zara's. Nadia's phone cannot switch it.
  await http('POST', '/api/bots/chief/messages', { text: 'pair my phone' });
  const card = await until(async () => (await http('GET', '/api/bots/chief')).body.phoneOffer);
  assert.equal(card.member ?? 1, 1, 'the card starts as the owner\'s');
  assert.equal((await n.req('POST', '/api/phones/refresh', { message: card.message, member: nadia })).status, 403, "a member's phone administers nothing");
  assert.equal((await http('POST', '/api/phones/refresh', { message: card.message, member: zara }, as(zara))).status, 403);
  assert.equal((await http('POST', '/api/phones/refresh', { message: card.message, member: 999 })).status, 404);
  const forZara = (await http('POST', '/api/phones/refresh', { message: card.message, member: zara })).body;
  assert.equal(forZara.member, zara);
  assert.equal((await o.req('POST', '/api/phones/refresh', { message: card.message })).body.member, zara, "a renewal keeps the card's person");
  const shown = (await http('GET', '/api/bots/chief')).body.phoneOffer;
  const zaraPairing = pairWithOffer(shown.qr, { name: 'Zara phone', onWords: () => {} });
  const waiting = await until(async () => (await http('GET', '/api/bots/chief')).body.phoneOffer.waiting);
  assert.equal((await http('POST', '/api/phones/answer', { id: waiting.id, yes: true, offer: shown.token }, as(zara))).status, 403);
  assert.equal((await http('POST', '/api/phones/answer', { id: waiting.id, yes: true, offer: shown.token })).status, 200);
  const z = open(await zaraPairing);
  assert.equal((await z.req('GET', '/api/state')).body.person.id, zara);
  assert.equal((await http('GET', '/api/phones')).body.find((p: any) => p.name === 'Zara phone').member, zara);
  assert.ok(!(await z.req('GET', '/api/bots/chief')).body.messages.some((m: any) => /owner private|nadia own/.test(m.text)));

  for (const p of (await http('GET', '/api/phones')).body) await http('DELETE', `/api/phones/${p.id}`);
  for (const x of [n, o, z]) x.link.stop();
});
