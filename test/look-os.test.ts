// The Auto look follows the device's dark setting, not the clock, as the native app does: a device set to dark gets the
// night page at 14:00 and a light one gets the day page at 02:00, from the boot script before first paint (web/index.html)
// and from useLook (web/src/main.tsx) once the app runs, and the app switches live when the setting changes. Day and
// Night pinned by ?day / ?night still win. Driven in a real Chromium on the built app, in ?demo (no home computer needed);
// needs Chromium on PATH (skipped without one).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { taskBrowser } from './browser.ts';
import WebSocket from 'ws';
import { browserBin } from '../src/desktop.ts';
import { temp } from './tmp.ts';
import { until } from './lab.ts';

const repo = join(import.meta.dirname, '..');
const bin = browserBin();

const parent = temp('look-os-web');
cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
symlinkSync(join(repo, 'src'), join(parent, 'src'), 'dir');
const dist = join(parent, 'web', 'dist');
const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
/** A zone whose clock reads `hour` now (Etc/GMT-k is UTC+k), so the page's own Date says that hour. */
const zoneAt = (hour: number) => {
  const k = (((hour - new Date().getUTCHours()) % 24) + 24) % 24;
  return k === 0 ? 'Etc/GMT' : k <= 12 ? `Etc/GMT-${k}` : `Etc/GMT+${24 - k}`;
};

async function browse() {
  let bundle = true;
  const server = createServer((q, s) => {
    const p = decodeURIComponent(new URL(q.url ?? '/', 'http://x').pathname).replace(/\.\.+/g, '');
    if (!bundle && /^\/main-.*\.js$/.test(p)) { s.writeHead(404); s.end(); return; }
    let f = join(dist, p === '/' ? 'index.html' : p);
    if (!existsSync(f) || !statSync(f).isFile()) f = join(dist, 'index.html');
    s.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); s.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = mkdtempSync(join(tmpdir(), 'look-os-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank'], profile);
  let ws: WebSocket;
  after(async () => {
    ws?.close();
    server.close();
    await browser.close();
  });
  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 30_000);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let page: { webSocketDebuggerUrl: string } | undefined;
  await until('a page', async () => (page = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).find((t) => t.type === 'page')), 10_000);
  ws = new WebSocket(page!.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let id = 0;
  const waiting = new Map<number, (m: any) => void>();
  ws.on('message', (d) => { const m = JSON.parse(String(d)); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  const send = (method: string, params: object = {}) => new Promise<any>((r, j) => {
    const n = ++id; waiting.set(n, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const run = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  /** Opens the page at a clock hour and a device scheme, and says the look the page came up in (boot script, then app). */
  const open = async ({ hour, scheme, query = '', app = true }: { hour: number; scheme: 'light' | 'dark'; query?: string; app?: boolean }) => {
    await send('Emulation.setTimezoneOverride', { timezoneId: zoneAt(hour) });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    // A blank page between loads, so the next read can only see the page just opened.
    await send('Page.navigate', { url: 'about:blank' });
    await until('a blank page', () => run("location.href === 'about:blank'"), 10_000);
    bundle = app;
    await send('Page.navigate', { url: `${base}/?demo${query ? `&${query}` : ''}#/` });
    await until('the look is set', () => run(app ? "!!document.querySelector('#root')?.children.length" : "!!document.documentElement?.dataset.theme"), 30_000);
  };
  const look = () => run(`({ theme: document.documentElement.dataset.theme, bar: document.querySelector('meta[name=theme-color]').content,
    status: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]').content })`) as Promise<{ theme: string; bar: string; status: string }>;
  return { send, run, open, look };
}

const DAY = { theme: 'day', bar: '#F3EEE3', status: 'default' };
const NIGHT = { theme: 'night', bar: '#0C0C0B', status: 'black-translucent' };

test('auto follows the device dark setting, not the clock, before first paint and live', { skip: !bin && 'no Chromium here' }, async () => {
  assert.equal(built.status, 0, built.stderr);
  const b = await browse();

  // The boot script alone (the app bundle is blocked): the look is right before any app code runs.
  await b.open({ hour: 2, scheme: 'light', app: false });
  assert.deepEqual(await b.look(), DAY, 'light device at 02:00 is day');
  await b.open({ hour: 14, scheme: 'dark', app: false });
  assert.deepEqual(await b.look(), NIGHT, 'dark device at 14:00 is night');

  // The app, after its own first render.
  await b.open({ hour: 2, scheme: 'light' });
  await until('the app look settles', async () => (await b.look()).theme === 'day');
  assert.deepEqual(await b.look(), DAY, 'light device at 02:00 is day');
  await b.open({ hour: 14, scheme: 'dark' });
  await until('the app look settles', async () => (await b.look()).theme === 'night');
  assert.deepEqual(await b.look(), NIGHT, 'dark device at 14:00 is night');

  // The device setting changes under an open app: the look follows at once, with no reload.
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await until('day after the device goes light', async () => (await b.look()).theme === 'day');
  assert.deepEqual(await b.look(), DAY);
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await until('night after the device goes dark', async () => (await b.look()).theme === 'night');
  assert.deepEqual(await b.look(), NIGHT);

  // Day and Night pinned by the URL still win over the device.
  await b.open({ hour: 14, scheme: 'dark', query: 'day' });
  await until('pinned day', async () => (await b.look()).theme === 'day');
  assert.deepEqual(await b.look(), DAY, 'pinned day on a dark device');
  await b.open({ hour: 2, scheme: 'light', query: 'night' });
  await until('pinned night', async () => (await b.look()).theme === 'night');
  assert.deepEqual(await b.look(), NIGHT, 'pinned night on a light device');
});
