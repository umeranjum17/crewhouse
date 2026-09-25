// The phone link: envelope crypto, then pairing, grants and revocation through the real daemon.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import b4a from 'b4a';
import Noise from 'noise-handshake';
import { Channel, keyPair, openLink, parseOffer, respond, unb64 } from '../src/envelope.ts';
import { linkHosts, phoneAddresses } from '../src/link.ts';

/** The phone's half of Noise IK, as the app runs it. */
function phoneHello(me: ReturnType<typeof keyPair>, crewdPk: Uint8Array, hello = { v: 1, pair: false }) {
  const hs = new Noise('IK', true, { publicKey: b4a.from(me.publicKey), secretKey: b4a.from(me.secretKey) });
  hs.initialise(b4a.from('crewhouse-link-v1'), b4a.from(crewdPk));
  return { hs, first: b4a.toString(hs.send(b4a.from(JSON.stringify(hello))), 'base64') };
}

test('Noise IK handshake: both ends agree, and each learns who the other is', () => {
  const [phone, crewd] = [keyPair(), keyPair()];
  const { hs, first } = phoneHello(phone, crewd.publicKey, { v: 1, pair: true });
  const r = respond(crewd, first);
  assert.deepEqual(r.hello, { v: 1, pair: true });
  assert.deepEqual(Buffer.from(r.phone), Buffer.from(phone.publicKey), 'crewd learns the phone key from the handshake');
  hs.recv(unb64(r.reply));
  assert.ok(hs.complete);
  const p = new Channel(hs), c = r.channel;
  const [f] = p.seal({ hi: 'ünïcode ✓' });
  assert.doesNotMatch(Buffer.from(f, 'base64').toString('latin1'), /hi|nicode/, 'payload is not readable on the wire');
  assert.deepEqual(c.open(f), { hi: 'ünïcode ✓' });
  assert.deepEqual(p.open(c.seal({ back: 1 })[0]), { back: 1 });
});

test('wrong keys are refused', () => {
  const [phone, crewd, other] = [keyPair(), keyPair(), keyPair()];
  // A phone holding a different crewd key (a spoofed QR, or the wrong computer) can't complete.
  assert.throws(() => respond(crewd, phoneHello(phone, other.publicKey).first), /verify/);
  // And a reply from anyone but the crewd in the QR fails on the phone.
  const { hs, first } = phoneHello(phone, crewd.publicKey);
  respond(crewd, first);
  const impostor = respond(other, phoneHello(phone, other.publicKey).first);
  assert.throws(() => hs.recv(unb64(impostor.reply)));
  assert.throws(() => parseOffer('{"crewhouse":1}'), /not a Crewhouse/);
});

test('frames: replay, tamper and reorder are refused; big messages go in pieces', () => {
  const [phone, crewd] = [keyPair(), keyPair()];
  const { hs, first } = phoneHello(phone, crewd.publicKey);
  const r = respond(crewd, first);
  hs.recv(unb64(r.reply));
  const p = new Channel(hs), c = r.channel;
  const [f0] = p.seal({ n: 0 }), [f1] = p.seal({ n: 1 }), [f2] = p.seal({ n: 2 });
  assert.deepEqual(c.open(f0), { n: 0 });
  assert.throws(() => c.open(f0), 'a replayed frame is refused');
  assert.throws(() => c.open(f2), 'a skipped frame is refused');
  const bytes = unb64(f1); bytes[3] ^= 1;
  assert.throws(() => c.open(Buffer.from(bytes).toString('base64')), 'a flipped bit is refused');
  const big = { text: 'x'.repeat(150_000) };
  const frames = p.seal(big);
  assert.equal(frames.length, 3);
  const c2 = respond(crewd, phoneHello(phone, crewd.publicKey).first).channel;
  assert.throws(() => c2.open(frames[0]), 'frames do not carry into another socket');
});

test('the link binds loopback and Tailscale by default; the home network only when turned on', () => {
  const at = (address: string, internal = false) => [{ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null }] as any;
  const ifaces = { lo: at('127.0.0.1', true), wlan0: at('192.168.1.20'), tailscale0: at('100.101.2.3'), docker0: at('172.17.0.1') };
  assert.deepEqual(linkHosts('', false, ifaces), ['127.0.0.1', '100.101.2.3']);
  assert.deepEqual(linkHosts('', true, ifaces), ['0.0.0.0']);
  assert.deepEqual(linkHosts('10.0.0.5, 127.0.0.1', true, ifaces), ['10.0.0.5', '127.0.0.1'], 'CREWHOUSE_LINK_HOST pins the addresses');
  assert.deepEqual(phoneAddresses(['127.0.0.1', '100.101.2.3'], ifaces), ['100.101.2.3'], 'the QR never offers loopback');
  assert.deepEqual(phoneAddresses(['0.0.0.0'], ifaces), ['192.168.1.20', '100.101.2.3'], 'home network first; container bridges skipped');
  assert.deepEqual(linkHosts('', false, { lo: at('127.0.0.1', true), eth0: at('192.168.1.20') }), ['127.0.0.1'], 'no Tailscale: loopback only');
});

const root = mkdtempSync(join(tmpdir(), 'crewhouse-link-'));
// Ports the OS says are free, not random guesses that another run may hold.
const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const port = await free();
const linkPort = await free();
const base = `http://127.0.0.1:${port}`;
const daemon = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
  env: { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PAIR_MS: '1500', CREWHOUSE_HOLD_MS: '5000', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: String(linkPort),
    CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
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

/** A phone: its own key pair, one socket, numbered requests. */
async function phone(me: ReturnType<typeof keyPair>, crewdPk: Uint8Array, first: any) {
  const events: any[] = [], waiting = new Map<number, (r: any) => void>();
  let closed = '', n = 0;
  const link = await openLink(`ws://127.0.0.1:${linkPort}/link`, me, crewdPk, first, {
    message: (m) => (m.t === 'res' ? waiting.get(m.id)?.(m) : events.push(m)),
    close: (why) => { closed = why; },
  });
  const req = (method: string, path: string, body?: unknown, key?: string) => new Promise<any>((resolve) => {
    const id = ++n; waiting.set(id, resolve); link.send({ t: 'req', id, method, path, body, key });
  });
  return { link, req, events, closed: () => closed };
}

test('pairing, grants, idempotent answers and revocation', async () => {
  await until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
  assert.equal(statSync(join(root, 'state', 'link.key')).mode & 0o777, 0o600, 'the link key is private to the owner');

  // By default the link is on loopback (and Tailscale, when there is one), never every interface.
  assert.deepEqual((await http('GET', '/api/phones')).body, [], 'docs/ui-contract.md: a list');
  let st = (await http('GET', '/api/phones/link')).body;
  assert.equal(st.lan, false);
  assert.ok(st.hosts.includes('127.0.0.1') && !st.hosts.includes('0.0.0.0'), JSON.stringify(st.hosts));
  assert.ok(st.hosts.every((h: string) => h === '127.0.0.1' || h.startsWith('100.')));
  assert.equal((await http('PUT', '/api/phones/lan', { on: true }, {})).status, 403, 'only this computer can widen it');
  st = (await http('PUT', '/api/phones/lan', { on: true })).body;
  assert.deepEqual(st.hosts, ['0.0.0.0'], 'the home network is an explicit opt-in');
  st = (await http('PUT', '/api/phones/lan', { on: false })).body;
  assert.ok(!st.hosts.includes('0.0.0.0'));

  // The QR: crewd's key, a single-use code, addresses. Only this computer can ask for one.
  assert.equal((await http('POST', '/api/phones/pair', { role: 'control' }, {})).status, 403);
  const offer = (await http('POST', '/api/phones/pair', { role: 'control' })).body;
  const qr = parseOffer(offer.qr);
  const crewdPk = unb64(qr.k);
  assert.match(offer.fp, /^[0-9a-f]{4}( [0-9a-f]{4}){3}$/);

  // An unpaired phone gets nowhere without a code; a wrong server key fails the handshake.
  const me = keyPair();
  await assert.rejects(phone(me, crewdPk, { t: 'auth' }), /not paired/);
  await assert.rejects(phone(me, keyPair().publicKey, { t: 'pair', code: qr.c, name: 'Pixel' }), /verify|closed/);
  // That failed attempt burned nothing: the code only dies when crewd can read it.

  const a = await phone(me, crewdPk, { t: 'pair', code: qr.c, name: 'Pixel' });
  assert.equal(a.link.ready.device.role, 'control');
  assert.equal(a.link.ready.fp, offer.fp);
  await assert.rejects(phone(keyPair(), crewdPk, { t: 'pair', code: qr.c, name: 'Again' }), /expired|not paired/, 'codes are single use');
  const late = parseOffer((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr);
  await sleep(1700);
  await assert.rejects(phone(keyPair(), crewdPk, { t: 'pair', code: late.c, name: 'Late' }), /expired|not paired/, 'codes expire');

  // The grant is durable: a fresh socket with the same key needs no code.
  a.link.close();
  const b = await phone(me, crewdPk, { t: 'auth' });
  const state = await b.req('GET', '/api/state');
  assert.equal(state.status, 200);
  assert.ok(state.body.bots.some((x: any) => x.id === 'chief'));
  assert.equal((await b.req('POST', '/api/phones/pair', { role: 'control' })).status, 404, 'a phone cannot mint pairing codes');
  assert.equal((await b.req('GET', '/api/phones')).status, 404, 'or list phones');
  assert.equal((await b.req('GET', '/api/phones/link')).status, 404);
  assert.equal((await b.req('POST', '/api/connections/notion')).status, 403, 'connecting apps stays on the computer');
  assert.equal((await b.req('PUT', '/api/house/google', { id: 'x', secret: 'y' })).status, 403, 'and so does the house Google app');
  assert.equal((await b.req('GET', '/api/accounts')).status, 403, 'AI account sign-ins stay on the computer');
  assert.equal((await b.req('POST', '/api/people', { name: 'Mallory' })).status, 403, 'and so does adding people');
  assert.equal((await b.req('GET', '/api/people')).status, 200);
  assert.equal((await b.req('GET', '/files/chief/x')).status, 404);

  // Live events arrive sealed; a retried tap with the same key runs once.
  await b.req('POST', '/api/onboard', { address: 'Sir' });
  const r1 = await b.req('POST', '/api/bots/chief/messages', { text: 'hello from the phone' }, 'tap-1');
  const r2 = await b.req('POST', '/api/bots/chief/messages', { text: 'hello from the phone' }, 'tap-1');
  assert.deepEqual(r1, { ...r2, id: r1.id });
  const msgs = (await http('GET', '/api/bots/chief')).body.messages.filter((m: any) => m.text === 'hello from the phone');
  assert.equal(msgs.length, 1);
  await until(async () => b.events.find((m) => m.t === 'event' && m.e.kind === 'person.onboarded'));

  // An approval answered from the phone: the gate holds the bot's write until the phone says yes.
  await http('POST', '/api/recruit', { template: 'reel', name: 'Reel' });
  const outside = join(root, 'Documents', 'from-phone.txt');
  const job = (await b.req('POST', '/api/bots/reel/messages', { text: `save it [tool write ${JSON.stringify({ path: outside, content: 'from the phone' })}]` }, 'tap-2')).body.task;
  const ask = await until(async () => (await b.req('GET', '/api/state')).body.asks.find((x: any) => x.kind === 'permission'));
  assert.match(ask.title, /Reel wants to change a file/);
  assert.equal((await b.req('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow' }, 'ans-1')).status, 200);
  await until(async () => (await http('GET', '/api/bots/reel')).body.tasks.find((x: any) => x.id === job && x.state === 'done'));
  assert.equal(readFileSync(outside, 'utf8'), 'from the phone');

  // A view-only phone watches but can't act.
  // Paired from Sam's screen, the tablet is Sam's: his thread, his questions.
  const sam = (await http('POST', '/api/people', { name: 'Sam' })).body;
  const v = parseOffer((await http('POST', '/api/phones/pair', { role: 'view' }, { 'x-crewhouse': '1', 'x-crewhouse-member': String(sam.id) })).body.qr);
  const watcher = await phone(keyPair(), crewdPk, { t: 'pair', code: v.c, name: 'Tablet' });
  assert.equal(watcher.link.ready.device.role, 'view');
  assert.equal((await watcher.req('GET', '/api/state')).body.person.id, sam.id);
  assert.equal((await watcher.req('GET', '/api/state')).status, 200);
  assert.equal((await watcher.req('POST', '/api/bots/chief/messages', { text: 'hi' })).status, 403);

  // Settings lists both; revoking closes the socket and refuses the key from then on.
  const devices = (await http('GET', '/api/phones')).body;
  assert.deepEqual(devices.map((d: any) => d.member), [1, sam.id], 'a phone belongs to the member whose screen showed the code');
  assert.deepEqual(devices.map((d: any) => [d.name, d.role, d.online]), [['Pixel', 'control', true], ['Tablet', 'view', true]]);
  assert.equal((await http('DELETE', `/api/phones/${devices[0].id}`)).status, 200);
  await until(async () => b.closed());
  assert.ok(b.events.some((m) => m.t === 'revoked'), 'removal is said inside the encrypted channel, not only in a plaintext close');
  await assert.rejects(phone(me, crewdPk, { t: 'auth' }), /not paired/);
  assert.equal((await watcher.req('GET', '/api/state')).status, 200, 'other phones are untouched');
  watcher.link.close();
});
