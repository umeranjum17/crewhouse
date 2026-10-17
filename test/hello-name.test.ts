// Hello (the first run) sent with no name: the words stay in the box and only the name ask shows, with no "Not sent"
// and no toast. Then a name is given and the onboard request fails for real: that send still says Not sent and keeps
// the words for a Retry. Real crewd (stub engine) and the real built web app in a real Chromium, with the browser's own
// network paused on the onboard request to fail it. Needs a Chromium on PATH (skipped without one).
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
import { setup, until } from './lab.ts';
import { browserBin } from '../src/desktop.ts';
import { startServer } from '../src/server.ts';

const repo = join(import.meta.dirname, '..');
const bin = browserBin();

test('Hello with no name keeps the words and asks for the name; a real failed send still says Not sent', { skip: !bin && 'no Chromium here' }, async () => {
  const parent = temp('hello-name');
  cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
  for (const d of ['src', 'templates', 'tools', 'skills', 'package.json']) symlinkSync(join(repo, d), join(parent, d));
  const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const { cfg, db, crew, done } = setup();
  Object.assign(cfg, { port: 0, host: '127.0.0.1', linkPort: 0, repoDir: parent });
  const server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const key = readFileSync(join(cfg.stateDir, 'person.key'), 'utf8');

  const profile = mkdtempSync(join(tmpdir(), 'hello-name-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
  let ws: WebSocket | undefined;
  after(async () => { ws?.close(); try { await browser.close(); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); done(); } });
  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 60_000);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let target: { webSocketDebuggerUrl: string } | undefined;
  await until('a page', async () => (target = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).find((t) => t.type === 'page')), 10_000);
  ws = new WebSocket(target!.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws!.once('open', r); ws!.once('error', j); });
  let id = 0;
  const waiting = new Map<number, (m: any) => void>();
  // The onboard requests the browser pauses, in arrival order.
  const paused: any[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.method === 'Fetch.requestPaused') { paused.push(m.params); return; }
    waiting.get(m.id)?.(m); waiting.delete(m.id);
  });
  const send = (method: string, params: object = {}) => new Promise<any>((r, j) => {
    const n = ++id; waiting.set(n, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result))); ws!.send(JSON.stringify({ id: n, method, params }));
  });
  const run = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };

  await send('Fetch.enable', { patterns: [{ urlPattern: '*api/onboard*', requestStage: 'Request' }] });
  await send('Page.navigate', { url: `${base}/?day#person=${key}` });
  await until('Hello\'s box', () => run("!!document.querySelector('.hello-ask textarea')"), 30_000);

  // No name: the words go into the box, the send is held back, and the box gets the words back. Nothing is sent,
  // no failed line shows, no toast pops up, and the name ask is what is left, with its box focused.
  await run("document.querySelector('.hello-ask textarea').focus()");
  await send('Input.insertText', { text: 'Book the dentist' });
  await until('the send button ready', () => run("!document.querySelector('.hello-ask button.send').disabled"), 10_000);
  await run("document.querySelector('.hello-ask button.send').click()");
  await until('the words back in the box', () => run("document.querySelector('.hello-ask textarea').value === 'Book the dentist'"), 10_000);
  const asked = await run(`({
    paused: 0,
    failed: !!document.querySelector('.hello-ask .send-failed'),
    notSent: /Not sent/.test(document.body.innerText),
    toasts: [...document.querySelectorAll('.toast')].map((e) => e.innerText).join(' '),
    nameBox: !!document.querySelector('.name-ask input'),
    nameFocused: document.activeElement === document.querySelector('.name-ask input'),
  })`) as Record<string, unknown>;
  assert.deepEqual({ ...asked, paused: paused.length }, { paused: 0, failed: false, notSent: false, toasts: '', nameBox: true, nameFocused: true }, 'no name: only the name ask shows, and nothing was sent');

  // A name is given, and the onboard request fails for real: that send says Not sent, and the words stay for a Retry.
  await run("document.querySelector('.name-ask input').focus()");
  await send('Input.insertText', { text: 'Umer' });
  await run("document.querySelector('.hello-ask textarea').focus()");
  await run("document.querySelector('.hello-ask button.send').click()");
  let held: any;
  await until('the onboard request held in the browser', () => (held = paused.shift()), 15_000);
  await send('Fetch.failRequest', { requestId: held.requestId, errorReason: 'ConnectionFailed' });
  await until('the Not sent line', () => run("!!document.querySelector('.hello-ask .send-failed')"), 10_000);
  assert.match(await run("document.querySelector('.hello-ask .send-failed').innerText"), /Not sent/, 'a real failed send says so');
  assert.equal(await run("!!document.querySelector('.hello-ask .send-failed button')"), true, 'the failed send offers a Retry');
  assert.equal(await run("document.querySelector('.hello-ask textarea').value"), 'Book the dentist', 'the words stay in the box after a real failure');
});
