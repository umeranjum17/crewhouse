// A send the computer hasn't answered in a few seconds says so ("Reconnecting…") instead of sitting in the box as a
// dead button; a send that fails offers a Retry, and the Retry sends the same words once. Real crewd (stub engine)
// and the real built web app in a real Chromium, with the browser's own network paused on the send request (CDP
// Fetch) to hold it then fail it. Needs a Chromium on PATH (skipped without one).
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

test('a stalled send says it is held, a failed one offers Retry, and Retry sends once', { skip: !bin && 'no Chromium here' }, async () => {
  const parent = temp('send-stall');
  cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
  for (const d of ['src', 'templates', 'tools', 'skills', 'package.json']) symlinkSync(join(repo, d), join(parent, d));
  const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const { cfg, db, crew, done } = setup();
  Object.assign(cfg, { port: 0, host: '127.0.0.1', linkPort: 0, repoDir: parent });
  const server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const key = readFileSync(join(cfg.stateDir, 'person.key'), 'utf8');
  const api = (method: string, path: string, body?: object) => fetch(base + path, { method, headers: { authorization: `Bearer ${key}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  await api('POST', '/api/onboard', { address: 'Umer' });

  const profile = mkdtempSync(join(tmpdir(), 'send-stall-browser-'));
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
  // The send requests the browser pauses, in arrival order (Fetch.requestPaused has no id of its own).
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

  // The browser's own network, paused on the send POST: the words are in flight and unanswered.
  await send('Fetch.enable', { patterns: [{ urlPattern: '*bots/chief/messages*', requestStage: 'Request' }] });
  await send('Page.navigate', { url: `${base}/?day#person=${key}` });
  await until('Chief\'s box', () => run("!!document.querySelector('.chat .dock textarea')"), 30_000);
  await run("document.querySelector('.chat .dock textarea').focus()");
  await send('Input.insertText', { text: 'Book the dentist' });
  await until('the send button ready', () => run("!document.querySelector('.chat .dock button.send').disabled"), 10_000);

  const line = () => run("[...document.querySelectorAll('.dock .composer .send-away, .dock .composer .send-failed')].map((e) => e.innerText).join(' ').replace(/\\s+/g, ' ').trim()");
  const words = () => run("document.querySelector('.chat .dock textarea').value");

  // The send is paused and unanswered: after a few seconds the box says so, and keeps the words.
  let held: any;
  await run("document.querySelector('.chat .dock button.send').click()");
  await until('the send request held in the browser', () => (held = paused.shift()), 15_000);
  await until('the Reconnecting line', async () => /Reconnecting/.test(await line()), 20_000);
  assert.match(await line(), /Reconnecting/, 'a send the computer has not answered says the words are held');
  assert.equal(await words(), 'Book the dentist', 'the words stay in the box while it waits');

  // The request fails: not sent, with a Retry, and the words are still there.
  await send('Fetch.failRequest', { requestId: held.requestId, errorReason: 'ConnectionFailed' });
  await until('the Not sent line', async () => /Not sent/.test(await line()), 10_000);
  assert.match(await line(), /Not sent/, 'a failed send says so');
  assert.equal(await run("!!document.querySelector('.dock .composer .send-failed button')"), true, 'the failed send offers a Retry');
  assert.equal(await words(), 'Book the dentist', 'the words stay in the box after it fails');

  // Retry: the same words go again, once, and the box clears only once the computer answers.
  let again: any;
  await run("document.querySelector('.dock .composer .send-failed button').click()");
  await until('the retried send request', () => (again = paused.shift()), 15_000);
  await send('Fetch.continueRequest', { requestId: again.requestId });
  await until('the words sent and the line gone', () => run("!document.querySelector('.dock .composer .send-away') && !document.querySelector('.dock .composer .send-failed') && document.querySelector('.chat .dock textarea').value === ''"), 15_000);
  assert.equal(await words(), '', 'the box clears once the words are really sent');

  // Exactly one message reached the crew — the Retry's — never two from the held request.
  const mine = db.all("SELECT text FROM messages WHERE bot = 'chief' AND author = 'person' ORDER BY id");
  assert.deepEqual(mine.map((m: any) => m.text), ['Book the dentist'], 'the words went once, on the Retry');
});
