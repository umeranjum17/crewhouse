// The phone-width chat keeps the box usable with the keyboard up (web/src/styles.css, web/src/parts.tsx Composer): with the
// box focused, the header's helmet, switch and "What happened" step aside, and a real press on Send keeps focus in the box.
// A photo picked in the box shrinks before it is sent (web/src/parts.tsx `shrinkPhoto`): an oversized PNG becomes a JPG chip.
// Measured in a real Chromium on the ?demo chat at 390px touch. Needs a Chromium on PATH (skipped without one).
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

// Build a copy of the web tree, so the checkout's own dist stays as its last real build.
const parent = temp('composer-focus-web');
cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
symlinkSync(join(repo, 'src'), join(parent, 'src'), 'dir');
const dist = join(parent, 'web', 'dist');
const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

test('the phone chat keeps the box usable, and a photo picked there goes as a shrunk JPEG', { skip: !bin && 'no Chromium here' }, async () => {
  assert.equal(built.status, 0, built.stderr);
  const server = createServer((q, s) => {
    const p = decodeURIComponent(new URL(q.url ?? '/', 'http://x').pathname).replace(/\.\.+/g, '');
    let f = join(dist, p === '/' ? 'index.html' : p);
    if (!existsSync(f) || !statSync(f).isFile()) f = join(dist, 'index.html');
    s.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); s.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = mkdtempSync(join(tmpdir(), 'composer-focus-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank'], profile);
  let ws: WebSocket | undefined;
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
  await new Promise((r, j) => { ws!.once('open', r); ws!.once('error', j); });
  let id = 0;
  const waiting = new Map<number, (m: any) => void>();
  ws.on('message', (d) => { const m = JSON.parse(String(d)); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  const send = (method: string, params: object = {}) => new Promise<any>((r, j) => {
    const n = ++id; waiting.set(n, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result))); ws!.send(JSON.stringify({ id: n, method, params }));
  });
  const run = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  // A phone: 390px wide, touch, so the phone breakpoint and the touch press apply.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  // A headless window never has OS focus, so :focus would not match; emulate a focused page, as a phone in hand has.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: `${base}/?demo#/chief` });
  // The chat's own box: the visible one inside the Chat page (the phone-only dock elsewhere is not on screen).
  const box = "[...document.querySelectorAll('.home-chat .dock textarea')].find((t) => t.offsetParent)";
  await until('the chat box', () => run(`!!${box}`), 30_000);

  // Before: the header is on screen. With the box focused it steps aside (the phone breakpoint's :has rule).
  const headerShown = () => run("[...document.querySelectorAll('.home-chat .ch-art, .home-chat .home-did')].filter((e) => getComputedStyle(e).display !== 'none').length");
  const shownBefore = await headerShown();
  assert.ok(shownBefore > 0, 'the header is on screen before the box is focused');
  await run(`${box}.focus()`);
  assert.equal(await headerShown(), 0, 'the header steps aside while the box is focused');

  // Send keeps focus in the box: type a line, then a real press on Send (mouse down and up on its centre).
  await send('Input.insertText', { text: 'Keyboard check' });
  const at = await run("(() => { const r = [...document.querySelectorAll('.home-chat .dock button.send[aria-label=Send]')].find((b) => b.offsetParent).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  assert.equal(await run(`document.activeElement === ${box}`), true, 'focus stays in the box after a press on Send');

  // A photo over the 10 MB a file may be is no longer refused: it shrinks to a JPEG chip under a megabyte.
  const pngBytes = await run(`(async () => { const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const g = c.getContext('2d'), d = g.createImageData(3000, 2000);
    for (let i = 0; i < d.data.length; i += 1) d.data[i] = Math.random() * 255; g.putImageData(d, 0, 0);
    const png = await new Promise((r) => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([png], 'photo.png', { type: 'image/png' }));
    const input = ${box}.closest('form').querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return png.size; })()`);
  assert.ok(pngBytes > 10 << 20, 'the photo is over the 10 MB a file may be, so the raw path would refuse it');
  await until('the photo chip', () => run("[...document.querySelectorAll('.home-chat .c-file')].some((c) => /^photo\\.jpg/.test(c.textContent) && /JPG · \\d+ KB/.test(c.textContent))"), 30_000);
});
