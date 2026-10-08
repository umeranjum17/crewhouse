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
/** The bar: never more than a second without a visible change (sampling adds up to one interval). */
const GAP_MS = 1000, SAMPLE_MS = 100, HELD_MS = 3500;

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
  const screen = () => run(`[...document.querySelectorAll('.chat .lines')].filter((e) => e.offsetParent).map((e) => e.innerText).join('|')`);

  /** Send the words from the box and watch the thread while the model holds its turn; then let it answer. */
  const journey = async (width: number, bot: string, words: string, expect: RegExp) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
    await send('Page.navigate', { url: `${base}/?day#/` });
    await until('Chief\'s box', () => run("!!document.querySelector('.chat .dock textarea')"), 30_000);
    await run("document.querySelector('.chat .dock textarea').focus()");
    await send('Input.insertText', { text: words });
    let last = await screen(), changed = Date.now(), gap = 0;
    const sent = Date.now();
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await holding(crew, bot);
    while (Date.now() - sent < HELD_MS) {
      const now = await screen();
      if (now !== last) { gap = Math.max(gap, Date.now() - changed); changed = Date.now(); last = now; }
      await new Promise((r) => setTimeout(r, SAMPLE_MS));
    }
    gap = Math.max(gap, Date.now() - changed);
    console.log(`${width} ${bot}: longest still screen ${gap} ms`);
    assert.ok(gap <= GAP_MS + SAMPLE_MS, `${width}: the thread sat still for ${gap} ms while ${bot} worked`);
    assert.match(last, expect, `${width}: the live line says who is on it`);
    await release(crew, bot, `All set for Umer from ${bot}.`);
    await until('the reply and the end line', async () => /All set for Umer/.test(await screen()) && /Done/.test(await run("document.querySelector('.live-end')?.innerText ?? ''")), 15_000);
  };
  for (const width of [1440, 390]) {
    await journey(width, 'chief', 'Please ask permission before you plan my week', /Chief[\s\S]*At work[\s\S]*Working on it/);
    // On a phone there is no side column: the job passed to Scout is followed in Chief's thread itself.
    await journey(width, 'scout', 'Ask Scout to ask permission first, then look up the tower', /Scout[\s\S]*At work[\s\S]*Passed to Scout/);
  }
});
