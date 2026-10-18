// The desktop app: start crewd if it isn't running, show the crew in a window of its own, and keep the crew's counts in
// the tray. A port of packaging/launch.mjs (with packaging/bar-pill.mjs's counts). crewd runs on the Node the app carries,
// never on Electron's: the engine kit spawns process.execPath with an env built from nothing and checks /proc/<pid>/exe.
// crewd is the app's own child, so the AppImage's mount outlives it; the app stays in the tray when its window closes,
// and starts by itself at login (an XDG autostart entry, --hidden).
//   --hidden   start the crew and the tray, but open no window
import { app, BrowserWindow, Menu, nativeTheme, session, shell, Tray } from 'electron';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isolatedRun, loadConfig } from '../src/config.ts';
import { status } from '../web/src/adapter.ts';
import { trouble } from '../packaging/trouble.mjs';

process.env.CREWHOUSE_RUN_MODE ??= 'product';
const cfg = loadConfig(), keyFile = join(cfg.stateDir, 'person.key');
let origin = `http://127.0.0.1:${cfg.port}`;
const nodeBin = join(process.resourcesPath, 'node', 'bin'), icon = join(import.meta.dirname, 'icon.png');
const key = () => (existsSync(keyFile) ? readFileSync(keyFile, 'utf8') : '');
// The helpers' tools install with the bundled npm, so it goes first on the PATH crewd and its tools see.
// APPDIR/APPIMAGE/ARGV0/OWD are the AppImage runtime's own; crewd has no use for them.
const { APPDIR: _d, APPIMAGE: _i, ARGV0: _a, OWD: _o, ...inherited } = process.env;
const env = { ...inherited, PATH: `${nodeBin}:${process.env.PATH ?? ''}`, CREWHOUSE_PACKAGED: process.env.CREWHOUSE_PACKAGED ?? '1' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Liveness only: crewd answers this unauthenticated probe with its gate's 403 and its own code; anything else is not crewd.
const up = () => {
  if (!cfg.port) { if (!existsSync(join(cfg.stateDir, 'endpoint'))) return false; origin = readFileSync(join(cfg.stateDir, 'endpoint'), 'utf8').trim(); }
  return fetch(`${origin}/api/state`, { signal: AbortSignal.timeout(1500) })
    .then(async (r) => r.ok || (r.status === 403 && (await r.json().catch(() => ({})))?.code === 'no-authority'), () => false);
};

let win = null, tray = null, crewd = null, quitting = false, why = '';

function startCrewd() {
  mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
  const log = join(cfg.stateDir, 'crewd.log'), out = openSync(log, 'a'), from = statSync(log).size; // this run's lines start here
  why = '';
  // setpriv's parent-death signal: if the app itself dies, crewd goes too, rather than outliving the AppImage's mount.
  const run = [join(nodeBin, 'node'), 'src/main.ts'], guard = ['/usr/bin/setpriv', '/bin/setpriv'].find((p) => existsSync(p));
  crewd = spawn(guard ?? run[0], guard ? ['--pdeathsig', 'TERM', '--', ...run] : run.slice(1), { cwd: join(process.resourcesPath, 'crewd'), env, stdio: ['ignore', out, out] })
    .on('error', () => { why = "Crewhouse's own program could not be started on this computer"; })
    .on('exit', (code) => {
      crewd = null;
      if (quitting) return;
      const said = readFileSync(log).subarray(from).toString();
      why ||= /EADDRINUSE/.test(said) ? `Another program on this computer is using Crewhouse's address (port ${cfg.port})`
        : code === 0 ? 'Crewhouse stopped' : 'Crewhouse stopped unexpectedly';
      if (win && !win.webContents.getURL().startsWith('data:')) void showTrouble();
    });
  closeSync(out);
}

async function showTrouble() {
  if (!win) return;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(trouble(why || 'Crewhouse started, but never answered', origin))}`);
}

/** Up, or started and waited for; then the app in the window, or the plain screen saying what went wrong. */
async function boot() {
  if (!(await up())) {
    if (!crewd) startCrewd();
    for (let i = 0; i < 120 && crewd && !(await up()); i++) await sleep(500);
  }
  if (!win) return;
  if (await up()) await win.loadURL(key() ? `${origin}/#person=${key()}` : origin);
  else await showTrouble();
}

/** Only crewd's own pages show in the window; links to anywhere else open in the person's browser. */
function outside(url) { if (/^(https?|mailto):/.test(url)) void shell.openExternal(url); }

function open() {
  if (win) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 380, minHeight: 560, title: 'Crewhouse', icon, show: false, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#F4F3EF', // the app's own day and night (web/src/main.tsx)
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win?.show());
  // Closing the window keeps the crew working: the tray brings it back, and Quit in the tray stops it.
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win?.hide(); } });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { outside(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    // "Open Crewhouse again" on the plain screen: start over rather than load a page that isn't there.
    if (win?.webContents.getURL().startsWith('data:')) { e.preventDefault(); void boot(); return; }
    if (new URL(url).origin !== origin) { e.preventDefault(); outside(url); }
  });
  void boot();
}

let shown = '';
async function counts() {
  let text = 'Not running';
  try {
    const r = await fetch(`${origin}/api/state`, {
      signal: AbortSignal.timeout(1500), redirect: 'error', headers: { 'x-crewhouse': '1', authorization: `Bearer ${key()}` },
    });
    const state = r.ok ? await r.json() : null;
    if (state?.person?.id === 1) text = status(state, false)?.publicText || 'All quiet';
  } catch { /* unreachable: not running */ }
  if (text === shown) return;
  shown = text;
  tray.setToolTip(`Crewhouse: ${text}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: text, enabled: false }, { type: 'separator' },
    { label: 'Open Crewhouse', click: open }, { label: 'Quit Crewhouse', click: () => app.quit() },
  ]));
}

/** Start at login: written once, and again when the app it points at has moved (a new AppImage elsewhere). */
function loginStart() {
  if (process.env.CREWHOUSE_NO_SERVICE || isolatedRun(cfg.engine)) return; // tests: never touch the login items of whoever runs this
  const file = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', 'crewhouse.desktop');
  const exe = process.env.APPIMAGE || process.execPath, was = existsSync(file) && /^Exec="([^"]+)"/m.exec(readFileSync(file, 'utf8'))?.[1];
  if (was && existsSync(was)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Crewhouse\nComment=Your crew of helpers, at home\nExec="${exe}" --hidden\nIcon=crewhouse\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`);
}

// Any way out (Quit in the tray, a signal, the session ending) closes the window for real and stops the crewd this app
// started; one that was already running (a terminal's, the old .deb's) keeps going.
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', (e) => {
  const c = crewd;
  if (!c) return;
  e.preventDefault();
  crewd = null;
  setTimeout(() => app.exit(0), 10_000).unref();
  c.once('exit', () => app.quit()).kill('SIGTERM');
});

if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  app.on('second-instance', open);
  app.on('window-all-closed', () => {}); // the tray keeps the app, and the crew, running
  // Not a top-level await: Electron holds `ready` until the entry module has finished loading.
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // The window shows only crewd's own pages, so only they may ask for the camera, the microphone or notifications.
    const ours = (url) => { try { return new URL(url).origin === origin; } catch { return false; } };
    session.defaultSession.setPermissionRequestHandler((wc, _p, done) => done(ours(wc.getURL())));
    session.defaultSession.setPermissionCheckHandler((_wc, _p, from) => ours(from));
    tray = new Tray(join(import.meta.dirname, 'tray.png'));
    tray.on('click', open);
    void counts();
    setInterval(counts, 10_000);
    loginStart();
    if (process.argv.includes('--hidden')) void boot(); else open();
  });
}
