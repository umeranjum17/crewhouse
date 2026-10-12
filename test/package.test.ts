// The downloaded app's own behaviour in crewd: a newer release is offered to the owner only, from the project's release
// list (a local stand-in here; nothing leaves the machine), and the words for it are plain.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as http, type Server } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as A from '../web/src/adapter.ts';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-package-'));
const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const ours = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version as string;
let tag = 'v99.0.0';
const releases: Server = http((_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ tag_name: tag, html_url: 'https://github.com/umeranjum17/crewhouse/releases/tag/v99.0.0' })); });
await new Promise<void>((r) => releases.listen(0, '127.0.0.1', r));
const port = await free();
const base = `http://127.0.0.1:${port}`;
const start = () => spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
  env: { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_RELEASES: `http://127.0.0.1:${(releases.address() as AddressInfo).port}/latest`,
    CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
  stdio: ['ignore', 'ignore', 'inherit'],
});
let daemon = start();
after(() => { daemon.kill(); releases.close(); rmSync(root, { recursive: true, force: true }); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function state(member?: number) {
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`${base}/api/state`, { headers: member ? { 'x-crewhouse-member': String(member) } : {} }).catch(() => null);
    if (r?.ok) return r.json();
    await sleep(100);
  }
  throw new Error('crewd did not answer');
}

test('a newer release is offered to the person in words, and nothing when it is not newer', async () => {
  let s: any;
  for (let i = 0; i < 50 && !(s = await state()).update; i++) await sleep(100);
  assert.deepEqual(s.update, { version: '99.0.0', url: 'https://github.com/umeranjum17/crewhouse/releases/tag/v99.0.0' });
  assert.deepEqual(s.installing, [], 'not the downloaded app: nothing installs by itself');
  assert.equal(A.update(s)!.words, 'A new Crewhouse is ready (99.0.0). Download it and open it, and the crew carries on where it was.');

  daemon.kill();
  await new Promise((r) => daemon.once('exit', r));
  tag = `v${ours}`;
  daemon = start();
  assert.equal((await state()).update, undefined, 'the same version is not an update');
});

test("the downloaded app fetches a helper's tools on its first job, not at start, and keeps answering meanwhile", async () => {
  // A fake npm (and pip, and download) that takes eight seconds, so an install is certainly still running.
  const bin = join(root, 'slow-bin');
  mkdirSync(bin, { recursive: true });
  for (const b of ['npm', 'npx', 'python3', 'curl']) { writeFileSync(join(bin, b), `#!/bin/sh\nenv > '${join(root, 'install-env')}'\nsleep 8\nexit 1\n`); chmodSync(join(bin, b), 0o755); }
  const p2 = await free(), at = `http://127.0.0.1:${p2}`, state2 = join(root, 'first', 'state');
  const first = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, XDG_DATA_HOME: join(root, 'owner-data'), WAYLAND_DISPLAY: 'wayland-owner', CREWHOUSE_PACKAGED: '1', CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(p2), CREWHOUSE_LINK_PORT: '0',
      CREWHOUSE_STATE_DIR: state2, CREWHOUSE_CREW_DIR: join(root, 'first', 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'first', 'tools') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  after(() => first.kill());
  const get = async () => { const r = await fetch(`${at}/api/state`, { signal: AbortSignal.timeout(1000) }).catch(() => null); return r?.ok ? r.json() : null; };
  const post = (path: string, body: unknown) => fetch(at + path, { method: 'POST', headers: { authorization: `Bearer ${readFileSync(join(state2, 'person.key'), 'utf8')}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: JSON.stringify(body) }).then((r) => r.json());
  let s: any = null;
  for (let i = 0; i < 100 && !s; i++) if (!(s = await get())) await sleep(100);
  assert.deepEqual(s?.installing, [], 'nothing installs at start: Hello never waits behind a download');
  assert.equal(A.gettingReady(s), '');

  // Scribe's first job is the first use of its browser, its document reader and its writer.
  await post('/api/recruit', { template: 'scribe', name: 'Scribe' });
  const job = (await post('/api/bots/scribe/messages', { text: 'Write me a short note' })).task;
  for (let i = 0; i < 100 && !s?.installing?.length; i++) if (!(s = await get())?.installing?.length) await sleep(100);
  assert.deepEqual([...s.installing].sort(), ['browser', 'documents', 'write'], "the job fetches exactly the tools Scribe was given and doesn't have");
  const t0 = Date.now();
  const r = await fetch(`${at}/api/state`, { signal: AbortSignal.timeout(2000) });
  assert.ok(r.ok && Date.now() - t0 < 1000, 'and crewd answers at once meanwhile');
  assert.match(A.gettingReady(await r.json()), /getting|Getting/);
  const scribe = async () => { const b = await fetch(`${at}/api/bots/scribe`, { signal: AbortSignal.timeout(1000) }).then((x) => x.json()).catch(() => null); return b?.tasks?.find((x: any) => x.id === job); };
  assert.equal((await scribe())?.state, 'queued', 'the job waits for its tools');
  for (let i = 0; i < 100 && !existsSync(join(root, 'install-env')); i++) await sleep(100);
  // The installers run side by side and each re-opens the file with `>` (truncating) before `env` writes, so wait
  // for words in it, not mere existence: a busy CI box reads between the truncate and the write and sees nothing.
  const envFile = join(root, 'install-env');
  let env = '';
  for (let i = 0; i < 100; i++) { if (existsSync(envFile) && (env = readFileSync(envFile, 'utf8'))) break; await sleep(100); }
  assert.doesNotMatch(env, /^(XDG_|WAYLAND_DISPLAY=)/m, 'the installers see none of the owner\'s desktop session');
  assert.match(env, new RegExp(`^CREWHOUSE_TOOLS_DIR=${join(root, 'first', 'tools')}$`, 'm'));
  // The fake installers fail: the job goes on without those tools rather than waiting for ever.
  let t: any;
  for (let i = 0; i < 300 && (t = await scribe())?.state !== 'done'; i++) await sleep(100);
  assert.equal(t?.state, 'done');
  assert.deepEqual((await get()).installing, []);
});

test('a stalled install stops at its bound: its job fails in one line, no installer is left running, and Chief goes on', async () => {
  // Fake installers that record their pid and never finish, with a one-second bound instead of ten minutes.
  const bin = join(root, 'stall-bin'), pids = join(root, 'stall-pids');
  mkdirSync(bin, { recursive: true });
  for (const b of ['npm', 'npx', 'python3', 'curl']) { writeFileSync(join(bin, b), `#!/bin/sh\necho $$ >> '${pids}'\nsleep 600\n`); chmodSync(join(bin, b), 0o755); }
  const p3 = await free(), at = `http://127.0.0.1:${p3}`, state3 = join(root, 'stall', 'state');
  const stalled = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, CREWHOUSE_PACKAGED: '1', CREWHOUSE_ENGINE: 'stub', CREWHOUSE_INSTALL_STALL_MS: '1000', CREWHOUSE_PORT: String(p3), CREWHOUSE_LINK_PORT: '0',
      CREWHOUSE_STATE_DIR: state3, CREWHOUSE_CREW_DIR: join(root, 'stall', 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'stall', 'tools') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  after(() => stalled.kill());
  const post = (path: string, body: unknown) => fetch(at + path, { method: 'POST', headers: { authorization: `Bearer ${readFileSync(join(state3, 'person.key'), 'utf8')}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: JSON.stringify(body) }).then((r) => r.json());
  const taskOf = async (bot: string, id: number) => (await fetch(`${at}/api/bots/${bot}`, { signal: AbortSignal.timeout(1000) }).then((x) => x.json()).catch(() => null))?.tasks?.find((x: any) => x.id === id);
  const running = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 100 && !(await fetch(`${at}/api/state`).catch(() => null))?.ok; i++) await sleep(100);

  await post('/api/recruit', { template: 'scribe', name: 'Scribe' });
  const job = (await post('/api/bots/scribe/messages', { text: 'Write me a short note' })).task;
  const chief = (await post('/api/bots/chief/messages', { text: 'Hello' })).task;
  let c: any;
  for (let i = 0; i < 300 && (c = await taskOf('chief', chief))?.state !== 'done'; i++) await sleep(100);
  assert.equal(c?.state, 'done', 'Chief answers while the install is stalled');
  let t: any;
  for (let i = 0; i < 300 && (t = await taskOf('scribe', job))?.state !== 'failed'; i++) await sleep(100);
  assert.equal(t?.state, 'failed');
  assert.match(t.result, /^.+ took too long to install, so this one stopped\. It will try again next time\.$/);
  for (let i = 0; i < 100 && !existsSync(pids); i++) await sleep(100);
  const installers = readFileSync(pids, 'utf8').trim().split('\n').map(Number);
  assert.ok(installers.length >= 1);
  for (const pid of installers) {
    for (let i = 0; i < 100 && running(pid); i++) await sleep(100);
    assert.equal(running(pid), false, `installer ${pid} was stopped`);
  }
});

test('an unreadable tool manifest fails that job in plain words, and crewd keeps answering', async () => {
  // crewd reads its tool kit from the repo it runs in, so a copy of the code with one manifest cut short.
  const real = join(import.meta.dirname, '..'), repo = join(root, 'broken-repo');
  mkdirSync(repo);
  cpSync(join(real, 'src'), join(repo, 'src'), { recursive: true });
  cpSync(join(real, 'tools'), join(repo, 'tools'), { recursive: true });
  for (const e of readdirSync(real)) if (!['src', 'tools'].includes(e)) symlinkSync(join(real, e), join(repo, e));
  writeFileSync(join(repo, 'tools', 'write', 'tool.json'), '{ "id": ');
  const p4 = await free(), at = `http://127.0.0.1:${p4}`, state4 = join(root, 'broken', 'state');
  const broken = spawn(process.execPath, [join(repo, 'src', 'main.ts')], {
    env: { ...process.env, CREWHOUSE_PACKAGED: '1', CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(p4), CREWHOUSE_LINK_PORT: '0',
      CREWHOUSE_STATE_DIR: state4, CREWHOUSE_CREW_DIR: join(root, 'broken', 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'broken', 'tools') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  after(() => broken.kill());
  const post = (path: string, body: unknown) => fetch(at + path, { method: 'POST', headers: { authorization: `Bearer ${readFileSync(join(state4, 'person.key'), 'utf8')}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: JSON.stringify(body) }).then((r) => r.json());
  for (let i = 0; i < 100 && !(await fetch(`${at}/api/events`).catch(() => null))?.ok; i++) await sleep(100);

  await post('/api/recruit', { template: 'scribe', name: 'Scribe' });
  const job = (await post('/api/bots/scribe/messages', { text: 'Write me a short note' })).task;
  const failed = async () => (await fetch(`${at}/api/events?after=0`, { signal: AbortSignal.timeout(1000) }).then((x) => x.json()).catch(() => [])).find((e: any) => e.kind === 'task.failed' && e.data?.task === job);
  let t: any;
  for (let i = 0; i < 300 && !(t = await failed()); i++) await sleep(100);
  assert.equal(t?.data.result, 'Its tools could not be checked, so this one stopped. Try again in a moment.');
  assert.equal((await fetch(`${at}/api/events`, { signal: AbortSignal.timeout(2000) })).ok, true, 'crewd still answers');
});
