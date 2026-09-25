// The relay (relay/main.ts) on this machine: health, a host registering, a phone pairing and talking through it by
// typed code, content-free push, and who may register. Push services are a mocked fetch; nothing leaves the machine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {  } from 'node:fs';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { promisify } from 'node:util';
import { DeviceLink, Host, keyPair, pairWithCode } from '@byokit/link';
import { RelayClient, type RelayStatus } from '@byokit/relay';
import { findHost } from '@byokit/relay/device';
import { NEWS, startRelay } from '../relay/main.ts';

const dir = temp('crewhouse-relay');
const pushed: any[] = [];
const pushFetch = (async (url: string, init: any) => {
  pushed.push({ url: String(url), body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ data: JSON.parse(init.body).map(() => ({ status: 'ok' })) }), { status: 200 });
}) as typeof fetch;
const enrolled = await startRelay({ port: 0, dataDir: join(dir, 'enrol'), ownerToken: 'owner-secret', push: { fetch: pushFetch } });
const open = await startRelay({ port: 0, dataDir: join(dir, 'open'), signup: 'open', maxHosts: 1 });
after(() => Promise.all([enrolled.close(), open.close()]));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, fn: () => T | undefined | false, ms = 10_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) { const v = fn(); if (v) return v; }
  throw new Error(`timed out waiting for ${what}`);
}
const ws = (url: string) => url.replace(/^http/, 'ws');

/** A family computer: a link host (answers `echo`) dialled out to the relay. */
async function computer(relayUrl: string, enrol?: string) {
  const host = await Host.open({ keys: keyPair(), name: 'Kitchen computer', confirm: () => true, handle: (req) => ({ echo: req.args }) });
  let status: RelayStatus = 'connecting';
  const client = new RelayClient(host as any, { url: `${ws(relayUrl)}/relay/v1/host`, enrol, onStatus: (s) => { status = s; } });
  after(() => { client.stop(); host.close(); });
  return { host, client, status: () => status };
}

test('health says ok, and the scripted check agrees', async () => {
  const res = await fetch(`${enrolled.url}/health`);
  assert.deepEqual(await res.json(), { ok: true });
  const { stdout } = await promisify(execFile)(process.execPath, [join(import.meta.dirname, '..', 'relay', 'health.ts'), enrolled.url]);
  assert.match(stdout, /relay ok/);
  await assert.rejects(promisify(execFile)(process.execPath, [join(import.meta.dirname, '..', 'relay', 'health.ts'), 'http://127.0.0.1:9']), 'a relay that is down fails the check');
});

test('a host registers with a one-use enrolment, a phone pairs by typed code and exchanges frames, push is content-free', async () => {
  const stranger = await computer(enrolled.url);
  await until('an unenrolled host refused', () => stranger.status() === 'refused');

  const make = await fetch(`${enrolled.url}/relay/v1/enrolments`, { method: 'POST', headers: { authorization: 'Bearer owner-secret' }, body: '{}' });
  assert.equal(make.status, 201);
  const { host, client, status } = await computer(enrolled.url, (await make.json()).token);
  await until('host online', () => status() === 'online');
  assert.equal(client.id, host.id);

  // The phone types the relay's short code and link's pairing code; the relay learns only which host the first means.
  const { code: short } = await client.code();
  const { code } = host.code({ role: 'control' });
  const url = await findHost(enrolled.url, short);
  assert.equal(url, `${ws(enrolled.url)}/link/v1/${host.id}`);
  const grant = await pairWithCode(url, code, { name: 'Pixel 9', onWords: () => {} });
  const phone = new DeviceLink(grant, {});
  after(() => phone.stop());
  assert.deepEqual(await phone.request('echo', { hi: 1 }), { echo: { hi: 1 } }, 'a request and its answer, through the relay');

  // Whatever the host asks for, the phone's push says only "Crewhouse has news".
  await client.subscribe(grant.device.id, { expo: 'ExponentPushToken[crewhouse-test]' });
  const r = await client.notify({ id: 'task-7-buy-milk', title: 'Reel finished: buy milk', body: 'Your card ends 4242', data: { task: 7 }, actions: ['yes', 'no'], to: [grant.device.id] }, { includeContent: true });
  assert.equal(r.sent, 1);
  assert.equal(pushed.length, 1);
  const [sent] = pushed[0].body;
  assert.equal(sent.title, NEWS);
  assert.equal(sent.body, undefined);
  assert.deepEqual(Object.keys(sent.data).sort(), ['id', 'title'], 'no data, no buttons');
  assert.doesNotMatch(JSON.stringify(pushed[0].body), /milk|4242|Reel|task-7|yes/);
  assert.deepEqual(await client.notify({ id: 'task-7-buy-milk', title: 'again' }), { sent: 0, duplicate: true }, 'a retried id still dedupes');
});

test('open signup takes any host that proves its key, up to the cap', async () => {
  const first = await computer(open.url);
  await until('first host online', () => first.status() === 'online');
  const second = await computer(open.url);
  await until('second host refused at the cap', () => second.status() === 'refused');
  assert.equal(open.relay.hosts().length, 1);
});
