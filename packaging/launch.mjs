// Crewhouse, opened like any other app: start crewd if it isn't running, then show it in its own window. The installed
// package runs this from the app menu (packaging/crewhouse.desktop); nobody types anything.
// First run also makes crewd start by itself at login (a systemd user service), so after a reboot it is simply there.
//   --no-open   start and wait, but open no window (tests)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const root = dirname(new URL(import.meta.url).pathname); // /opt/crewhouse
const node = join(root, 'node', 'bin', 'node');
const app = join(root, 'app');
const url = `http://127.0.0.1:${process.env.CREWHOUSE_PORT || 7711}`;
// The helpers' tools install with the bundled npm, so it goes first on the PATH crewd and its tools see.
const env = { ...process.env, PATH: `${join(root, 'node', 'bin')}:${process.env.PATH ?? ''}`, CREWHOUSE_PACKAGED: process.env.CREWHOUSE_PACKAGED ?? '1' };

const up = () => fetch(`${url}/api/state`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
// CREWHOUSE_NO_SERVICE=1 (tests): never touch the login services of whoever runs this.
const systemd = () => !process.env.CREWHOUSE_NO_SERVICE && spawnSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' }).status === 0;

function service() {
  const unit = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', 'crewhouse.service');
  const vars = Object.entries(env).filter(([k]) => k.startsWith('CREWHOUSE_')).map(([k, v]) => `Environment=${k}=${v}`).join('\n');
  mkdirSync(dirname(unit), { recursive: true });
  writeFileSync(unit, `[Unit]\nDescription=Crewhouse\nAfter=network-online.target\n\n[Service]\nWorkingDirectory=${app}\n` +
    `Environment=PATH=${env.PATH}\n${vars}\nExecStart=${node} src/main.ts\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n`);
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  return spawnSync('systemctl', ['--user', 'enable', '--now', 'crewhouse.service'], { stdio: 'ignore' }).status === 0;
}

if (!(await up())) {
  // A login service where the desktop has one; otherwise crewd runs on its own until the computer restarts.
  if (!(systemd() && service())) {
    const log = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'crewhouse');
    mkdirSync(log, { recursive: true });
    const out = openSync(join(log, 'crewd.log'), 'a');
    spawn(node, ['src/main.ts'], { cwd: app, env, detached: true, stdio: ['ignore', out, out] }).unref();
  }
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up())) { console.error(`Crewhouse didn't start; see ~/.local/state/crewhouse/crewd.log`); process.exit(1); }
}

if (!process.argv.includes('--no-open')) {
  // Its own window where a Chromium-family browser is installed; the default browser otherwise.
  const apps = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'brave-browser', 'microsoft-edge'];
  const found = apps.find((b) => (process.env.PATH ?? '').split(':').some((d) => existsSync(join(d, b))));
  const [cmd, args] = found ? [found, [`--app=${url}`, '--class=Crewhouse']] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}
