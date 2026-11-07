// A failed command says the real cause and one next line, at once, and never a stack trace or the private link.
// Each case is the real command on a real broken machine: a throwaway HOME in product mode, with no account or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
    CREWHOUSE_RUN_MODE: 'product', CREWHOUSE_NPM_HOME: app, CREWHOUSE_STATE_DIR: state, CREWHOUSE_CREW_DIR: join(home, 'Crewhouse'), CREWHOUSE_TOOLS_DIR: join(home, '.local/share/crewhouse/tools'), CREWHOUSE_ENGINE_DIR: join(root, 'engine'), CREWHOUSE_PORT: String(await freePort()), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_CALLBACK_PORT: '0', CREWHOUSE_ONLINE_URL: '', ...extra };
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

// The sign-in folders must be the person's alone, and a default Ubuntu login's umask (002) makes every new folder group-writable.
test('doctor reports a group-writable ~/.local in plain words, read-only; the next start closes it to the group and says so', { timeout: 60_000 }, async () => {
  const m = await machine(), open = [join(m.home, '.local'), dirname(m.state)];
  for (const dir of open) chmodSync(dir, 0o775);
  const doctor = await m.run('doctor');
  assert.equal(doctor.code, 1, doctor.out);
  assert.match(doctor.out, /✗ Engine: The folder your sign-ins would be kept in is not private to you/);
  assert.match(doctor.out, /next: sudo chown "\$\(id -un\)" .*&& chmod go-w .* && crewhouse start/);
  assert.match(doctor.out, /Tool kit/, 'the rest of the report still runs');
  noTrace(doctor.out);
  assert.equal(statSync(dirname(m.state)).mode & 0o777, 0o775, 'doctor only looks');
  const stub = await machine({ CREWHOUSE_ENGINE: 'stub' });
  for (const dir of [join(stub.home, '.local'), dirname(stub.state)]) chmodSync(dir, 0o775);
  const start = await stub.run('start');
  try {
    assert.equal(start.code, 0, start.out);
    assert.match(start.out, new RegExp(`Only you can write to ${dirname(stub.state)} now\\. It was 775; chmod 775 ${dirname(stub.state)} puts it back\\.`));
    assert.equal(statSync(dirname(stub.state)).mode & 0o777, 0o755);
    assert.equal((await stub.run('start')).out.includes('Only you can write'), false, 'said once');
  } finally { await stub.run('stop'); }
});

test('on a machine with no screen, start and open print the ssh step; only open --link prints the private link, with its warning', { timeout: 60_000 }, async () => {
  const m = await machine({ CREWHOUSE_ENGINE: 'stub', CREWHOUSE_CALLBACK_PORT: '1455', SSH_CONNECTION: '203.0.113.9 50000 192.0.2.7 22' });
  const key = () => readFileSync(join(m.state, 'person.key'), 'utf8');
  const off = await m.run('open');
  assert.equal(off.code, 1, off.out);
  assert.match(off.out, /Crewhouse is not running\. Start it with crewhouse start\./);
  const up = await m.run('start');
  assert.equal(up.code, 0, up.out);
  try {
    const port = Number(m.env.CREWHOUSE_PORT), far = port + 10000;
    const forward = (l: number, r: number) => `-L 127.0.0.1:${l}:127.0.0.1:${r}`;
    const stop = 'ssh -N -o ExitOnForwardFailure=yes';
    const said = (out: string) => {
      assert.match(out, new RegExp(`${stop} ${forward(port, port)} ${forward(1455, 1455)} \\S+@192\\.0\\.2\\.7\\n`), 'the line, with explicit loopback binds');
      assert.match(out, new RegExp(`${stop} ${forward(far, port)} ${forward(1455, 1455)} \\S+@192`), 'the fallback line for a taken ' + port);
      assert.match(out, new RegExp(`${stop} ${forward(port, port)} \\S+@192\\.0\\.2\\.7\\n?$`, 'm'), 'the line without 1455');
      assert.match(out, /If it says so for 1455, your own computer already uses 1455, usually a ChatGPT sign-in left open/);
      assert.match(out, /crewhouse open --link/);
      assert.ok(!out.includes(key()), 'the private key is not in the words');
      assert.doesNotMatch(out, /#person=/);
      noTrace(out);
    };
    said(up.out);
    const open = await m.run('open');
    assert.equal(open.code, 0, open.out);
    said(open.out);
    const link = await m.run('open', '--link');
    assert.equal(link.code, 0, link.out);
    assert.match(link.out, /Keep this link private\./);
    assert.ok(link.out.includes(`http://127.0.0.1:${port}/#person=${key()}`), 'the link, once');
    assert.ok(link.out.indexOf('Keep this link private') < link.out.indexOf('#person='), 'the warning comes first');
    const bad = await m.run('open', '--nope');
    assert.equal(bad.code, 2, bad.out);
  } finally {
    const stop = await m.run('stop');
    assert.match(stop.out, /Crewhouse stopped/);
    await until('the port to free', async () => { const s = await listen(Number(m.env.CREWHOUSE_PORT)).catch(() => null); s?.close(); return !!s; });
  }
});

test('on a machine with a screen but no browser program, open still names the address and never the private link', { timeout: 60_000 }, async () => {
  const m = await machine({ CREWHOUSE_ENGINE: 'stub', DISPLAY: ':0' });
  assert.equal((await m.run('start')).code, 0);
  try {
    const { code, out } = await m.run('open');
    assert.equal(code, 0, out);
    assert.match(out, /Open http:\/\/127\.0\.0\.1:\d+\/ in your browser\./);
    assert.doesNotMatch(out, /#person=|ssh -N/);
    assert.ok(!out.includes(readFileSync(join(m.state, 'person.key'), 'utf8')));
  } finally {
    await m.run('stop');
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

// doctor must not say "ready" on a machine that cannot run Crewhouse, and must not crash on one: each break is made on a
// healthy machine, one at a time, and the same doctor is asked. Exit 1, a ✗ line with the cause, one fix line, no stack trace.
type Machine = Awaited<ReturnType<typeof machine>>;
const breaks: [string, (m: Machine) => Promise<() => unknown> | (() => unknown) | void, RegExp, RegExp][] = [
  ['a port another program holds', async (m) => { const s = await listen(Number(m.env.CREWHOUSE_PORT)); return () => s.close(); }, /✗ Port \d+ — Another program is already using port \d+/, /fix: close that program, or pick a free port: CREWHOUSE_PORT=<port> crewhouse start/],
  ['a corrupt database', (m) => { writeFileSync(join(m.state, 'crew.db'), Buffer.alloc(65536, 7)); }, /✗ Database — .*crew\.db is damaged \(file is not a database\); it has not been changed/, /fix: crewhouse triage moves it aside after you say yes, and keeps it/],
  ['an engine folder that is gone', (m) => { writeFileSync(join(m.state, 'person.key'), 'k'); }, /✗ AI engine folder — .*openclaw is gone, and the AI sign-ins that were in it/, /fix: crewhouse start builds a new one; then sign in again/],
  ['no internet', async (m) => { m.env.CREWHOUSE_ONLINE_URL = `http://127.0.0.1:${await freePort()}`; }, /✗ Internet — this computer cannot reach 127\.0\.0\.1:\d+ \(ECONNREFUSED\)/, /fix: check its network connection/],
];
for (const [name, breakIt, cause, fix] of breaks) test(`doctor does not say ready on ${name}`, { timeout: 60_000 }, async () => {
  const m = await machine({ CREWHOUSE_ENGINE: name.includes('engine') ? undefined : 'stub' });
  assert.equal((await m.run('doctor')).code, 0, 'the same machine unbroken is ready');
  const undo = await breakIt(m);
  const { code, out } = await m.run('doctor');
  undo?.();
  assert.equal(code, 1, out);
  assert.match(out, cause); assert.match(out, fix);
  assert.doesNotMatch(out, /Crewhouse is ready/);
  assert.match(out, /1 thing\(s\) stop Crewhouse running/);
  noTrace(out);
  if (name === 'a corrupt database') assert.deepEqual(readFileSync(join(m.state, 'crew.db')), Buffer.alloc(65536, 7), 'doctor only looks');
});

test('doctor names the app files that are gone, and the line that brings them back, instead of crashing', { timeout: 60_000 }, async () => {
  const m = await machine({ CREWHOUSE_ENGINE: 'stub' }), app = join(m.home, 'damaged');
  for (const f of ['crewhouse', 'bin', 'src', 'package.json', 'tools', 'tsconfig.json']) cpSync(join(repo, f), join(app, f), { recursive: true }); // the program files without node_modules
  const run = spawnSync('bash', [join(app, 'crewhouse'), 'doctor'], { cwd: app, env: m.env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /✗ Crewhouse's own program files — some are missing \(Cannot find package '[^']+'\), so this install is damaged\n    fix: npm ci/);
  noTrace(run.stdout + run.stderr);
});

// `crewhouse triage` repairs what stops Crewhouse starting, on Node alone, and keeps to its four rules.
const KEY_FILE = 'person.key';
test('triage moves a damaged database aside only after a yes, keeps it whole, and Crewhouse starts again with the crew folders as they were', { timeout: 120_000 }, async () => {
  const m = await machine({ CREWHOUSE_ENGINE: 'stub' });
  assert.equal((await m.run('start')).code, 0); await m.run('stop');
  const key = readFileSync(join(m.state, KEY_FILE), 'utf8').trim(), soul = join(m.home, 'Crewhouse/bots/chief/soul.md'), soulBefore = readFileSync(soul);
  const junk = Buffer.alloc(65536, 7); rmSync(join(m.state, 'crew.db-wal'), { force: true }); rmSync(join(m.state, 'crew.db-shm'), { force: true }); writeFileSync(join(m.state, 'crew.db'), junk);
  const unanswered = await m.run('triage');
  assert.equal(unanswered.code, 1, unanswered.out);
  assert.match(unanswered.out, /Needs a yes: The database \(crew\.db\) is damaged\. Move it aside and start with a new one\?/);
  assert.deepEqual(readFileSync(join(m.state, 'crew.db')), junk, 'nothing moves without a yes');
  const yes = await m.run('triage', '--yes');
  assert.equal(yes.code, 0, yes.out);
  const kept = /It is kept at (\S+crew\.db\.damaged-\d+)\./.exec(yes.out)?.[1] ?? assert.fail(yes.out);
  assert.deepEqual(readFileSync(kept), junk, 'the damaged file is kept whole');
  assert.equal(existsSync(join(m.state, 'crew.db')), false);
  for (const out of [unanswered.out, yes.out]) { assert.ok(!out.includes(key), 'no key in any output'); noTrace(out); }
  const start = await m.run('start');
  try {
    assert.equal(start.code, 0, start.out);
    assert.deepEqual(readFileSync(soul), soulBefore, "Chief's folder is taken back as it was");
    assert.equal((await m.run('triage')).out.trim().split('\n').at(-1)?.startsWith('Nothing needed repairing'), true, 'a healthy machine needs nothing');
  } finally { await m.run('stop'); }
});

test('triage fixes what is its own and touches nothing else: folder permissions, a leftover record, never a process it cannot prove is Crewhouse', { timeout: 60_000 }, async () => {
  const m = await machine({ CREWHOUSE_ENGINE: 'stub' });
  chmodSync(dirname(m.state), 0o775);
  const stranger = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(join(m.state, 'crewd.pid'), String(stranger.pid)); writeFileSync(join(m.state, 'endpoint'), 'http://127.0.0.1:1');
  writeFileSync(join(m.state, 'crew.db'), 'not a database but not ours to judge here'); chmodSync(join(m.state, 'crew.db'), 0o600);
  try {
    const r = await m.run('triage');
    assert.match(r.out, /Fixed: Only you can write to .* now\. It was 775/);
    assert.match(r.out, /Fixed: removed the leftover record of a Crewhouse that is no longer running\./);
    assert.equal(statSync(dirname(m.state)).mode & 0o022, 0);
    assert.equal(existsSync(join(m.state, 'crewd.pid')), false);
    assert.equal(stranger.exitCode, null, 'a process that is not Crewhouse is never signalled');
    assert.doesNotThrow(() => process.kill(stranger.pid!, 0));
    assert.equal(readFileSync(join(m.state, 'crew.db'), 'utf8').startsWith('not a database'), true, 'asked first, so untouched');
  } finally { stranger.kill(); }
});

test('triage asks before keeping Crewhouse running after logout, and says when a machine refuses', { timeout: 60_000 }, async () => {
  const log = join(temp('triage-linger'), 'loginctl.log');
  const m = await machine({ CREWHOUSE_ENGINE: 'stub', USER: 'tester' });
  mkdirSync(dirname(log), { recursive: true });
  writeFileSync(join(m.env.PATH!, 'loginctl'), `#!/bin/bash\ncase $1 in show-user) echo no ;; enable-linger) echo "$@" >> ${log}; [ ! -e ${log}.refuse ] || exit 1 ;; esac\n`, { mode: 0o755 });
  mkdirSync(join(m.home, '.config/systemd/user'), { recursive: true }); writeFileSync(join(m.home, '.config/systemd/user/crewhouse.service'), '[Service]\n');
  const unanswered = await m.run('triage');
  assert.equal(unanswered.code, 1, unanswered.out); assert.match(unanswered.out, /Needs a yes: Crewhouse starts when you log in but stops when you log out/);
  assert.equal(existsSync(log), false, 'not turned on without a yes');
  const yes = await m.run('triage', '--yes');
  assert.equal(yes.code, 0, yes.out); assert.match(yes.out, /Fixed: Crewhouse keeps running after you log out/);
  assert.equal(readFileSync(log, 'utf8').trim(), 'enable-linger tester');
  writeFileSync(`${log}.refuse`, '');
  const refused = await m.run('triage', '--yes');
  assert.equal(refused.code, 1, refused.out); assert.match(refused.out, /Ask an administrator to run: sudo loginctl enable-linger tester/);
});
