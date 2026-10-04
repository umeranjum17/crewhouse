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
  // The same crewd.log as the no-service path: the marks a first run is timed by are in one file either way.
  const out = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'crewhouse', 'crewd.log');
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
    const log = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'crewhouse');
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
    const page = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'crewhouse', 'trouble.html');
    mkdirSync(dirname(page), { recursive: true });
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crewhouse</title>
<style>
/* The app's own values (web/src/tokens.ts): the same day and night a family sees everywhere else. */
:root{color-scheme:light dark;--bg:#F6F7F9;--surface:#FFF;--ink:#141A2A;--ink2:#4D566B;--mute:#8A92A5;--fill:#F0482A;--line:#E3E6EC}
@media (prefers-color-scheme:dark){:root{--bg:#111014;--surface:#1A191E;--ink:#F1EFEA;--ink2:#ABA7B1;--mute:#78747E;--fill:#FF6A4D;--line:#2A2830}}
body{margin:0;background:var(--bg);color:var(--ink);font:400 15px/1.55 'Inter',system-ui,sans-serif}
main{max-width:34rem;margin:0 auto;padding:12vh 1.5rem 4rem;text-align:center}
h1{font:600 28px/1.2 'Instrument Serif',Georgia,serif;margin:.6rem 0 .8rem}
p{margin:0 0 1rem;color:var(--ink2)}
.lead{font-size:17px}
.why{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:.9rem 1.1rem;color:var(--ink);font-size:14px}
.why b{color:var(--fill)}
.btn{display:inline-block;margin-top:1.2rem;background:var(--ink);color:var(--bg);text-decoration:none;font:500 15px/1 'Inter',system-ui,sans-serif;padding:13px 22px;border-radius:10px}
.btn:hover{opacity:.92}
.mute{color:var(--mute);font-size:13px}
@media (max-width:430px){main{padding-top:8vh}h1{font-size:24px}}
</style>
<main>
<svg width="86" height="112" viewBox="0 0 72 96" role="img" aria-label="Chief" fill="none" stroke="var(--ink)" stroke-width="2.6" stroke-linejoin="round">
<path d="M18 36c0-8 8-12 18-12s18 4 18 12c0 6-2 9-2 17 0 14 6 21 6 27 0 6-10 10-22 10s-22-4-22-10c0-6 6-13 6-27 0-8-2-11-2-17Z" fill="var(--surface)"/>
<path d="M12 33h48"/><path d="M25 33a11 10 0 0 1 22 0"/>
<path d="M29 52h4M41 52h4"/><path d="M31 61c3 3 7 3 10 0"/><path d="M29 71l7 6 7-6" fill="var(--fill)" stroke="none"/>
</svg>
<h1>Crewhouse didn't start</h1>
<p class="lead">Give it another try, or restart your computer.</p>
<p class="why"><b>What happened:</b> ${why}.</p>
<a class="btn" href="${url}">Open Crewhouse again</a>
<p class="mute">Still nothing? Open Crewhouse from your app menu.</p>
</main>`);
    show(`file://${page}`);
    process.exit(1);
  }
}

if (!process.argv.includes('--no-open')) show(url);
