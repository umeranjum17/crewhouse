// The phone link: where it listens, then pairing, the person's yes, grants, approvals and removal through the real
// daemon, with @byokit/link's own device side as the phone. The Noise handshake and frames are the package's, tested there.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { DeviceLink, pairWithOffer, type DeviceGrant, type LinkStatus } from '@byokit/link';
import { linkHosts, phoneAddresses } from '../src/link.ts';

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

  // Live events arrive over the link.
  await a.req('POST', '/api/onboard', { address: 'Sir' });
  await until(async () => a.events.find((e) => e.kind === 'person.onboarded'));

  // An approval answered from the phone: the gate holds the bot's write until the phone says yes.
  await http('POST', '/api/recruit', { template: 'reel', name: 'Reel' });
  const outside = join(root, 'Documents', 'from-phone.txt');
  const job = (await a.req('POST', '/api/bots/reel/messages', { text: `save it [tool write ${JSON.stringify({ path: outside, content: 'from the phone' })}]` })).body.task;
  const ask = await until(async () => (await a.req('GET', '/api/state')).body.asks.find((x: any) => x.kind === 'permission'));
  assert.match(ask.title, /Reel wants to change a file/);
  assert.equal((await a.req('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow' })).status, 200);
  await until(async () => (await http('GET', '/api/bots/reel')).body.tasks.find((x: any) => x.id === job && x.state === 'done'));
  assert.equal(readFileSync(outside, 'utf8'), 'from the phone');

  // Paired from Sam's screen, the view-only tablet is Sam's: his thread, his questions, and it can only watch.
  const sam = (await http('POST', '/api/people', { name: 'Sam' })).body;
  const offer = (await http('POST', '/api/phones/pair', { role: 'view' }, { 'x-crewhouse': '1', 'x-crewhouse-member': String(sam.id) })).body;
  const watcher = open(await pairPhone(offer.qr, 'Tablet'));
  assert.equal(watcher.link.grant.device.role, 'view');
  assert.equal((await watcher.req('GET', '/api/state')).body.person.id, sam.id);
  assert.equal((await watcher.req('POST', '/api/bots/chief/messages', { text: 'hi' })).status, 403);

  // Settings lists both; removing one closes its link, the phone forgets its grant, and its key is refused.
  const phones = (await http('GET', '/api/phones')).body;
  assert.deepEqual(phones.map((d: any) => [d.name, d.role, d.member, d.online]), [['Pixel', 'control', 1, true], ['Tablet', 'view', sam.id, true]]);
  assert.equal((await http('DELETE', `/api/phones/${phones[0].id}`)).status, 200);
  await until(async () => a.status() === 'removed');
  const again = open(grant);
  await until(async () => again.status() === 'removed', 15_000);
  assert.equal((await watcher.req('GET', '/api/state')).status, 200, 'other phones are untouched');
  watcher.link.stop();
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
