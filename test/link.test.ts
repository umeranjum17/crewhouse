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
import { DeviceLink, pairWithOffer, type DeviceGrant, type LinkStatus, encodeOffer, offerText, parseOffer } from '@byokit/link';
import { Link, NEWS, linkHosts, phoneAddresses, tailscalePeer } from '../src/link.ts';
import { Store } from '../src/db.ts';
import { DatabaseSync } from 'node:sqlite';
import * as A from '../web/src/adapter.ts';
import { decodeOffer as decodeTyped, encodeOffer as encodeTyped } from '@byokit/link';
import { b64url } from '@byokit/link';

test('typed envelope carries addresses, port, key and one-use secret; errors are plain', () => {
  const o = { v: 1 as const, host: b64url(new Uint8Array(32).fill(3)), ticket: b64url(new Uint8Array(16).fill(7)),
    name: 'your computer', role: 'control' as const, expires: Date.now() + 120_000,
    urls: ['ws://192.168.1.2:9443/link', 'ws://100.101.2.3:9443/link'] };
  const code = encodeTyped(o);
  assert.deepEqual({ ...decodeTyped(code), name: o.name }, o);
  assert.equal(code, encodeOffer(o));
  assert.deepEqual(parseOffer(offerText(decodeTyped(code))), o);
  assert.throws(() => decodeTyped(code.replace(/^./, 'Z')), /match/);
  assert.throws(() => decodeTyped(code, o.expires + 1000), /run out/);
});

test('pre-kit compact codes remain readable without changing their pinned key or ticket', () => {
  const old = '262J8-2T52E-3J82T-52E3J-82T52-E3J82-T52E3-J82T5-2E3J8-2T52E-3J82T-92X5J-G3T92-X5JG3-T92X5-JG3T9-HPQSC-22425-2CJ2A-46NKJ-2U572-A3MBT-V98C5-JZ';
  assert.deepEqual(decodeTyped(old, 0), { v: 1, name: 'your computer', role: 'control', expires: 2100000000000,
    host: b64url(new Uint8Array(32).fill(3)), ticket: b64url(new Uint8Array(16).fill(7)),
    urls: ['ws://192.168.1.2:9443/link', 'ws://100.101.2.3:9443/link'] });
  assert.throws(() => decodeTyped(old, 2100000000001), /run out/);
  assert.throws(() => decodeTyped(old.slice(0, -1) + '2', 0), /match/);
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
  const unnamed = { en0: at('192.168.1.20'), utun3: at('100.101.2.3'), wt0: at('100.90.1.2') };
  assert.deepEqual(linkHosts('', false, unnamed, ['100.101.2.3']), ['127.0.0.1', '100.101.2.3'], 'CLI evidence identifies unnamed Tailscale; another overlay stays closed');
  assert.deepEqual(linkHosts('', false, unnamed), ['127.0.0.1'], 'CGNAT alone is not Tailscale evidence');
  assert.deepEqual(phoneAddresses(['0.0.0.0'], unnamed, ['100.101.2.3']), ['192.168.1.20', '100.101.2.3']);
});

test('quiet hours hold the push and send exactly one when they end, even across a restart', () => {
  const dir = temp('crewhouse-held');
  const sent: { id: string; to: string[] }[] = [];
  let quiet = true;
  const link = (db: Store) => Object.assign(new Link({} as any, db, async () => null) as any, {
    client: { notify: async (n: any) => { sent.push(n); return {}; } }, relayStatus: 'online', quiet: () => quiet,
    host: { devices: () => [{ id: 'pixel' }, { id: 'ipad' }] },
  });
  let db = new Store(dir);
  const a = link(db);
  // 2 am: a failed job, then a not-sure one, held for both phones in quiet hours.
  a.news({ seq: 1, kind: 'alert', data: { member: 1 }, bot: null });
  a.news({ seq: 2, kind: 'alert', data: { member: 1 }, bot: null });
  a.sendHeld();
  assert.equal(sent.length, 0, 'nothing reaches the phone in quiet hours');

  // crewd restarts overnight; the hold is in the store.
  db.close();
  db = new Store(dir);
  const b = link(db);
  quiet = false;
  b.sendHeld();
  b.sendHeld();
  assert.deepEqual(sent.map((n) => n.to), [['pixel', 'ipad']], 'one push when quiet hours end, for however much came in');
  db.close();
});

test('push through a stubbed Expo: exactly one content-free push per paired phone, and a missing credential said once', async () => {
  const got: any[][] = [];
  let answer = (msgs: any[]) => msgs.map(() => ({ status: 'ok' }));
  const expo = http1((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { got.push(JSON.parse(b)); res.end(JSON.stringify({ data: answer(got.at(-1)!) })); }); });
  await new Promise<void>((r) => expo.listen(0, '127.0.0.1', r));
  after(() => expo.close());
  const db = new Store(temp('crewhouse-push'));
  const devices = [{ id: 'pixel' }, { id: 'moto' }, { id: 'ipad' }];
  const link = Object.assign(new Link({} as any, db, async () => null) as any, { host: { devices: () => devices }, pushUrl: `http://127.0.0.1:${(expo.address() as AddressInfo).port}/push` });
  const phone = (id: string, body: unknown) => link.request('POST /api/push', { ...body as object, build: 'p9b' }, { id, role: 'control' });
  assert.equal((await phone('pixel', { expo: 'ExponentPushToken[pixel-1]' })).status, 200);
  assert.equal((await phone('moto', { expo: 'ExponentPushToken[moto-1]' })).status, 200);
  assert.equal((await phone('ipad', { expo: 'not a token' })).status, 409, 'only an Expo token, or saying why there is none');
  assert.equal(link.status().push, 'ready');

  // A job fails: every phone with notifications on gets content-free news.
  link.news({ seq: 7, kind: 'alert', data: { member: 1, words: 'Reel could not pay the dentist' }, bot: null });
  for (const end = Date.now() + 5000; !got.length && Date.now() < end;) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, [[
    { to: 'ExponentPushToken[pixel-1]', title: NEWS, sound: 'default', collapseId: 'e7' },
    { to: 'ExponentPushToken[moto-1]', title: NEWS, sound: 'default', collapseId: 'e7' },
  ]]);

  // Expo has no Android credential for the app yet: Settings says so, once, rather than pushes vanishing.
  answer = (msgs) => msgs.map(() => ({ status: 'error', details: { error: 'InvalidCredentials' } }));
  await link.tell('e8');
  assert.equal(link.status().push, 'missing');
  answer = (msgs) => msgs.map((_m, i) => (i ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }));
  await link.tell('e9');
  assert.equal(link.status().push, 'ready', 'a push that goes through clears it');
  await link.tell('e10');
  assert.deepEqual(got.at(-1)!.map((m: any) => m.to), ['ExponentPushToken[pixel-1]'], 'a phone Expo no longer knows is dropped');

  // The app build itself has no push credential: the phone says so, and Settings shows it; said no to notifications is per phone.
  await phone('ipad', { missing: true });
  assert.equal(link.status().push, 'missing');
  await phone('ipad', { off: true });
  assert.equal(link.status().push, 'ready');
  db.close();
});

test('questions, finished helper jobs and Chief lines push only content-free news to the person’s phones', async (t) => {
  const got: any[][] = [];
  const expo = http1((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const msgs = JSON.parse(body);
      got.push(msgs);
      res.end(JSON.stringify({ data: msgs.map(() => ({ status: 'ok' })) }));
    });
  });
  await new Promise<void>((r) => expo.listen(0, '127.0.0.1', r));
  t.after(() => expo.close());
  const db = new Store(temp('crewhouse-news'));
  t.after(() => db.close());
  const devices = ['pixel', 'moto'].map((id) => ({ id }));
  const link = Object.assign(new Link({} as any, db, async () => null) as any, {
    host: { devices: () => devices }, pushUrl: `http://127.0.0.1:${(expo.address() as AddressInfo).port}/push`,
  });
  for (const d of devices) await link.request('POST /api/push', { expo: `ExponentPushToken[${d.id}]`, build: 'p9b' }, d);
  // news() is fire-and-forget: retain the real sends so silence and exact counts can be checked without a sleep.
  const pending: Promise<void>[] = [];
  const tell = link.tell.bind(link);
  link.tell = (id: string) => { const send = tell(id); pending.push(send); return send; };
  db.run("INSERT INTO asks (id, bot, member, title, detail) VALUES (1, 'scout', 1, 'Private question', 'Private detail')");
  db.run("INSERT INTO tasks (id, bot, member, state, result) VALUES (1, 'scout', 1, 'done', 'Private finished work')");
  db.run("INSERT INTO messages (id, bot, member, author, text) VALUES (1, 'chief', 1, 'bot', 'Private Chief line')");
  for (const [i, event] of [
    { kind: 'ask.opened', bot: 'scout', data: { ask: 1 } },
    { kind: 'task.done', bot: 'scout', data: { task: 1 } },
    { kind: 'message', bot: 'chief', data: { id: 1, author: 'bot' } },
  ].entries()) {
    link.news({ seq: i + 1, ...event });
    await Promise.all(pending);
    assert.equal(got.length, i + 1, `${event.kind} sends exactly one batch`);
    assert.deepEqual(got[i], devices.map((d) => ({ to: `ExponentPushToken[${d.id}]`, title: NEWS, sound: 'default', collapseId: `e${i + 1}` })));
  }
  db.run("INSERT INTO tasks (id, bot, member, state, result, routine) VALUES (2, 'chief', 1, 'done', 'All clear', 1), (3, 'chief', 1, 'done', 'Private Chief result', NULL), (4, 'scout', 1, 'done', 'All clear', 2)");
  for (const task of [2, 3, 4]) link.news({ seq: task + 2, kind: 'task.done', bot: task === 4 ? 'scout' : 'chief', data: { task } });
  await Promise.all(pending);
  assert.equal(got.length, 3, 'All clear routines and Chief task completion give no push');
});

test('the computer tells a phone whether its Tailscale has that phone as a peer', async () => {
  const dir = temp('crewhouse-peer');
  const cli = (name: string, out: string) => { const bin = join(dir, name); writeFileSync(bin, `#!/bin/sh\ncat <<'X'\n${out}\nX\n`, { mode: 0o755 }); return bin; };
  const ts = cli('ts', JSON.stringify({ Self: { TailscaleIPs: ['100.101.2.3'] }, Peer: { k1: { TailscaleIPs: ['100.90.1.1'] } } }));
  assert.equal(await tailscalePeer('100.90.1.1', ts), true, 'shared with this phone\'s account');
  assert.equal(await tailscalePeer('100.90.9.9', ts), false, 'not shared: the computer never sees it');
  assert.equal(await tailscalePeer('100.90.1.1', cli('broken', 'no')), undefined, 'no Tailscale here to ask');
  assert.equal(await tailscalePeer('100.90.1.1', cli('absent', JSON.stringify({ Self: {} }))), undefined, 'missing peer map is unknown');
  assert.equal(await tailscalePeer('100.90.1.1', cli('empty', JSON.stringify({ Self: {}, Peer: {} }))), false, 'an observed empty peer map means no');
});

test('a paired phone renews the Add-a-phone code it is looking at; the rest of phone admin stays on the computer', async () => {
  const db = new Store(temp('crewhouse-renew'));
  const seen: string[] = [];
  const link = new Link({} as any, db, async (m: string, path: string) => { seen.push(`${m} ${path}`); return { message: 7, token: 'fresh' }; });
  const phone = { id: 'pixel' };
  const renew = (g: { id: string }, op: string) => (link as any).request(op, { message: 7, build: 'p9b' }, g);
  assert.deepEqual(await renew(phone, 'POST /api/phones/refresh'), { status: 200, body: { message: 7, token: 'fresh' } }, "the person's phone asks for its own fresh code");
  assert.deepEqual(seen, ['POST /api/phones/refresh'], 'the ask reaches crewd');
  assert.equal((await renew(phone, 'POST /api/phones/pair')).status, 403, 'minting a first code stays on the computer');
  assert.equal((await renew(phone, 'DELETE /api/phones/pixel')).status, 403, 'removing a phone stays on the computer');
  db.close();
});

const root = temp('crewhouse-link');
// Ports the OS says are free, not random guesses that another run may hold.
const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const port = await free();
const linkPort = await free();
const base = `http://127.0.0.1:${port}`;
let pushUrl = '';
const startDaemon = () => spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
  env: { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PAIR_MS: '3000', CREWHOUSE_HOLD_MS: '5000', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: String(linkPort),
    CREWHOUSE_PUSH_URL: pushUrl, CREWHOUSE_LINK_HOST: '127.0.0.1', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let daemon = startDaemon();
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
  let stored: DeviceGrant | null = grant;
  let status: LinkStatus = 'connecting';
  const link = new DeviceLink(grant, { store: { save: (g) => { stored = g; }, clear: () => { stored = null; } }, onEvent: (e) => events.push(e), onStatus: (s) => { status = s; } });
  const req = async (method: string, path: string, body?: unknown) => {
    try { return await link.request(`${method} ${path}`, { ...body as object, build: 'p9b' }) as { status: number; body: any }; }
    catch (e: any) { return { status: e.code === 'view-only' ? 403 : 0, body: { error: e.code } }; }
  };
  return { link, req, events, stored: () => stored, status: () => status };
}

test('an unmarked old phone reads only the update notice; a marked current phone reads the crew and can act', async () => {
  await until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
  const phone = open(await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Build check'));
  const live = new DatabaseSync(join(root, 'state', 'crew.db'));
  const ask = live.prepare("INSERT INTO asks (bot, kind, title, detail) VALUES ('chief', 'propose', 'Private question', '{}')").run().lastInsertRowid;
  try {
    const current = await phone.req('GET', '/api/state');
    assert.equal(current.status, 200);
    assert.ok(current.body.asks.some((a: any) => a.title === 'Private question'));
    assert.equal(Object.hasOwn(current.body, 'members'), false);
    const old = await phone.link.request('GET /api/state') as { status: number; body: any };
    assert.equal(old.status, 200, 'old screens swallow API errors, so the notice is a readable Home');
    assert.equal(Object.hasOwn(old.body, 'members'), false);
    assert.equal(old.body.person.onboarded, 1, 'control phones open Home, never Hello');
    assert.deepEqual(old.body.asks, []);
    assert.deepEqual(old.body.tasks, []);
    assert.deepEqual(old.body.events, []);
    assert.equal(A.chats(old.body)[0].line, 'Get the latest Crewhouse app to keep chatting.', 'Chief’s chat row shows the plain notice');
    assert.doesNotThrow(() => { A.office(old.body); A.homeCounts(old.body); A.jobs(old.body); A.status(old.body); });
    assert.doesNotMatch(JSON.stringify(old.body), /Private question/);
    for (const [op, body] of [
      ['POST /api/bots/chief/messages', { text: 'do work' }],
      ['POST /api/phones/refresh', { message: 7, member: 1 }],
      ['POST /api/push', { off: true }],
    ] as const) assert.deepEqual(await phone.link.request(op, body), { status: 426, body: { error: 'Get the latest Crewhouse app to keep chatting.' } }, op);
    const notice = await phone.link.request('GET /api/bots/chief') as { status: number; body: any };
    assert.equal(notice.status, 200, 'the old phone can open the update link in Chief’s chat');
    assert.equal(notice.body.messages.length, 1);
    assert.match(A.lines(notice.body, 'chief')[0].text, /\[Get the latest Crewhouse app\]\(https:\/\/github.com\/umeranjum17\/crewhouse\/releases\/tag\/v1.0.0-preview.20261001.16\) to keep chatting\./);
    assert.doesNotMatch(JSON.stringify(notice.body), /Private question/);
    const desktop = await phone.link.stream('desktop', { bot: 'chief' });
    assert.equal(await new Promise((r) => { desktop.onEnd = r; }), 'Get the latest Crewhouse app to keep chatting.', 'old desktop controls cannot act either');
    assert.equal((await phone.req('POST', '/api/push', { off: true })).status, 200, 'marked current requests retain their effects');
    assert.equal(live.prepare('SELECT value FROM settings WHERE key = ?').get(`phone.push.${phone.link.grant.device.id}`)!.value, 'off');
  } finally { live.prepare('DELETE FROM asks WHERE id = ?').run(ask); live.close(); phone.link.stop(); await http('DELETE', `/api/phones/${phone.link.grant.device.id}`); }
});

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
  await until(async () => Date.now() > parseOffer(late, 0).expires);
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
  assert.equal((await a.req('GET', '/api/state')).status, 200);
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
  await a.req('POST', '/api/bots/chief/messages', { text: `save it [tool crew_assign ${JSON.stringify({ bot: 'reel', task: `save it [tool crew_write ${JSON.stringify({ path: outside, content: 'from the phone' })}]` })}]` });
  const ask = await until(async () => (await a.req('GET', '/api/state')).body.asks.find((x: any) => x.kind === 'permission'));
  const job = ask.task_id;
  assert.match(ask.title, /Reel wants to change a file/);
  assert.equal((await a.req('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow' })).status, 200);
  await until(async () => (await http('GET', '/api/bots/reel')).body.tasks.find((x: any) => x.id === job && x.state === 'done'));
  assert.equal(readFileSync(outside, 'utf8'), 'from the phone');

  // Another member cannot mint a code; the owner's view-only tablet can watch but not answer.
  const offer = (await http('POST', '/api/phones/pair', { role: 'view' })).body;
  const watcher = open(await pairPhone(offer.qr, 'Tablet'));
  assert.equal(watcher.link.grant.device.role, 'view');
  assert.equal((await watcher.req('GET', '/api/state')).body.person.id, 1);
  assert.equal((await watcher.req('POST', '/api/bots/chief/messages', { text: 'hi' })).status, 403);

  // The person's paired phone renews a code that is showing, so its card refreshes itself (docs/ui-contract.md).
  await http('POST', '/api/bots/chief/messages', { text: 'pair my phone' });
  const live = (await http('GET', '/api/bots/chief')).body.phoneOffer;
  const oldRefresh = await a.req('POST', '/api/phones/refresh', { message: live.message, member: 2 });
  assert.deepEqual(oldRefresh, { status: 426, body: { error: 'Get the latest Crewhouse app to keep chatting.' } });
  assert.equal((await http('POST', '/api/phones/refresh', { message: live.message, member: 1 })).status, 426);
  const fromPhone = await a.req('POST', '/api/phones/refresh', { message: live.message });
  assert.equal(fromPhone.status, 200);
  assert.ok(fromPhone.body.token && fromPhone.body.token !== live.token, 'a fresh code, minted at the phone\'s ask');
  assert.equal(fromPhone.body.member, undefined, 'renewed codes have no person selector');

  // Settings lists both; removing one closes its link, the phone forgets its grant, and its key is refused.
  const phones = (await http('GET', '/api/phones')).body;
  assert.deepEqual(phones.map((d: any) => [d.name, d.role, d.online]), [['Pixel', 'control', true], ['Tablet', 'view', true]]);
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
  const phone = (await http('GET', '/api/phones')).body.find((p: any) => p.id === grant.device.id);
  assert.ok(phone, 'the paired phone appears in the computer’s phone list');
  assert.equal(Object.hasOwn(phone, 'member'), false, 'the paired phone has no person selector');
  assert.equal(Object.hasOwn(phone, 'person'), false, 'the paired phone needs no person label');
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
  const s = await w.link.stream('desktop', { bot: 'chief', build: 'p9b' });
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
  const bad = await w.link.stream('desktop', { bot: '../x', build: 'p9b' });
  const ended = await new Promise<string | undefined>((r) => { bad.onEnd = r; });
  assert.equal(ended, 'not-supported');
  w.link.stop();
});



test('phones, push and quiet hold survive a restart after the P1 migration', async () => {
  const aGrant = await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Kept phone');
  const bGrant = await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Former phone');
  const viewGrant = await pairPhone((await http('POST', '/api/phones/pair', { role: 'view' })).body.qr, 'Kept tablet');
  await http('DELETE', `/api/phones/${bGrant.device.id}`); // P1 already retired the other person's phone.
  daemon.kill();
  await new Promise((r) => daemon.once('exit', r));
  const db = new DatabaseSync(join(root, 'state', 'crew.db'));
  const pk = db.prepare('SELECT pk FROM devices WHERE id = ?').get(aGrant.device.id)!.pk as string;
  db.prepare('UPDATE devices SET pk = ? WHERE id = ?').run(Buffer.from(pk, 'base64url').toString('base64'), aGrant.device.id);
  const hour = new Date().getHours();
  const time = (h: number) => `${String((h + 24) % 24).padStart(2, '0')}:00`;
  db.prepare('UPDATE people SET quiet = ? WHERE id = 1').run(`${time(hour - 1)}-${time(hour + 1)}`);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('push.held.1', '1')").run();
  for (const [id, token] of [[aGrant.device.id, 'ExponentPushToken[kept]'], [bGrant.device.id, 'ExponentPushToken[former]']])
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`phone.push.${id}`, token);
  db.close();
  const pushes: any[][] = [];
  const expo = http1((q, r) => { let body = ''; q.on('data', (c) => { body += c; }); q.on('end', () => { const messages = JSON.parse(body); pushes.push(messages); r.end(JSON.stringify({ data: messages.map(() => ({ status: 'ok' })) })); }); });
  await new Promise<void>((r) => expo.listen(0, '127.0.0.1', r));
  after(() => expo.close());
  pushUrl = `http://127.0.0.1:${(expo.address() as AddressInfo).port}/push`;
  daemon = startDaemon();
  await until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
  const a = open(aGrant); const b = open(bGrant); const view = open(viewGrant);
  try {
    await until(async () => b.status() === 'removed');
    await until(async () => b.stored() === null);
    assert.equal((await b.req('GET', '/api/state')).status, 0, 'removed phone cannot fetch the person’s state');
    assert.equal(b.events.length, 0, 'no person’s activity arrives before refusal');
    const phones = (await http('GET', '/api/phones')).body;
    assert.ok(!phones.some((p: any) => p.id === bGrant.device.id));
    assert.ok(phones.some((p: any) => p.id === aGrant.device.id));
    assert.equal((await a.req('GET', '/api/state')).body.person.id, 1, 'legacy base64 host record keeps the phone paired');
    assert.equal((await view.req('GET', '/api/state')).status, 200);
    assert.equal((await view.req('POST', '/api/bots/chief/messages', { text: 'no' })).status, 403);
    assert.equal(pushes.length, 0, 'quiet hours still hold news across the upgrade');
    const live = new DatabaseSync(join(root, 'state', 'crew.db'));
    try {
      assert.equal(live.prepare("SELECT value FROM settings WHERE key = 'push.held.1'").get()!.value, '1');
      assert.equal(live.prepare('SELECT 1 FROM devices WHERE id = ?').get(bGrant.device.id), undefined);
      live.prepare('UPDATE people SET quiet = NULL WHERE id = 1').run();
      await until(async () => pushes.length > 0, 40_000);
      assert.deepEqual(pushes.flat().map((p) => [p.to, p.title]), [['ExponentPushToken[kept]', NEWS]], 'only the retained phone gets content-free held news');
      await until(async () => !live.prepare("SELECT 1 FROM settings WHERE key = 'push.held.1'").get());
      await a.req('POST', '/api/bots/chief/messages', { text: 'hello after upgrade' });
      await until(async () => pushes.length >= 2);
      assert.ok(pushes.flat().every((p) => p.to === 'ExponentPushToken[kept]' && p.title === NEWS));
    } finally { live.close(); }
    assert.equal((await http('PUT', '/api/people/42', { name: 'Umer' })).status, 200, 'legacy route shape edits only the person');
    const snapshot = (await a.req('GET', '/api/state')).body;
    assert.equal(snapshot.person.name, 'Umer');
    assert.equal(Object.hasOwn(snapshot, 'members'), false, 'current phones use person alone');
    assert.equal(typeof snapshot.house.google, 'boolean');
    assert.ok(Object.hasOwn(snapshot.house, 'steps'));
    assert.equal((await http('POST', '/api/accounts/42/chatgpt/retry')).status, 200, 'account route ignores the former member segment');
    assert.equal((await http('POST', '/api/people', { name: 'Another' })).status, 404);
    assert.equal((await http('GET', '/api/people')).status, 404);
    assert.equal((await http('POST', '/api/house/ask', { app: 'calendar' })).status, 404);
    assert.equal((await http('POST', '/api/accounts/1/chatgpt/ask-owner')).status, 404);
  } finally { a.link.stop(); b.link.stop(); view.link.stop(); }
});
