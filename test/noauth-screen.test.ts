// A bare load (a bookmark or typed address, no #person= key) has no authority, so crewd refuses every read
// with 403 no-authority while the computer is up: one plain screen saying to open Crewhouse from this computer's
// app menu, never the offline screen. A computer truly gone still shows the offline screen with its retry loop.
// Needs a Chromium on PATH (skipped without one).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { taskBrowser } from './browser.ts';
import { until } from './lab.ts';
import WebSocket from 'ws';
import { browserBin } from '../src/desktop.ts';
import { temp } from './tmp.ts';

const repo = join(import.meta.dirname, '..');
const bin = browserBin();

// Build a copy of the web tree, so the checkout's own dist stays as its last real build (as test/cache.test.ts does).
const parent = temp('noauth-web');
cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
symlinkSync(join(repo, 'src'), join(parent, 'src'), 'dir');
const dist = join(parent, 'web', 'dist');
const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });
test('the web build used below is current', () => {
  assert.equal(built.status, 0, built.stderr);
});

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

test('a refused read shows the app-menu screen; a dead computer still shows the offline screen', { skip: !bin && 'no Chromium here' }, async (t) => {
  // What the API does: refuse every read with 403 no-authority (a bare load), or answer nothing at all (gone).
  let mode: 'deny' | 'dead' = 'deny';
  const server = createServer((q, s) => {
    const p = decodeURIComponent(new URL(q.url ?? '/', 'http://x').pathname).replace(/\.\.+/g, '');
    if (p.startsWith('/api/')) {
      if (mode === 'deny') { s.writeHead(403, { 'content-type': 'application/json' }); s.end(JSON.stringify({ error: 'Open Crewhouse from this computer’s app menu.', code: 'no-authority' })); }
      else q.socket.destroy();
      return;
    }
    let f = join(dist, p === '/' ? 'index.html' : p);
    if (!existsSync(f) || !statSync(f).isFile()) f = join(dist, 'index.html');
    s.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); s.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const profile = mkdtempSync(join(tmpdir(), 'noauth-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
  let ws: WebSocket;
  after(async () => {
    ws?.close();
    await browser.close();
  });
  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 30_000);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let page: { webSocketDebuggerUrl: string } | undefined;
  await until('a page', async () => (page = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).find((x) => x.type === 'page')), 10_000);
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
  await send('Page.enable');
  const screen = () => run(`(() => { const s = document.querySelector('.unreachable'); return s ? { head: s.querySelector('h1')?.textContent ?? '', body: s.innerText ?? '', retry: !!s.querySelector('.btn'), loop: /Trying again in/.test(s.innerText ?? '') } : null; })()`);

  mode = 'deny';
  await send('Page.navigate', { url: `${base}/?day` });
  await until('the app-menu screen', () => screen(), 30_000);
  const denied = await screen();
  assert.match(denied.head, /app menu/, 'a refused read names the app menu');
  assert.doesNotMatch(denied.body, /isn't answering/, 'a refused read never shows the offline screen');
  assert.equal(denied.retry, false, 'the app-menu screen has no retry button');
  assert.equal(denied.loop, false, 'the app-menu screen has no retry loop');

  mode = 'dead';
  await send('Page.navigate', { url: `${base}/?day` });
  await until('the offline screen', () => screen(), 30_000);
  const gone = await screen();
  assert.match(gone.head, /isn't answering/, 'a real network failure still shows the offline screen');
  assert.equal(gone.retry, true, 'the offline screen keeps its retry button');
});
