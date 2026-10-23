// done-done journey `desktop-first-launch`: the built desktop app (AppImage) opened on a clean home, on the stub engine, timed
// from launch to Chief's first reply, and the engine it resolves is the one the app carries (nothing downloads on first open).
//
//   node scripts/verify/desktop-first-launch.mjs --out "$DONE_DONE_EVIDENCE_ROOT" [--appimage <file>] [--limit <seconds>]
//
// Build first: npm run build:web && npm ci --prefix desktop && node desktop/build.mjs (heavy: through the memory gate).
// The app runs under its own Xvfb, extract-and-run (no FUSE needed), with a throwaway HOME/XDG/TMPDIR and an OS-assigned
// port, never the owner's install. Writes first-launch-desktop.png (the window), first-launch.json (seconds, engine paths) and the step record to --out.
// Exit 0 on a pass, 1 on a failure or a first launch over --limit (default 90), 2 on usage error.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { writeSteps } from './steps.mjs';

const arg = (name) => ((i) => (i < 0 ? null : process.argv[i + 1]))(process.argv.indexOf(name));
const out = arg('--out'), limit = Number(arg('--limit') ?? 90), repo = join(import.meta.dirname, '..', '..');
if (!out) { console.error('usage: desktop-first-launch.mjs --out <evidence-dir> [--appimage <file>] [--limit <seconds>]'); process.exit(2); }
const dist = join(repo, 'dist', 'desktop');
const appimage = arg('--appimage') ?? (existsSync(dist) ? join(dist, readdirSync(dist).find((f) => f.endsWith('.AppImage')) ?? '') : '');
if (!existsSync(appimage) || !appimage.endsWith('.AppImage')) { console.error('desktop-first-launch: no AppImage; build it with node desktop/build.mjs'); process.exit(2); }
mkdirSync(out, { recursive: true });

const lab = mkdtempSync(join(tmpdir(), 'crewhouse-desktop-first-'));
const home = join(lab, 'home'), state = join(lab, 'state'), logPath = join(lab, 'app.log');
for (const d of [home, state, join(lab, 'crew'), join(lab, 'tools'), join(lab, 'run')]) mkdirSync(d, { recursive: true });
const port = await new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const base = `http://127.0.0.1:${port}`, logFd = openSync(logPath, 'w');
const display = [...Array(40).keys()].map((i) => 60 + i).find((n) => !existsSync(`/tmp/.X11-unix/X${n}`));
const started = Date.now(), secs = () => Math.round((Date.now() - started) / 100) / 10;

// One process group for xvfb-run, the app and crewd; every way out ends it and waits until it is empty.
const child = spawn('setpriv', ['--pdeathsig', 'KILL', '--', 'xvfb-run', '-n', String(display), '-s', '-screen 0 1440x900x24 -nolisten tcp', appimage, '--no-sandbox'], {
  detached: true, stdio: ['ignore', logFd, logFd],
  env: {
    PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home, TMPDIR: lab,
    XDG_STATE_HOME: join(home, '.local', 'state'), XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
    XDG_RUNTIME_DIR: join(lab, 'run'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(lab, 'no-bus')}`,
    APPIMAGE_EXTRACT_AND_RUN: '1', CREWHOUSE_NO_SERVICE: '1', CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(port),
    CREWHOUSE_STATE_DIR: state, CREWHOUSE_CREW_DIR: join(lab, 'crew'), CREWHOUSE_TOOLS_DIR: join(lab, 'tools'),
  },
});
const gone = () => { try { process.kill(-child.pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
const drain = async (signal) => {
  try { process.kill(-child.pid, signal); } catch {}
  for (const deadline = Date.now() + 15_000; !gone(); await new Promise((r) => setTimeout(r, 100))) if (Date.now() > deadline) return false;
  return true;
};
const end = async (code, line) => {
  if (!(await drain('SIGTERM')) && !(await drain('SIGKILL'))) { console.error(`desktop-first-launch: process group ${child.pid} would not stop; keeping ${lab}`); process.exit(1); }
  if (code) try { copyFileSync(logPath, join(out, 'app.log')); } catch {}
  rmSync(lab, { recursive: true, force: true });
  (code ? console.error : console.log)(`desktop-first-launch: ${line}`);
  process.exit(code);
};
process.on('uncaughtException', (e) => end(1, e.message));
for (const [signal, n] of [['SIGHUP', 1], ['SIGINT', 2], ['SIGTERM', 15]]) process.on(signal, () => end(128 + n, `stopped by ${signal}`));

let capability = '';
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', ...(capability ? { Authorization: `Bearer ${capability}` } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}`);
  return r.json();
};
const until = async (what, fn, ms) => {
  const stop = Date.now() + ms;
  let last = 'no attempt yet';
  for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { last = e.message; } if (Date.now() > stop) throw new Error(`timed out: ${what} (last: ${last})`); await new Promise((r) => setTimeout(r, 250)); }
};

try {
  const keyFile = join(state, 'person.key');
  await until('the app to start crewd', async () => { capability = existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : ''; return capability && (await call('GET', '/api/state')).person; }, limit * 1000);
  const ready = secs();
  await call('POST', '/api/onboard', { address: 'Sir' });
  await call('POST', '/api/bots/chief/messages', { text: 'Say hello' });
  const reply = await until('Chief to reply', async () => {
    const msgs = (await call('GET', '/api/bots/chief')).messages ?? [];
    return msgs.filter((m) => m.author === 'bot').at(-1)?.text;
  }, limit * 1000);
  const first = secs();
  // One real screen: the app's own window on its own display, once the splash has gone.
  await new Promise((r) => setTimeout(r, 3000));
  execFileSync('import', ['-display', `:${display}`, '-window', 'root', join(out, 'first-launch-desktop.png')]);

  // The engine this app resolves: crewd's own config, read from the folder crewd runs in, on the Node the app carries.
  const pid = execFileSync('pgrep', ['-f', 'src/main.ts', '-n'], { encoding: 'utf8' }).trim();
  const crewdDir = readFileSync(`/proc/${pid}/environ`).length ? execFileSync('readlink', [`/proc/${pid}/cwd`], { encoding: 'utf8' }).trim() : '';
  const bundled = join(crewdDir, 'runtime', 'openclaw');
  const present = ['', '.sets'].map((s) => bundled + s).filter(existsSync);
  const resolved = execFileSync(join(crewdDir, '..', 'node', 'bin', 'node'), ['-e', "import('./src/config.ts').then((m) => console.log(m.loadConfig().engineDir))"],
    { cwd: crewdDir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, CREWHOUSE_RUN_MODE: 'product' } }).trim();
  if (!present.length) throw new Error(`the app carries no engine: ${bundled} is not there`);
  if (resolved !== bundled) throw new Error(`crewd would resolve its engine at ${resolved}, not the app's own ${bundled}`);
  const downloaded = existsSync(join(home, '.local', 'share', 'crewhouse', 'engine')) || existsSync(join(home, '.local', 'share', 'crewhouse', 'engine.sets'));
  if (downloaded) throw new Error('a first open put an engine in the person\'s data folder: it downloaded one');
  if (first > limit) throw new Error(`first launch took ${first} s, over ${limit} s`);
  writeFileSync(join(out, 'first-launch.json'), JSON.stringify({ appimage: appimage.split('/').pop(), crewdReadySeconds: ready, firstReplySeconds: first, limitSeconds: limit, engine: { carried: present.map((p) => p.slice(crewdDir.length + 1)), resolvesTo: 'runtime/openclaw inside the app', downloadedOnFirstOpen: false } }, null, 2) + '\n');
  writeSteps(out, 'desktop-first-launch', { seconds: String(first), reply });
  await end(0, `Chief's first reply ${first} s after launch (limit ${limit} s); the app carries its engine at ${bundled.slice(crewdDir.length + 1)}`);
} catch (e) { await end(1, e.message); }
