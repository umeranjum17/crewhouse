// The office's battery rules, measured in a real browser on the ?demo household (web/src/diorama.ts): three.js is a
// chunk of its own that Home's first bundle never carries, an idle room draws no frame and keeps no
// requestAnimationFrame loop, a busy room only ticks its stop-motion timer, and Reduce Motion gets the still row with
// no 3D at all. Needs a Chromium on PATH (skipped without one); WebGL runs on the software renderer.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import WebSocket from 'ws';
import { browserBin } from '../src/desktop.ts';
import { temp } from './tmp.ts';
import { until } from './lab.ts';

const repo = join(import.meta.dirname, '..');
const bin = browserBin();

// Build a copy of the web tree, so the checkout's own dist stays as its last real build (as test/cache.test.ts does).
const parent = temp('office-web');
cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
symlinkSync(join(repo, 'src'), join(parent, 'src'), 'dir');
const dist = join(parent, 'web', 'dist');
const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });
const js = () => readdirSync(dist).filter((f) => f.endsWith('.js'));
const threeChunk = () => js().find((f) => readFileSync(join(dist, f), 'utf8').includes('WebGLRenderer'));

test('three.js is its own chunk: Home\'s first bundle never carries it', () => {
  assert.equal(built.status, 0, built.stderr);
  const main = js().find((f) => f.startsWith('main-'))!;
  assert.ok(main, 'the entry bundle is built');
  assert.match(readFileSync(join(dist, 'index.html'), 'utf8'), new RegExp(`/${main}`), 'the shell names the entry bundle, never a chunk');
  const three = threeChunk();
  assert.ok(three && three !== main, 'the 3D room is a separate file');
  assert.doesNotMatch(readFileSync(join(dist, main), 'utf8'), /WebGLRenderer|RoundedBoxGeometry/);
});

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
async function browse() {
  const server = createServer((q, s) => {
    const p = decodeURIComponent(new URL(q.url ?? '/', 'http://x').pathname).replace(/\.\.+/g, '');
    let f = join(dist, p === '/' ? 'index.html' : p);
    if (!existsSync(f) || !statSync(f).isFile()) f = join(dist, 'index.html');
    s.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); s.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = temp(`office-browser-${Date.now()}`);
  const chrome = spawn(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  after(() => { chrome.kill('SIGKILL'); server.close(); });
  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 30_000);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let page: { webSocketDebuggerUrl: string } | undefined;
  await until('a page', async () => (page = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).find((t) => t.type === 'page')), 10_000);
  const ws = new WebSocket(page!.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let id = 0;
  const waiting = new Map<number, (m: any) => void>();
  ws.on('message', (d) => { const m = JSON.parse(String(d)); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  const send = (method: string, params: object = {}) => new Promise<any>((r, j) => {
    const n = ++id; waiting.set(n, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const run = async (expression: string) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  // Count animation frames asked for (and still pending), and every draw and clear the page's WebGL makes.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const n = window.__o = { raf: 0, pending: new Set(), draws: 0, clears: 0 };
    const ask = window.requestAnimationFrame.bind(window), drop = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => { n.raf++; const id = ask((t) => { n.pending.delete(id); f(t); }); n.pending.add(id); return id; };
    window.cancelAnimationFrame = (id) => { n.pending.delete(id); drop(id); };
    for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      for (const k of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'clear']) {
        const f = C && C.prototype[k];
        if (f) C.prototype[k] = function (...a) { if (k === 'clear') n.clears++; else n.draws++; return f.apply(this, a); };
      }
    }
  })()` });
  const open = async (query: string) => { await send('Page.navigate', { url: `${base}/?${query}` }); };
  return { send, run, open };
}

/** Counts across a quiet stretch: measuring that nothing happens needs a window, so this one is a measurement, not a wait. */
const WINDOW_MS = 2000;
const counts = (b: Awaited<ReturnType<typeof browse>>) => b.run('({ raf: __o.raf, draws: __o.draws, clears: __o.clears })');

test('the office keeps the battery budget: no frame while idle, no animation loop ever', { skip: !bin && 'no Chromium here' }, async (t) => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');

  // An idle room (?demo=calm: nothing of hers on the go): drawn once, then nothing at all.
  await b.open('demo=calm&day');
  await until('the 3D room', () => b.run("!!document.querySelector('.o-stage canvas') && window.__o.draws > 0"), 30_000);
  await until('the room to settle', () => b.run('window.__o.pending.size === 0'), 15_000);
  const calm0 = await counts(b);
  await new Promise((r) => setTimeout(r, WINDOW_MS));
  const calm1 = await counts(b);
  assert.deepEqual(calm1, calm0, 'an idle room asks for no frame and draws nothing');

  // A busy room (?demo=office): the ambient stop-motion ticks on a timer, a few frames a second, never a rAF loop.
  await b.open('demo=office&day');
  await until('the 3D room', () => b.run("!!document.querySelector('.o-stage canvas') && window.__o.draws > 0"), 30_000);
  await until('the room to settle', () => b.run('window.__o.pending.size === 0'), 15_000);
  const busy0 = await counts(b);
  await new Promise((r) => setTimeout(r, WINDOW_MS));
  const busy1 = await counts(b);
  assert.equal(busy1.raf, busy0.raf, 'no requestAnimationFrame while nothing is being tweened or dragged');
  const frames = (busy1.clears - busy0.clears) / 2; // a frame clears twice: the shadow map, then the picture
  t.diagnostic(`busy room: ${frames} frames (${busy1.clears - busy0.clears} clears) in ${WINDOW_MS} ms, no rAF`);
  assert.ok(frames > 0, 'someone of hers is working, so the room lives');
  assert.ok(frames <= (12 * WINDOW_MS) / 1000, `ambient stays at or under 12 frames a second: ${frames} frames in ${WINDOW_MS} ms`);
  // The cast is on stage, with only her own words; Pip works for someone else and says only that.
  const tags = await b.run("[...document.querySelectorAll('.o-tag')].map((t) => t.textContent)");
  assert.ok(tags.some((t: string) => t.startsWith('Pip') && t.includes('Busy with another job')), tags.join(' | '));

  // Reduce Motion: the still row, and the 3D chunk is never even fetched.
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await b.open('demo=office&day');
  await until('the still room', () => b.run("!!document.querySelector('.o-still')"), 30_000);
  assert.equal(await b.run("document.querySelector('.o-stage canvas')"), null);
  const fetched: string[] = await b.run("performance.getEntriesByType('resource').map((e) => e.name)");
  assert.ok(!fetched.some((u) => u.endsWith('/' + threeChunk())), 'three.js stays unloaded');
  assert.equal(await b.run('window.__o.draws'), 0);
});
