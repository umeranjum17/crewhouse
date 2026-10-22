// The phone's cloud connect (web/src/cloud.ts) on BYOKit's fake boat.dev and a real headless runner on the stub engine:
// a refused key is said in Chief's words and never kept; an accepted one lists the person's computer, and Use this
// computer walks the kit's setup steps to ready, no new rental. The runner enrols the delivered phone key as its owner
// and answers with the receipt, which becomes this phone's grant: it reaches Chief through the computer's own published
// relay, and the binding survives a restart. An install failure stops the list at that row and the retry resumes; a
// throw stops on the row setup was on, or on none before the kit's first step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { DeviceLink, hostId, keyPair, unb64url, type DeviceGrant } from '@byokit/pair';
import { linkUrl } from '@byokit/relay/device';
import { startFakeSandboxServer, memoryStore } from '@byokit/cloud/testing';
import { checkKey, connect, cost, make, progress, provider, said } from '../web/src/cloud.ts';
import { until, delegated } from './lab.ts';
import { temp } from './tmp.ts';

const all = async <S>(g: AsyncGenerator<S>) => { const out: S[] = []; for await (const s of g) out.push(s); return out; };
const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });

test('paste a boat.dev key, pick the computer, and chat with Chief running there', async (t) => {
  const server = await startFakeSandboxServer({ key: 'good-key' });
  t.after(() => server.close());
  const seeded = await provider(async () => 'good-key', server.url).create!({ name: 'old', size: 'small', keepCopies: true, idempotencyKey: 'seed' });
  const store = memoryStore();
  const bad = await checkKey(provider(async () => 'wrong', server.url), store, 'wrong').catch((e) => e);
  assert.equal(said(bad), "boat.dev didn't accept your key. Make a new one and try again.");
  assert.equal(await store.load(), null);

  const p = provider(async () => 'good-key', server.url);
  const listed = await checkKey(p, store, 'good-key');
  assert.deepEqual(listed.map((r) => r.id), [seeded.id]);
  assert.equal((await store.load())!.providerKey, 'good-key');
  assert.equal(cost(), '$0.018/hour · about $13.14 for 730 hours. boat.dev plans start at $20 a month with compute credit included; this computer uses that credit. List price checked 13 Oct.');

  server.machine.script('apt-get', { code: 0, stdout: '', stderr: '', timedOut: false });
  server.machine.script('curl', { code: 1, stdout: '', stderr: 'no route', timedOut: false });
  const phone = keyPair();
  const failed = await all(connect(p, store, listed[0], phone));
  assert.deepEqual(progress(failed), { done: 2, failed: 2, why: 'Installing Chief stopped partway. boat.dev reports a problem with your cloud computer.', retry: true });
  // Chief's own screen needs a display: the recipe's one root step installs it before anything else.
  assert.ok(server.machine.runs.some((r) => r.root && r.argv.join(' ').includes('apt-get install -y xvfb')), 'the computer gets Xvfb');

  // The computer: the headless runner with the recipe's relay published, its kit folder bridged to the fake machine's.
  const dir = temp('cloud-host'), bin = join(dir, 'bin'), repo = join(import.meta.dirname, '..'), cloud = join(dir, '.byokit'), remote = '/home/user/crewhouse/.byokit';
  mkdirSync(bin);
  writeFileSync(join(bin, 'tailscale'), `#!/bin/sh\ntouch '${join(dir, 'ts-called')}'\nexit 79\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_CLOUD_DIR: cloud,
    CREWHOUSE_STATE_DIR: join(dir, 'state'), CREWHOUSE_CREW_DIR: join(dir, 'crew'), CREWHOUSE_TOOLS_DIR: join(dir, 'tools'),
    CREWHOUSE_PORT: String(await free()), CREWHOUSE_LINK_PORT: String(await free()), CREWHOUSE_RELAY_PORT: String(await free()) };
  const published = `http://127.0.0.2:${env.CREWHOUSE_RELAY_PORT}`;
  Object.assign(env, { CREWHOUSE_RELAY_PUBLIC: published });
  let log = '', host: ReturnType<typeof spawn> | undefined, link: DeviceLink | undefined;
  const boot = () => { log = ''; host = spawn(process.execPath, ['scripts/headless.mjs'], { cwd: repo, env }); host.stdout!.on('data', (b) => log += b); host.stderr!.on('data', (b) => log += b); };
  const stop = async () => { if (host?.exitCode === null) { host.kill('SIGTERM'); await new Promise((r) => host!.once('exit', r)); } };
  const machines = [server.machine];
  const bridge = setInterval(() => {
    for (const m of machines) {
      const delivered = m.files.get(`${remote}/inbox/phone.bin`);
      if (delivered && !existsSync(join(cloud, 'inbox/phone.bin')) && !existsSync(join(cloud, 'outbox/receipt.json'))) { mkdirSync(join(cloud, 'inbox'), { recursive: true }); writeFileSync(join(cloud, 'inbox/phone.bin'), delivered.bytes); }
      if (existsSync(join(cloud, 'outbox/receipt.json'))) m.writeFile(`${remote}/outbox/receipt.json`, readFileSync(join(cloud, 'outbox/receipt.json')), 0o600);
    }
  }, 50);
  t.after(async () => { clearInterval(bridge); link?.stop(); await stop(); });
  boot();
  await until('the runner is ready', () => log.includes('headless host ready'), 60_000).catch((e) => { throw new Error(`${e.message}\n${log}`); });

  server.machine.script('curl', { code: 0, stdout: '', stderr: '', timedOut: false });
  const steps = await all(connect(p, store, listed[0], phone));
  assert.deepEqual(steps.map((s) => s.step), ['checking-access', 'listing', 'inspecting', 'installing', 'pairing', 'ready']);
  assert.deepEqual(progress(steps), { done: 5, failed: -1, why: '', retry: false });
  // A throw mid-setup marks the row setup was on; one before the kit's first step marks none. Both offer Try again.
  assert.deepEqual(progress(steps.slice(0, 4), 'lost'), { done: 3, failed: 3, why: 'lost', retry: true });
  assert.deepEqual(progress([], 'lost'), { done: 0, failed: -1, why: 'lost', retry: true });
  assert.equal(server.requests.filter((r) => r.method === 'POST' && r.path === '/sandboxes').length, 1, 'only the seeded computer was ever rented');
  assert.match(log, /owner phone is enrolled/);

  // The phone's own "Try again": the same computer, set up a second time. The install runs again and the
  // phone pairs again, so the setup is not a once-per-phone thing.
  const again = await all(connect(p, store, listed[0], phone));
  assert.deepEqual(again.map((s) => s.step), ['checking-access', 'listing', 'inspecting', 'installing', 'pairing', 'ready']);
  assert.deepEqual(progress(again), { done: 5, failed: -1, why: '', retry: false });
  assert.equal((await store.load())!.ref!.id, seeded.id, 'the computer the phone already has stays the one it has');

  // A second phone on the computer this one set up: the screen can't move Chief over, so the words don't offer it.
  const secondPhone = await all(connect(p, memoryStore(), listed[0], keyPair()));
  assert.deepEqual(progress(secondPhone), { done: 1, failed: 1, retry: false,
    why: 'Checking the computer stopped. Chief is already on this computer, set up with another phone. Talk to Chief from that phone, or go back and pick or make another computer.' });

  // The app's own refusals are named, not one generic line: a computer that is gone, and a setup that is
  // already running on this phone.
  const gone = await all(connect(p, store, { ...listed[0], id: 'sbx-gone' }, phone)).catch((e) => e);
  assert.equal(said(gone), 'That computer is not in your boat.dev account any more. Pick another one.');
  const busyStore = memoryStore();
  const held = connect(p, busyStore, listed[0], phone);
  await held.next();
  const busy = await connect(p, busyStore, listed[0], phone).next().catch((e) => e);
  assert.equal(said(busy), 'Setup is already running on this phone. Wait for it to finish.');
  await held.return(undefined);

  // Another computer in the same account replaces the one the phone had: the person picks it, so it is the
  // one Chief is set up on. The fake numbers its sandboxes per server, so the other computer is the second
  // one there and has an id the first account's computer does not have.
  const other = await startFakeSandboxServer({ key: 'good-key' });
  t.after(() => other.close());
  machines.push(other.machine);
  other.machine.script('apt-get', { code: 0, stdout: '', stderr: '', timedOut: false });
  const otherProvider = provider(async () => 'good-key', other.url);
  // A new account has no computer: Make a new computer rents one there, one rental per press.
  assert.deepEqual(await checkKey(otherProvider, memoryStore(), 'good-key'), []);
  await make(otherProvider, 'press-1');
  const second = await make(otherProvider, 'press-2');
  assert.equal((await make(otherProvider, 'press-2')).id, second.id, 'a repeated press is the same rental');
  const moved = await all(connect(otherProvider, store, second, phone));
  assert.deepEqual(moved.map((s) => s.step), ['checking-access', 'listing', 'inspecting', 'installing', 'pairing', 'ready']);
  assert.equal((await store.load())!.ref!.id, second.id, 'the phone’s computer is the one the person picked');

  // The grant dials the computer's own public relay address. The fake's address can't carry bytes, so the phone dials
  // the runner's published relay for the same host instead: that one hop is the live boat.dev run's to prove.
  const grant = steps.find((s) => s.grant)!.grant!;
  assert.deepEqual(grant.urls, [linkUrl(`https://${seeded.id}-7300.boat.test`, hostId(unb64url(grant.host)))]);
  const dial = (g: DeviceGrant) => {
    const l = new DeviceLink({ ...g, urls: [linkUrl(published, hostId(unb64url(g.host)))] }, { store: { save() {}, clear() {} } });
    const req = async (method: string, path: string, body?: object) => {
      try { return await l.request(`${method} ${path}`, { ...body, build: 'p9b' }) as { status: number; body: any }; }
      catch (e: any) { return { status: 0, body: { error: e.code } }; }
    };
    return { l, req };
  };
  let phoneSide = dial(grant); link = phoneSide.l;
  assert.equal((await phoneSide.req('GET', '/api/accounts')).status, 200, 'the cloud phone is the computer\'s owner, so it can sign Chief in');
  assert.equal((await phoneSide.req('POST', '/api/phones/enrol', { key: Buffer.from(keyPair().publicKey).toString('base64') })).status, 403, 'no phone enrols another');
  await phoneSide.req('POST', '/api/bots/chief/messages', { text: 'hello from the cloud phone, Umer' });
  await until('Chief answers on the cloud computer', async () => (await phoneSide.req('GET', '/api/bots/chief')).body.messages?.some((m: any) => m.author === 'bot' && m.text.includes('hello from the cloud phone, Umer')), 30_000);

  // Restart: the same grant still reaches Chief, and another phone's key is refused, since the binding is kept.
  link.stop(); await stop(); boot();
  await until('the runner is ready again', () => log.includes('headless host ready'), 60_000);
  phoneSide = dial(grant); link = phoneSide.l;
  assert.equal((await phoneSide.req('GET', '/api/phones')).body.length, 1);
  writeFileSync(join(cloud, 'inbox/phone.bin'), keyPair().publicKey);
  await until('a second phone is refused', () => /already has an owner phone/.test(log), 10_000);
  assert.equal(existsSync(join(dir, 'ts-called')), false, 'the cloud computer never needs Tailscale');
});
