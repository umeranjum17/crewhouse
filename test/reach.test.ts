// From anywhere (Option B): crewd dials out to a relay on this machine and opens no link port of its own. A phone pairs by
// typed code through the relay, talks to crewd through it, learns the relay address, and gets content-free pushes.
// The push service is a mocked fetch; nothing leaves the machine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLink, pairWithCode } from '@byokit/link';
import { findHost } from '@byokit/relay/device';
import { NEWS, startRelay } from '../relay/main.ts';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-reach-'));
const pushed: any[] = [];
const pushFetch = (async (_url: string, init: any) => {
  pushed.push(...JSON.parse(init.body));
  return new Response(JSON.stringify({ data: JSON.parse(init.body).map(() => ({ status: 'ok' })) }), { status: 200 });
}) as typeof fetch;
const relay = await startRelay({ port: 0, dataDir: join(root, 'relay'), ownerToken: 'owner-secret', push: { fetch: pushFetch } });
const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const port = await free();
const base = `http://127.0.0.1:${port}`;
const daemon = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
  // CREWHOUSE_LINK_PORT=0: no link socket of its own, so the relay is the only way in.
  env: { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PAIR_MS: '5000', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_RELAY: '',
    CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
after(async () => { daemon.kill(); await relay.close(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function http(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
async function until<T>(what: string, fn: () => Promise<T | undefined | false> | T | undefined | false, ms = 10_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) { const v = await fn(); if (v) return v; }
  throw new Error(`timed out waiting for ${what}`);
}

test('reachable from anywhere: enrol once, pair by typed code, talk through the relay, content-free push, remove', async () => {
  await until('crewd', async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
  assert.equal((await http('GET', '/api/phones/link')).body.relayStatus, 'off', 'no relay until the family sets one');
  assert.equal((await http('POST', '/api/phones/code', { role: 'control' })).status, 409, 'no typed code without a relay');

  // The family's own relay lets computers in by invitation: the owner's one-use enrolment, pasted once.
  const { token } = await (await fetch(`${relay.url}/relay/v1/enrolments`, { method: 'POST', headers: { authorization: 'Bearer owner-secret' }, body: '{}' })).json();
  await http('PUT', '/api/phones/relay', { url: relay.url, enrol: token });
  await until('online on the relay', async () => (await http('GET', '/api/phones/link')).body.relayStatus === 'online');
  assert.equal(relay.relay.hosts().length, 1);

  // The phone types the two codes; the person at the computer checks the words and says yes.
  const { short, code, relay: address } = (await http('POST', '/api/phones/code', { role: 'control' })).body;
  assert.equal(address, relay.url);
  assert.match(short, /^[A-Z0-9]{6}$/);
  const url = await findHost(address, short);
  let words = '';
  const paired = pairWithCode(url, code, { name: 'Pixel 9', onWords: (w) => { words = w; } });
  const asking = await until('asked at the computer', async () => (await http('GET', '/api/phones/link')).body.asking.find((a: any) => a.name === 'Pixel 9'));
  assert.equal(asking.words, words);
  await http('POST', '/api/phones/answer', { id: asking.id, yes: true });
  const grant = await paired;
  assert.deepEqual(grant.urls, [url]);

  const phone = new DeviceLink(grant, {});
  after(() => phone.stop());
  const req = (op: string, body?: unknown) => phone.request(op, body) as Promise<{ status: number; body: any }>;
  assert.equal((await req('GET /api/state')).status, 200, 'the app, through the relay');
  assert.deepEqual((await req('GET /api/reach')).body, { urls: [url] }, 'a phone paired at home learns the relay address');
  assert.equal((await req('POST /api/push', { expo: 'ExponentPushToken[crewhouse-test]' })).status, 200);

  // Chief speaks to the owner: the phone is told only "Crewhouse has news".
  await http('POST', '/api/onboard', { address: 'sir' });
  await http('POST', '/api/bots/chief/messages', { text: 'what is on tomorrow about the dentist' });
  await until('a push', () => pushed.length > 0);
  assert.equal(pushed[0].title, NEWS);
  assert.doesNotMatch(JSON.stringify(pushed), /dentist|Chief|sir|tomorrow/);

  // Removing the phone at the computer works through the relay too.
  const [device] = (await http('GET', '/api/phones')).body;
  assert.equal((await http('DELETE', `/api/phones/${device.id}`)).status, 200);
  assert.deepEqual((await http('GET', '/api/phones')).body, []);

  // Turning the relay off stops dialling out.
  await http('PUT', '/api/phones/relay', { url: '' });
  assert.equal((await http('GET', '/api/phones/link')).body.relayStatus, 'off');
});
