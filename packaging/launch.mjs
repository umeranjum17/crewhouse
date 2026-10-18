// Crewhouse, opened like any other app: start crewd if it isn't running, then show it in its own window. The installed
// package runs this from the app menu (packaging/crewhouse.desktop); nobody types anything.
// First run also makes crewd start by itself at login (a systemd user service), so after a reboot it is simply there.
//   --no-open   start and wait, but open no window (tests)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { trouble } from './trouble.mjs';

process.env.CREWHOUSE_RUN_MODE ??= 'product';
const root = dirname(new URL(import.meta.url).pathname); // /opt/crewhouse
const node = join(root, 'node', 'bin', 'node');
const app = join(root, 'app');
const { isolatedRun, loadConfig } = await import(join(app, 'src', 'config.ts'));
const cfg = loadConfig(), stateDir = cfg.stateDir, keyFile = join(stateDir, 'person.key');
let url = `http://127.0.0.1:${cfg.port}`;
// Capture config's private run home too, so a launcher and its child use the same crew.
const env = { ...process.env, PATH: `${join(root, 'node', 'bin')}:${process.env.PATH ?? ''}`, CREWHOUSE_PACKAGED: process.env.CREWHOUSE_PACKAGED ?? '1' };
// Liveness only: crewd's own gate 403 (or an older 200), never another program's 403.
const up = async () => {
  if (!cfg.port) { if (!existsSync(join(stateDir, 'endpoint'))) return false; url = readFileSync(join(stateDir, 'endpoint'), 'utf8').trim(); }
  return fetch(`${url}/api/state`, { signal: AbortSignal.timeout(1500) })
    .then(async (r) => r.ok || (r.status === 403 && (await r.json().catch(() => ({})))?.code === 'no-authority'), () => false);
};
const systemd = () => !process.env.CREWHOUSE_NO_SERVICE && !isolatedRun(cfg.engine) && spawnSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' }).status === 0;

function service() {
  const unit = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', 'crewhouse.service');
  const vars = Object.entries(env).filter(([k]) => k.startsWith('CREWHOUSE_')).map(([k, v]) => `Environment=${k}=${v}`).join('\n');
  mkdirSync(dirname(unit), { recursive: true });
  // The same crewd.log as the no-service path: the marks a first run is timed by are in one file either way.
  const out = join(stateDir, 'crewd.log');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(unit, `[Unit]\nDescription=Crewhouse\nAfter=network-online.target\n\n[Service]\nWorkingDirectory=${app}\n` +
    `Environment=PATH=${env.PATH}\n${vars}\nExecStart=${node} src/main.ts\nStandardOutput=append:${out}\nStandardError=append:${out}\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n`);
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  return spawnSync('systemctl', ['--user', 'enable', '--now', 'crewhouse.service'], { stdio: 'ignore' }).status === 0;
}

// Its own window where a Chromium-family browser is installed; the default browser otherwise.
function show(where) {
  const apps = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'brave-browser', 'microsoft-edge'];
  const found = apps.find((b) => (process.env.PATH ?? '').split(':').some((d) => existsSync(join(d, b))));
  const [cmd, args] = found ? [found, [`--app=${where}`, '--class=Crewhouse']] : ['xdg-open', [where]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

let why = 'Crewhouse started, but never answered'; // what actually went wrong, in words the person can act on
if (!(await up())) {
  // A login service where the desktop has one; otherwise crewd runs on its own until the computer restarts.
  if (!(systemd() && service())) {
    const log = stateDir;
    mkdirSync(log, { recursive: true });
    const out = openSync(join(log, 'crewd.log'), 'a');
    // It may not even start (a half-removed install); the wait below then shows the plain screen.
    spawn(node, ['src/main.ts'], { cwd: app, env, detached: true, stdio: ['ignore', out, out] })
      .on('error', () => { why = "Crewhouse's own program could not be started on this computer"; }).unref();
  }
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  // Nothing came up. From the app menu there is no terminal to read a path in, so the person gets a plain screen instead.
  if (!(await up())) {
    if (process.argv.includes('--no-open')) { console.error(`Crewhouse didn't start; see ~/.local/state/crewhouse/crewd.log`); process.exit(1); }
    const page = join(stateDir, 'trouble.html');
    mkdirSync(dirname(page), { recursive: true });
    const key = existsSync(keyFile) ? readFileSync(keyFile, 'utf8') : '';
    rmSync(page, { force: true });
    writeFileSync(page, trouble(why, `${url}${key ? `/#person=${key}` : ''}`), { mode: 0o600 });
    show(`file://${page}`);
    process.exit(1);
  }
}

if (!process.argv.includes('--no-open')) {
  show(existsSync(keyFile) ? `${url}/#person=${readFileSync(keyFile, 'utf8')}` : url);
}
