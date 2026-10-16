import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { testRoot } from './test-root.mjs';

const prefix = 'crewhouse-test-';
const { root, cleanup } = testRoot();
mkdirSync(join(root, 'h'));
mkdirSync(join(root, 'tmp'));
const scratch = join(root, 'tmp');
const env = { ...process.env, HOME: join(root, 'h'), TMPDIR: scratch,
  XDG_STATE_HOME: join(root, 'state'), XDG_DATA_HOME: join(root, 'data'), XDG_CONFIG_HOME: join(root, 'config'),
  XDG_CACHE_HOME: join(root, 'cache'), XDG_RUNTIME_DIR: join(root, 'runtime'),
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, 'no-bus')}` }; // the kit provisions its own isolated host key
for (const name of ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'GNOME_KEYRING_CONTROL', 'CREWHOUSE_AUTH_KEY_FILE']) delete env[name];
const before = new Set(readdirSync(scratch));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanup(); process.kill(process.pid, signal); });
const all = readdirSync('test').filter((name) => name.endsWith('.test.ts')).map((name) => join('test', name));
// CI lanes: a file that builds a real gateway (`new OpenClawRuntime`) starves past its timeouts when it
// overlaps another gateway boot, and a file that drives a real browser (Chromium via browserBin/taskBrowser)
// doubles those boots when it overlaps them — CI 2026-10-06: migrate 150s serial went past its 295s bound
// next to three busy lanes. So gateway files run one at a time, browser files run one at a time, and
// everything else (OS-assigned ports, per-process temp dirs, mostly idle stub holds) runs alongside, two
// at a time. Ubuntu CI bounds each file's whole process group: 295 seconds plus five to stop its children.
const bounded = process.env.CI === 'true' && process.platform === 'linux';
const LIGHT_CONCURRENCY = 2;
// A file that boots a gateway through the shared migrate fixtures counts too: its boots starve the same way.
// The first-words harness builds its gateway in the script, not the test, and starves there as well.
const isGateway = (file) => /new OpenClawRuntime|migrate-house|measure-firstwords/.test(readFileSync(file, 'utf8'));
const isBrowser = (file) => /browserBin|taskBrowser|ownedBrowser|Xvfb/.test(readFileSync(file, 'utf8'));
// `--group=` splits the suite into CI's parallel jobs: the gateway files are most of the wall time (migrate alone is
// ~5 minutes), so they get their own two jobs and the app files a third. No group runs everything, as before.
const group = process.argv.find((a) => a.startsWith('--group='))?.slice('--group='.length);
const GROUPS = { migrate: (f) => isGateway(f) && /migrate/.test(f), engine: (f) => isGateway(f) && !/migrate/.test(f), app: (f) => !isGateway(f) };
if (group && !GROUPS[group]) throw new Error(`unknown test group ${group}: use ${Object.keys(GROUPS).join(', ')}`);
// Named files run alone, under the same throwaway HOME (the pipeline's test step: only the changed parts' files).
const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = named.length ? named : group ? all.filter(GROUPS[group]) : all;
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
const timed = async (file, lane = '') => {
  const r = await runOne(file);
  results.push(r);
  console.log(`### done${lane} ${file} (${r.secs.toFixed(1)}s, exit ${r.status})\n${r.out}`);
};
const results = [];
if (!bounded) {
  results.push(spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env }));
} else {
  const serial = (lane, laneFiles) => (async () => { for (const file of laneFiles) await timed(file, ` [${lane}]`); })();
  const gateway = files.filter(isGateway);
  const browser = files.filter((file) => !isGateway(file) && isBrowser(file));
  const pool = files.filter((file) => !isGateway(file) && !isBrowser(file));
  console.log(`### lanes: serial gateway [${gateway.join(', ')}], serial browser [${browser.join(', ')}], ${pool.length} files across ${LIGHT_CONCURRENCY} parallel lanes`);
  const gatewayRun = serial('gateway', gateway);
  const browserRun = serial('browser', browser);
  const lightRun = Promise.all(Array.from({ length: LIGHT_CONCURRENCY }, async () => {
    for (;;) {
      const file = pool.shift();
      if (!file) return;
      await timed(file);
    }
  }));
  await Promise.all([gatewayRun, browserRun, lightRun]);
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
