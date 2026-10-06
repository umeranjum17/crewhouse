import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const prefix = 'crewhouse-test-';
const rootPrefix = 'cw-test-'; // leave room for Unix socket paths beneath an on-disk TMPDIR
// Chromium binds $TMPDIR/org.chromium.Chromium.XXXXXX/SingletonSocket, and a Unix socket path past the kernel's 108
// bytes is a FATAL abort that kills every browser the suite starts. Our own tree spends the bytes below, so a deep
// caller TMPDIR (a task scratch dir) cannot be the base however private it is: /tmp always has the room.
const spent = `/${rootPrefix}${process.pid}-XXXXXX/tmp/org.chromium.Chromium.XXXXXX/SingletonSocket`.length;
const base = tmpdir().length + spent < 108 ? tmpdir() : '/tmp';
if (base !== tmpdir()) console.error(`TMPDIR ${tmpdir()} leaves no room for a browser's socket path: testing under ${base}`);
for (const name of readdirSync(base).filter((name) => name.startsWith(rootPrefix))) {
  const pid = Number(name.slice(rootPrefix.length).split('-')[0]);
  if (!Number.isInteger(pid) || pid <= 0) continue;
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') rmSync(join(base, name), { recursive: true, force: true }); }
}
const root = mkdtempSync(join(base, `${rootPrefix}${process.pid}-`));
mkdirSync(join(root, 'home'));
mkdirSync(join(root, 'tmp'));
const scratch = join(root, 'tmp');
const env = { ...process.env, HOME: join(root, 'home'), TMPDIR: scratch,
  XDG_STATE_HOME: join(root, 'state'), XDG_DATA_HOME: join(root, 'data'), XDG_CONFIG_HOME: join(root, 'config'),
  XDG_CACHE_HOME: join(root, 'cache'), XDG_RUNTIME_DIR: join(root, 'runtime'),
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, 'no-bus')}` }; // the kit provisions its own isolated host key
for (const name of ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'GNOME_KEYRING_CONTROL', 'CREWHOUSE_AUTH_KEY_FILE']) delete env[name];
const before = new Set(readdirSync(scratch));
const cleanup = () => rmSync(root, { recursive: true, force: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanup(); process.kill(process.pid, signal); });
const files = readdirSync('test').filter((name) => name.endsWith('.test.ts')).map((name) => join('test', name));
// Serial files: a file that builds a real gateway (`new OpenClawRuntime`) starves past its timeouts when it
// overlaps another gateway boot, so those files run one at a time. Everything else only needs its own process
// (OS-assigned ports, per-process temp dirs) and runs alongside, three at a time on the runner's four cores.
// Ubuntu CI bounds each file's whole process group: 295 seconds plus five to stop its children.
const bounded = process.env.CI === 'true' && process.platform === 'linux';
const LIGHT_CONCURRENCY = 3;
const isGateway = (file) => readFileSync(file, 'utf8').includes('new OpenClawRuntime');
const runOne = (file) => new Promise((resolve) => {
  const t0 = Date.now();
  const child = spawn(bounded ? 'timeout' : process.execPath,
    [...(bounded ? ['--kill-after=5s', '295s', process.execPath] : []), '--test', '--test-concurrency=1', file],
    { env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('error', (error) => resolve({ file, status: 1, secs: (Date.now() - t0) / 1000, out: `${out}${String(error)}\n` }));
  child.on('close', (status) => resolve({ file, status: status ?? 1, secs: (Date.now() - t0) / 1000, out }));
});
const timed = async (file) => {
  const r = await runOne(file);
  results.push(r);
  console.log(`### done ${file} (${r.secs.toFixed(1)}s, exit ${r.status})\n${r.out}`);
};
const results = [];
if (!bounded) {
  results.push(spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env }));
} else {
  const serial = files.filter(isGateway);
  const pool = files.filter((file) => !isGateway(file));
  console.log(`### lanes: serial gateway [${serial.join(', ')}], ${pool.length} files across ${LIGHT_CONCURRENCY} parallel lanes`);
  const serialRun = (async () => { for (const file of serial) await timed(file); })();
  const lightRun = Promise.all(Array.from({ length: LIGHT_CONCURRENCY }, async () => {
    for (;;) {
      const file = pool.shift();
      if (!file) return;
      await timed(file);
    }
  }));
  await Promise.all([serialRun, lightRun]);
  console.log('### per-file wall time (slowest first):');
  for (const r of [...results].sort((a, b) => b.secs - a.secs)) console.log(`###   ${r.secs.toFixed(1)}s exit=${r.status} ${r.file}`);
}
const leaked = readdirSync(scratch).filter((name) => name.startsWith(prefix) && !before.has(name));
cleanup();
if (leaked.length) { console.error(`Test scratch leaked from ${scratch}:\n${leaked.map((name) => `  ${join(scratch, name)}`).join('\n')}`); process.exitCode = 1; }
for (const result of results) {
  if (result.error) throw result.error;
  process.exitCode ||= result.status ?? 1;
}
