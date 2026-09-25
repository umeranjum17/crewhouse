// A revoked Crewhouse phone cannot reuse an answered request, even by reconnecting with its old grant.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLink, pairWithOffer, type DeviceGrant } from '@byokit/link';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-revoke-cache-'));
const free = () => new Promise<number>((resolve) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const port = (server.address() as AddressInfo).port;
    server.close(() => resolve(port));
  });
});
const port = await free();
const linkPort = await free();
const daemon = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
  env: { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PAIR_MS: '120000', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: String(linkPort),
    CREWHOUSE_LINK_HOST: '127.0.0.1', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const base = `http://127.0.0.1:${port}`;
const http = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
};
const until = async <T>(what: string, get: () => Promise<T | undefined | false>): Promise<T> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await get();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};
after(() => daemon.kill());

test('revoking a phone prevents its cached protected reply from being fetched again', async () => {
  await until('Crewhouse ready', async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
  const offer = (await http('POST', '/api/phones/pair', { role: 'control' })).body;
  const paired = pairWithOffer(offer.qr, { name: 'Revoked phone', onWords: () => {} });
  const asking = await until('pair request', async () => (await http('GET', '/api/phones/link')).body.asking.find((x: any) => x.name === 'Revoked phone'));
  await http('POST', '/api/phones/answer', { id: asking.id, yes: true });
  const grant: DeviceGrant = await paired;
  const phone = new DeviceLink(grant, {});
  after(() => phone.stop());

  const protectedReply = await phone.request('GET /api/state') as any;
  assert.ok(protectedReply && typeof protectedReply === 'object', 'the phone received a protected state reply');
  await http('DELETE', `/api/phones/${grant.device.id}`);
  await until('phone learns it was removed', async () => phone.status === 'removed' || false);

  // Its old credentials cannot reopen the channel and recover the prior answer.
  const replay = new DeviceLink(grant, {});
  after(() => replay.stop());
  await until('old grant refused', async () => replay.status === 'removed' || false);
  await assert.rejects(replay.request('GET /api/state'), /removed/);
});
