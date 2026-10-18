// A cold relaunch of the installed app returns to the place the person was last showing, not always Home
// (web/src/resume.ts). Driven in a real browser on the built public shell served from a *.localhost origin —
// the published shell's own situation, opened on its demo (`?demo`; bare, it asks where Chief works), with no crewd, no
// account and no network. Covers:
// a thread is remembered and reopened; a link or shortcut that names a place wins over the memory; a remembered
// thread that has since gone opens Home with no error. Needs a Chromium on PATH (skipped without one).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { taskBrowser } from './browser.ts';
import { browserBin } from '../src/desktop.ts';
import { temp } from './tmp.ts';
import { until } from './lab.ts';

const repo = join(import.meta.dirname, '..');
const bin = browserBin();
const root = temp('resume-web');
// A copy of the web tree, so the checkout's own dist stays as its last real build (as test/office.test.ts does).
cpSync(join(repo, 'web'), join(root, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
symlinkSync(join(repo, 'src'), join(root, 'src'), 'dir');
const dist = join(root, 'web', 'dist');

test('a cold relaunch reopens the last place, a named link wins, and a thread that is gone opens Home', { skip: !bin && 'no Chromium here' }, async () => {
  const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(root, 'web')], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
  const server = createServer((q, s) => {
    const p = decodeURIComponent(new URL(q.url ?? '/', 'http://x').pathname).replace(/\.\.+/g, '');
    let f = join(dist, p === '/' ? 'index.html' : p);
    if (!existsSync(f) || !statSync(f).isFile()) f = join(dist, 'index.html');
    s.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); s.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://crewhouse.localhost:${(server.address() as { port: number }).port}`;
  const profile = mkdtempSync(join(tmpdir(), 'resume-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank'], profile);
  let ws: WebSocket;
  after(async () => { ws?.close(); server.close(); await browser.close(); });
  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 30_000);
  let page: { webSocketDebuggerUrl: string } | undefined;
  await until('a page', async () => (page = ((await (await fetch(`http://127.0.0.1:${readFileSync(portFile, 'utf8').split('\n')[0]}/json/list`)).json()) as any[]).find((t) => t.type === 'page')), 10_000);
  ws = new WebSocket(page!.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws!.once('open', r); ws!.once('error', j); });
  let id = 0; const waiting = new Map<number, (m: any) => void>();
  ws.on('message', (d) => { const m = JSON.parse(String(d)); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  const send = (method: string, params: object = {}) => new Promise<any>((r, j) => { const n = ++id; waiting.set(n, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result))); ws!.send(JSON.stringify({ id: n, method, params })); });
  const run = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  // A real cold start: about:blank unloads the document, so the target URL is a fresh load (a hash-only change would not be).
  const cold = async (url = `${base}/?demo`) => {
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url });
    await until('the app', () => run("!!document.querySelector('.shell')"), 30_000);
  };
  const hash = () => run('location.hash');

  // The public shell's demo, and Scout's thread remembers itself.
  await cold();
  assert.equal(await run("!!document.querySelector('.demo-tag')"), true, 'the public shell runs the demo');
  await run("location.hash = '#/h/scout'");
  await until('Scout’s thread', () => run("!!document.querySelector('.page.helper')"), 30_000);

  // A home-screen launch (the app root, nothing after the #) reopens the remembered thread.
  await cold();
  assert.equal(await hash(), '#/h/scout', 'the cold relaunch reopened the last thread');

  // A named place in a link or shortcut wins over the remembered one.
  await cold(`${base}/?demo#/things`);
  assert.equal(await hash(), '#/things', 'the place named in the link wins');

  // A remembered thread that has since gone opens Home, with no error.
  await cold();
  await run("location.hash = '#/h/scout'");
  await until('the thread again', () => run("location.hash === '#/h/scout'"));
  await run(`localStorage.setItem('crewhouse.place.demo', '#/h/vanished')`);
  await cold();
  await until('Home', () => run("location.hash === '#/'"));
  assert.equal(await run("!!document.querySelector('.page.mute')"), false, 'no error text is shown');

  // J04: a cold approval link belongs to Chief. Close is not an answer, including after a reload.
  for (const w of [390, 1280]) for (const theme of ['day', 'night']) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: w === 390 });
    await cold(`${base}/?demo&${theme}#/ask/11`);
    await until('the order review', () => run("!!document.querySelector('.sheet.approve')"));
    assert.equal(await run("!!document.querySelector('.home-chat')"), true, 'a direct ask opens over Chief, not Home');
    await until('the sheet entrance to finish', () => run("document.querySelector('.sheet.approve').getAnimations().every(a => a.playState === 'finished')"));
    const r = await run("(() => { const r=document.querySelector('.sheet.approve').getBoundingClientRect(); return {left:r.left,right:r.right,bottom:r.bottom}; })()");
    assert.ok(r.left >= 0 && r.right <= w && r.bottom <= 845, `review stays in the ${w}px viewport: ${JSON.stringify(r)}`);
    assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false, 'no horizontal scroll');
    const p = await run("(() => { const r=document.querySelector('.approve-close').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
    await until('Chief after closing', () => run("location.hash === '#/chief' && !document.querySelector('.sheet.approve')"));
    await run("location.hash = '#/ask/11'");
    await until('the order still waits for an answer', () => run("!!document.querySelector('.sheet.approve')"));
  }
});
