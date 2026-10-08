// The chat never goes quiet (bar.md, ch-chat-live-1): from the send to the reply the thread changes at least once a
// second, through a long model turn and a job passed to a helper, on a desk and at phone width. Real crewd (stub
// engine, its turn held) and the real built web app in a real Chromium. Needs a Chromium on PATH (skipped without one).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { taskBrowser } from './browser.ts';
import { temp } from './tmp.ts';
import { setup, until, release, holding } from './lab.ts';
import { browserBin } from '../src/desktop.ts';
import { startServer } from '../src/server.ts';

const repo = join(import.meta.dirname, '..');
const bin = browserBin();
/** The bar: never more than a second without a visible change, timed by the page itself (a slow runner's own
 *  round trips do not count against the product). The clock ticks on each whole second of the job, so a still
 *  stretch is its one-second period plus the browser's timer jitter, held to one frame. */
const GAP_MS = 1000, FRAME_MS = 17, HELD_MS = 3500;

test('from send to reply the thread never sits still: a held Chief turn and a job passed to Scout, at 1440 and 390', { skip: !bin && 'no Chromium here' }, async () => {
  // The app as built from this tree, served by crewd itself.
  const parent = temp('chat-live');
  cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
  for (const d of ['src', 'templates', 'tools', 'skills', 'package.json']) symlinkSync(join(repo, d), join(parent, d));
  const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const { cfg, db, crew, done } = setup();
  Object.assign(cfg, { port: 0, host: '127.0.0.1', linkPort: 0, repoDir: parent });
  const server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = (method: string, path: string, body?: object) => fetch(base + path, { method, headers: { 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  await api('POST', '/api/onboard', { address: 'Umer' });
  assert.equal((await api('POST', '/api/recruit', { template: 'scout', name: 'Scout' })).id, 'scout');

  const profile = mkdtempSync(join(tmpdir(), 'chat-live-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
  let ws: WebSocket | undefined;
  after(async () => { ws?.close(); await browser.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); done(); });
  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 30_000);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let target: { webSocketDebuggerUrl: string } | undefined;
  await until('a page', async () => (target = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).find((t) => t.type === 'page')), 10_000);
  ws = new WebSocket(target!.webSocketDebuggerUrl);
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
  // What the person sees of the thread: its visible words, live line included.
  const SCREEN = `[...document.querySelectorAll('.chat .lines')].filter((e) => e.offsetParent).map((e) => e.innerText).join('|')`;
  const screen = () => run(SCREEN);

  /** Send the words from the box and watch the thread while the model holds its turn; then let it answer. */
  const journey = async (width: number, bot: string, words: string, expect: RegExp) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
    await send('Page.navigate', { url: `${base}/?day#/` });
    await until('Chief\'s box', () => run("!!document.querySelector('.chat .dock textarea')"), 30_000);
    await run("document.querySelector('.chat .dock textarea').focus()");
    await send('Input.insertText', { text: words });
    // Every change to the visible thread's words, stamped by the page as it happens, from the key press on.
    await run(`{ window.__watch?.disconnect(); window.__seen = []; window.__sent = undefined; let was = ${SCREEN};
      (window.__watch = new MutationObserver(() => { const now = ${SCREEN}; if (now !== was) { was = now; __seen.push(performance.now()); } }))
        .observe(document.querySelector('.chat'), { subtree: true, childList: true, characterData: true });
      document.querySelector('.chat .dock textarea').addEventListener('keydown', () => { window.__sent ??= performance.now(); }, { capture: true }); true }`);
    const sent = Date.now();
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await holding(crew, bot);
    await new Promise((r) => setTimeout(r, HELD_MS - (Date.now() - sent)));
    const { seen, from, to } = await run('({ seen: __seen, from: __sent, to: performance.now() })');
    let gap = 0, prev = from;
    for (const t of [...seen, to]) { gap = Math.max(gap, t - prev); prev = t; }
    gap = Math.round(gap);
    console.log(`${width} ${bot}: longest still screen ${gap} ms (${seen.length} changes)`);
    assert.ok(gap <= GAP_MS + FRAME_MS, `${width}: the thread sat still for ${gap} ms while ${bot} worked`);
    assert.match(await screen(), expect, `${width}: the live line says who is on it`);
    await release(crew, bot, `All set for Umer from ${bot}.`);
    await until('the reply and the end line', async () => /All set for Umer/.test(await screen()) && /Done/.test(await run("document.querySelector('.live-end')?.innerText ?? ''")), 15_000);
  };
  for (const width of [1440, 390]) {
    await journey(width, 'chief', 'Please ask permission before you plan my week', /Chief[\s\S]*At work[\s\S]*Working on it/);
    // On a phone there is no side column: the job passed to Scout is followed in Chief's thread itself.
    await journey(width, 'scout', 'Ask Scout to ask permission first, then look up the tower', /Scout[\s\S]*At work[\s\S]*Passed to Scout/);
  }
});
