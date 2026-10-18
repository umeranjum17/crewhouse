// A call with Chief, end to end: Talk listens, sends what was heard, reads Chief's real reply aloud a sentence at a
// time with this device's own voice at the kept speed, then listens again — never while it reads — and Stop ends it
// with every word in the chat. Real crewd (stub engine, scripted replies) and the real built web app in a real
// Chromium; only the device's ears and voice are stand-ins, logging the turns. Needs a Chromium on PATH (skipped without one).
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

// The device: a recognizer that hears "hi" once, then waits, then finds no microphone, and a voice list with an online voice beside this
// device's own. Each turn lands in window.turns; "ECHO" would mean the mic opened while Chief was being read.
const DEVICE = `(() => {
  const turns = window.turns = []; let speaking = false, heard = 0;
  localStorage.setItem('crewhouse.voice', JSON.stringify({ rate: 1.25 }));
  window.SpeechRecognition = class {
    static available = async () => 'available'; static install = async () => true;
    start() { turns.push('listen'); if (speaking) turns.push('ECHO'); if (++heard === 1) setTimeout(() => { this.onresult({ results: [[{ transcript: 'hi' }]] }); this.onend(); }, 100); if (heard > 2) setTimeout(() => { this.onerror({ error: 'audio-capture' }); this.onend(); }, 50); }
    stop() { setTimeout(() => this.onend(), 0); }
  };
  const voices = [{ name: 'Online', lang: 'en-US', localService: false }, { name: 'Here', lang: 'en-GB', localService: true }];
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { value: {
    getVoices: () => voices, addEventListener() {}, cancel() {},
    speak(u) {
      speaking = true; turns.push('say ' + u.text.trim() + ' @' + u.voice?.name + ' x' + u.rate);
      setTimeout(() => { turns.push('shown ' + document.querySelector('.line.reading .bubble-text')?.textContent + ' | ' + document.querySelector('.call-words')?.textContent); speaking = false; u.onend(); }, 150);
    },
  } });
})()`;

test('a call with Chief listens, sends, reads the reply aloud, listens again, Stop ends it, and a missing microphone says so', { skip: !bin && 'no Chromium here' }, async () => {
  const parent = temp('voice-call');
  cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
  for (const d of ['src', 'templates', 'tools', 'skills', 'package.json']) symlinkSync(join(repo, d), join(parent, d));
  const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  process.env.CREWHOUSE_STUB_GOLDEN = '1'; // "hi" gets Chief's scripted "Hi. What would you like to work on?"
  const { cfg, db, crew, done } = setup();
  Object.assign(cfg, { port: 0, host: '127.0.0.1', linkPort: 0, repoDir: parent });
  const server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const key = readFileSync(join(cfg.stateDir, 'person.key'), 'utf8');
  await fetch(`${base}/api/onboard`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: JSON.stringify({ address: 'Umer' }) });

  const profile = mkdtempSync(join(tmpdir(), 'voice-call-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
  let ws: WebSocket | undefined;
  after(async () => { delete process.env.CREWHOUSE_STUB_GOLDEN; ws?.close(); try { await browser.close(); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); done(); } });
  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 60_000);
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
  const turns = (): Promise<string[]> => run('window.turns');

  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: DEVICE });
  await send('Page.navigate', { url: `${base}/?day#person=${key}` });
  await until('Home', () => run("!!document.querySelector('.stack-home')"), 30_000);
  await run('location.hash = "#/chief"');
  await until('Talk in the empty box', () => run("!!document.querySelector('.chat .dock button.send.talk')"), 30_000);
  assert.equal(await run("document.querySelector('.chat .dock button.send.talk').title"), 'Talk with Chief');

  await run("document.querySelector('.chat .dock button.send.talk').click()");
  await until('Chief read aloud and the mic open again', async () => (await turns()).filter((t) => t === 'listen').length === 2, 30_000);
  assert.deepEqual(await turns(), [
    'listen',
    'say Hi. @Here x1.25', 'shown Hi. What would you like to work on? | Hi.',
    'say What would you like to work on? @Here x1.25', 'shown Hi. What would you like to work on? | What would you like to work on?',
    'listen',
  ], 'heard, sent, read a sentence at a time in the device\'s own voice at the kept speed, then listened again, never while reading');
  assert.equal(await run("document.querySelector('.call').className"), 'call listening');
  await run("document.querySelector('.call-voice summary').click()");
  assert.deepEqual(await run("[...document.querySelectorAll('.call-menu select')[0].options].map((o) => o.value)"), ['Here'], 'only this device\'s own voices are offered');
  assert.equal(await run("document.querySelectorAll('.call-menu select')[1].value"), '1.25', 'the kept speed is chosen');

  await run("document.querySelector('.call-stop').click()");
  await until('the box back with Talk', () => run("!document.querySelector('.call') && !!document.querySelector('.chat .dock button.send.talk')"), 10_000);
  assert.match(await run("document.querySelector('.toast')?.textContent ?? ''"), /Call ended\./);
  assert.deepEqual(db.all("SELECT text FROM messages WHERE bot = 'chief' AND author = 'person'").map((m: any) => m.text), ['hi'], 'what was said is in the chat, once');
  assert.equal(await run("[...document.querySelectorAll('.line .bubble-text')].some((b) => b.textContent === 'Hi. What would you like to work on?')"), true, 'Chief\'s reply stays in the chat');

  await run("document.querySelector('.chat .dock button.send.talk').click()");
  await until('a call with no microphone to end and say so', () => run("!document.querySelector('.call') && /microphone/.test(document.querySelector('.toast')?.textContent ?? '')"), 10_000);
  assert.match(await run("document.querySelector('.toast').textContent"), /I can't hear a microphone on this computer\. Type instead\./);
});
