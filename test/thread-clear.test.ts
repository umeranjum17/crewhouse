// Chief's thread on a phone: nothing in it runs under the bars above or below it. The sign-in card's last
// button stays fully visible and tappable above the composer near the bottom, and no thread line sits under the
// top bar mid-way. Measured in a real browser on ?demo=longthread (signed out, thread long enough to scroll).
// Needs a Chromium on PATH (skipped without one).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
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

// Build a copy of the web tree, so the checkout's own dist stays as its last real build (as test/cache.test.ts does).
const parent = temp('thread-clear-web');
cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
symlinkSync(join(repo, 'src'), join(parent, 'src'), 'dir');
const dist = join(parent, 'web', 'dist');
const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });
assert.equal(built.status, 0, built.stderr);

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

test('a phone thread clears its bars: every sign-in button above the composer, no line under the top bar', { skip: !bin && 'no Chromium here' }, async () => {
  const server = createServer((q, s) => {
    const p = decodeURIComponent(new URL(q.url ?? '/', 'http://x').pathname).replace(/\.\.+/g, '');
    let f = join(dist, p === '/' ? 'index.html' : p);
    if (!existsSync(f)) f = join(dist, 'index.html');
    s.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); s.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = mkdtempSync(join(tmpdir(), 'thread-clear-browser-'));
  mkdirSync(join(profile, 'a'), { recursive: true });
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
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  // Both of Chief's phone threads: Home's chat (under the Getting set up bar) and his own page.
  for (const route of ['#/', '#/chief']) {
    await send('Page.navigate', { url: `${base}/?demo=longthread&night${route}` });
    await until('the new route', () => run(`location.hash === '${route}' && document.readyState === 'complete'`), 30_000);
    // Signed out, so the thread ends on the sign-in card with every provider's button.
    await until('the sign-in card', () => run("[...document.querySelectorAll('.chat .card.ask .btn')].filter((e) => /^Sign in/.test(e.textContent.trim())).length >= 6"), 30_000);
    await until('a long thread', () => run("document.querySelectorAll('.chat .lines .line').length > 10"), 30_000);

    // Scroll the thread itself where it scrolls (its own lines column once contained, the document before that).
    const scrollThread = (f: number) => run(`(() => {
      const at = ${f};
      const lines = document.querySelector('.chat .lines');
      if (lines && lines.scrollHeight > lines.clientHeight + 1) lines.scrollTop = at * (lines.scrollHeight - lines.clientHeight);
      const max = document.documentElement.scrollHeight - innerHeight;
      if (max > 0) scrollTo(0, at * max);
      return true;
    })()`);

    // Near the bottom, no sign-in button runs under the composer (content clipped away by its own scroller
    // reads as hidden, never as under: only the part actually painted inside the thread counts).
    await scrollThread(0.95);
    const near = await run(`(() => {
      const box = document.querySelector('.chat .lines').getBoundingClientRect();
      const dock = document.querySelector('.chat .dock').getBoundingClientRect();
      const under = [...document.querySelectorAll('.chat .card.ask .btn')].filter((e) => /^Sign in/.test(e.textContent.trim()))
        .filter((e) => { const b = e.getBoundingClientRect();
          const seenTop = Math.max(b.top, box.top, 0), seenBottom = Math.min(b.bottom, box.bottom, innerHeight);
          return seenBottom > seenTop && seenBottom > dock.top + 1 && seenTop < dock.bottom - 1; })
        .map((e) => e.textContent.trim());
      return { dock: { top: Math.round(dock.top), bottom: Math.round(dock.bottom) }, under };
    })()`);
    assert.deepEqual(near.under, [], `${route} near the bottom, sign-in buttons under the composer (composer ${near.dock.top}-${near.dock.bottom}): ${near.under.join(' | ')}`);

    // At the very bottom, the card's last button is whole and tappable above the composer.
    await scrollThread(1);
    const bottom = await run(`(() => {
      const R = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
      const btns = [...document.querySelectorAll('.chat .card.ask .btn')].filter((e) => /^Sign in/.test(e.textContent.trim()));
      const last = btns.at(-1);
      const dock = document.querySelector('.chat .dock');
      const r = R(last);
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return { text: last.textContent.trim(), rect: R(last), dock: R(dock), vh: innerHeight,
        hit: hit?.closest('.btn')?.textContent.trim() ?? hit?.tagName ?? 'none' };
    })()`);
    assert.ok(bottom.rect.bottom <= bottom.dock.top, `${route} at the bottom, ${bottom.text} ends at ${Math.round(bottom.rect.bottom)} but the composer starts at ${Math.round(bottom.dock.top)}`);
    assert.ok(bottom.rect.bottom <= bottom.vh && bottom.rect.top >= 0, `${bottom.text} is on screen whole`);
    assert.equal(bottom.hit, bottom.text, `${bottom.text} is tappable, not covered (hit ${bottom.hit})`);

    // Mid-way, no thread line sits under the top bar (only the part actually painted inside the thread counts).
    await scrollThread(0.4);
    const mid = await run(`(() => {
      const R = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
      const box = document.querySelector('.chat .lines').getBoundingClientRect();
      const head = document.querySelector('.page .chat-head, .page .home-top');
      const h = R(head);
      const under = [...document.querySelectorAll('.chat .lines .line, .chat .lines .line-wrap, .chat .lines .card.ask')]
        .filter((e) => { const b = e.getBoundingClientRect(); if (!b.height) return false;
          const seenTop = Math.max(b.top, box.top, 0), seenBottom = Math.min(b.bottom, box.bottom, innerHeight);
          return seenBottom > seenTop && seenBottom > h.top + 1 && seenTop < h.bottom - 1; })
        .map((e) => JSON.stringify({ cls: e.className.toString().slice(0, 20), top: Math.round(e.getBoundingClientRect().top), text: (e.innerText ?? '').slice(0, 40).replace(/\\n/g, ' ') }));
      return { head: h, under };
    })()`);
    assert.deepEqual(mid.under, [], `${route} mid-way, thread content under the top bar (bar ${Math.round(mid.head.top)}-${Math.round(mid.head.bottom)}): ${mid.under.join(' | ')}`);
  }

  // Chief's status says the sign-in wait the card says, in the card's words, from the first frame on: never "At work"
  // beside the sign-in buttons, even while the accounts answer is still on its way (as slow as the real engine's).
  for (const [w, h, sel] of [[390, 844, '.home-chat .ch-status'], [1440, 900, '.side-status']] as const) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 });
    await send('Page.navigate', { url: `${base}/?demo=longthread&day&slowaccounts#/` });
    const seen: string[] = [];
    await until('the sign-in wait', async () => {
      const s = await run(`(() => { const st = document.querySelector('${sel}');
        return { card: [...document.querySelectorAll('.chat .card.ask .btn')].some((e) => /^Sign in/.test(e.textContent.trim())),
          status: st?.textContent.trim() ?? '', blue: st ? getComputedStyle(st).color : '', ask: ((a) => (a ? getComputedStyle(a).color : ''))(document.querySelector('.ask-status')) }; })()`);
      if (s.card) seen.push(`${s.status}${w >= 900 && s.status === 'Needs a sign-in' && s.blue !== s.ask ? ' (not the card blue)' : ''}`); // a phone card's status is its quiet grey line
      return s.card && seen.length > 3;
    }, 30_000);
    assert.deepEqual([...new Set(seen)], ['Needs a sign-in'], `at ${w}, Chief's status beside the sign-in card`);
  }
});
