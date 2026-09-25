// The downloaded app's own behaviour in crewd: a newer release is offered to the owner only, from the project's release
// list (a local stand-in here; nothing leaves the machine), and the words for it are plain.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('a newer release is offered to the owner in words, never to anyone else, and nothing when it is not newer', async () => {
  let s: any;
  for (let i = 0; i < 50 && !(s = await state()).update; i++) await sleep(100);
  assert.deepEqual(s.update, { version: '99.0.0', url: 'https://github.com/umeranjum17/crewhouse/releases/tag/v99.0.0' });
  assert.deepEqual(s.installing, [], 'not the downloaded app: nothing installs by itself');
  assert.equal(A.update(s)!.words, 'A new Crewhouse is ready (99.0.0). Download it and open it, and the crew carries on where it was.');
  await fetch(`${base}/api/people`, { method: 'POST', headers: { 'x-crewhouse': '1', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sara' }) });
  assert.equal((await state(2)).update, undefined, 'only the owner sees it');

  daemon.kill();
  await new Promise((r) => daemon.once('exit', r));
  tag = `v${ours}`;
  daemon = start();
  await sleep(300);
  assert.equal((await state()).update, undefined, 'the same version is not an update');
});

test('the downloaded app\'s words: tools getting ready, and Google in steps on Google\'s own pages', () => {
  assert.equal(A.gettingReady({ installing: [] }), '');
  assert.match(A.gettingReady({ installing: ['browser', 'documents'] }), /helpers' own web browser ready/);
  assert.equal(A.update({}), null);
  for (const s of A.GOOGLE_STEPS) assert.match(s.url, /^https:\/\/console\.cloud\.google\.com\//);
  assert.equal(A.GOOGLE_STEPS.length, 4);
});

test('the downloaded app keeps answering while it fetches the helpers\' tools on its first run', async () => {
  // A fake npm (and pip, and download) that takes eight seconds, so an install is certainly still running.
  const bin = join(root, 'slow-bin');
  mkdirSync(bin, { recursive: true });
  for (const b of ['npm', 'npx', 'python3', 'curl']) { writeFileSync(join(bin, b), `#!/bin/sh\nenv > '${join(root, 'install-env')}'\nsleep 8\nexit 1\n`); chmodSync(join(bin, b), 0o755); }
  const p2 = await free();
  const first = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, XDG_DATA_HOME: join(root, 'owner-data'), WAYLAND_DISPLAY: 'wayland-owner', CREWHOUSE_PACKAGED: '1', CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(p2), CREWHOUSE_LINK_PORT: '0',
      CREWHOUSE_STATE_DIR: join(root, 'first', 'state'), CREWHOUSE_CREW_DIR: join(root, 'first', 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'first', 'tools') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  after(() => first.kill());
  let s: any = null;
  for (let i = 0; i < 100 && !s?.installing?.length; i++) {
    const r = await fetch(`http://127.0.0.1:${p2}/api/state`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (r?.ok) s = await r.json(); else await sleep(100);
  }
  assert.ok(s?.installing?.length, 'an install is under way');
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${p2}/api/state`, { signal: AbortSignal.timeout(2000) });
  assert.ok(r.ok && Date.now() - t0 < 1000, 'and crewd answers at once meanwhile');
  assert.match(A.gettingReady(await r.json()), /getting|Getting/);
  for (let i = 0; i < 50 && !existsSync(join(root, 'install-env')); i++) await sleep(100);
  const env = readFileSync(join(root, 'install-env'), 'utf8');
  assert.doesNotMatch(env, /^(XDG_|WAYLAND_DISPLAY=)/m, 'the installers see none of the owner\'s desktop session');
  assert.match(env, new RegExp(`^CREWHOUSE_TOOLS_DIR=${join(root, 'first', 'tools')}$`, 'm'));
});
