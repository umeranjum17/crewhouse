// A failed command says the real cause and one next line, at once, and never a stack trace or the private link.
// Each case is the real command on a real broken machine: a throwaway HOME in product mode, with no account or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { dirname, join } from 'node:path';
import { temp } from './tmp.ts';
import { until } from './lab.ts';

const repo = join(import.meta.dirname, '..'), { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const listen = (port = 0) => new Promise<Server>((r) => { const s = createServer().listen(port, '127.0.0.1', () => r(s)); });
const portOf = (s: Server) => (s.address() as { port: number }).port;
const freePort = async () => { const s = await listen(), port = portOf(s); await new Promise((r) => s.close(r)); return port; };

/** A person's machine: its own HOME, a PATH with only what the launcher needs (so no browser and no Tailscale), and a first-run already behind it. */
let machines = 0;
async function machine(extra: NodeJS.ProcessEnv = {}) {
  const root = temp(`failure-words-${++machines}`), home = join(root, 'home'), bin = join(root, 'bin'), state = join(home, '.local/state/crewhouse');
  const app = join(home, '.local/share/crewhouse/app', version, 'node_modules/crewhouse');
  mkdirSync(state, { recursive: true }); mkdirSync(app, { recursive: true }); mkdirSync(bin);
  for (const c of ['bash', 'sed', 'cat', 'grep', 'tr', 'readlink', 'dirname', 'sleep', 'seq', 'date', 'env']) symlinkSync(spawnSync('bash', ['-c', `command -v ${c}`], { encoding: 'utf8' }).stdout.trim(), join(bin, c));
  symlinkSync(process.execPath, join(bin, 'node'));
  writeFileSync(join(state, 'npm-ready'), '');
  const env: NodeJS.ProcessEnv = { PATH: bin, LANG: 'C.UTF-8', HOME: home, TMPDIR: root, XDG_RUNTIME_DIR: join(root, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, 'no-bus')}`,
    CREWHOUSE_RUN_MODE: 'product', CREWHOUSE_NPM_HOME: app, CREWHOUSE_STATE_DIR: state, CREWHOUSE_CREW_DIR: join(home, 'Crewhouse'), CREWHOUSE_TOOLS_DIR: join(home, '.local/share/crewhouse/tools'), CREWHOUSE_ENGINE_DIR: join(root, 'engine'), CREWHOUSE_PORT: String(await freePort()), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_CALLBACK_PORT: '0', ...extra };
  /** The installed command, as a person types it; resolves on exit, with how long it took. */
  const run = (...args: string[]) => new Promise<{ code: number | null; out: string; ms: number }>((resolve) => {
    const started = Date.now(), child = spawn(process.execPath, [join(repo, 'bin/crewhouse.mjs'), ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => out += d); child.stderr.on('data', (d) => out += d);
    child.once('close', (code) => resolve({ code, out, ms: Date.now() - started }));
  });
  return { home, state, env, run };
}
const noTrace = (out: string) => assert.doesNotMatch(out, /^\s+at .+[:(]|Node\.js v\d/m, 'no stack trace reaches the person');

for (const [name, breakIt, cause, next] of [
  ['a port held by another program that never answers', async (m: Awaited<ReturnType<typeof machine>>) => { assert.equal((await m.run('start')).code, 0); await m.run('stop'); const s = await listen(Number(m.env.CREWHOUSE_PORT)); return () => s.close(); }, /Another program is already using port \d+/, /Next: close that program/],
  ['a data folder it may not write to', async (m: Awaited<ReturnType<typeof machine>>) => { chmodSync(m.state, 0o555); return () => chmodSync(m.state, 0o755); }, /not allowed to write to .*crewhouse/, /Next: give that folder back to your account/],
] as const) test(`start stops at once on ${name}, with the cause and one next line`, { timeout: 60_000 }, async () => {
  const m = await machine({ CREWHOUSE_ENGINE: 'stub' }), undo = await breakIt(m);
  const { code, out, ms } = await m.run('start');
  undo();
  assert.equal(code, 1, out);
  assert.match(out, /^Crewhouse did not start: /m);
  assert.match(out, cause); assert.match(out, next);
  noTrace(out);
  assert.ok(ms < 45_000, `said why in ${ms} ms, not after the two-minute wait`);
});

// pick 0 (BYOKit) relaxes this check; when that pin lands, this case and KNOWN's first line go together.
test('a group-writable ~/.local stops start at once, and doctor reports it instead of crashing', { timeout: 60_000 }, async () => {
  const m = await machine();
  for (const dir of [join(m.home, '.local'), dirname(m.state)]) chmodSync(dir, 0o775);
  const doctor = await m.run('doctor');
  assert.equal(doctor.code, 1, doctor.out);
  assert.match(doctor.out, /✗ Engine: A folder your sign-ins would sit under/);
  assert.match(doctor.out, /next: mkdir -p ~\/\.local\/state && chmod g-w ~\/\.local ~\/\.local\/state && crewhouse start/);
  assert.match(doctor.out, /Tool kit/, 'the rest of the report still runs');
  noTrace(doctor.out);
  const start = await m.run('start');
  assert.equal(start.code, 1, start.out);
  noTrace(start.out);
  assert.ok(start.ms < 45_000, `said why in ${start.ms} ms`);
  // The printed line is the fix: typed as it stands, the next doctor no longer finds it. (Starting the real engine after it is scripts/verify/failure-words.sh.)
  const line = start.out.match(/^Next: (.+) && crewhouse start$/m)?.[1] ?? assert.fail(start.out);
  assert.equal(spawnSync('sh', ['-c', line], { env: { HOME: m.home, PATH: process.env.PATH } }).status, 0);
  assert.match((await m.run('doctor')).out, /✓ Engine: OpenClaw/);
});

test('open on a machine with no browser never prints the private link, and says when Crewhouse is not running', { timeout: 60_000 }, async () => {
  const m = await machine({ CREWHOUSE_ENGINE: 'stub' });
  const off = await m.run('open');
  assert.equal(off.code, 1, off.out);
  assert.match(off.out, /Crewhouse is not running\. Start it with crewhouse start\./);
  const up = await m.run('start');
  assert.equal(up.code, 0, up.out);
  try {
    const { code, out } = await m.run('open');
    assert.equal(code, 0, out);
    assert.match(out, /Open http:\/\/127\.0\.0\.1:\d+\/ in your browser\./);
    assert.ok(!out.includes(readFileSync(join(m.state, 'person.key'), 'utf8')), 'the private key is not in the words');
    assert.doesNotMatch(out, /#person=/);
    noTrace(out);
  } finally {
    const stop = await m.run('stop');
    assert.match(stop.out, /Crewhouse stopped/);
    await until('the port to free', async () => { const s = await listen(Number(m.env.CREWHOUSE_PORT)).catch(() => null); s?.close(); return !!s; });
  }
});

test('headless setup with no Tailscale names both ways on', { timeout: 60_000 }, async () => {
  const m = await machine({ CREWHOUSE_ENGINE: 'stub' });
  const { code, out } = await m.run('setup', '--headless', '--install-only');
  assert.equal(code, 1, out);
  assert.match(out, /Tailscale is not installed, and a phone needs a way to reach it/);
  assert.match(out, /Next: run CREWHOUSE_RELAY_PUBLIC=https:\/\/<your-relay-host> crewhouse setup --headless/);
  assert.match(out, /or install Tailscale and sign in/);
  noTrace(out);
});
