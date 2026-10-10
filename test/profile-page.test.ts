// About me and my work (crew brain slice 3): the record every helper reads before a job is shown in
// Settings in plain words, and each part of it can be changed, forgotten and added to. Driven in a real
// Chromium on the built app, through the same GET/PUT /api/profile the app itself calls, so a save that
// shows and survives a reload is the record the next helper job reads. Needs a Chromium on PATH (skipped
// without one).
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

const parent = temp('profile-web');
cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
symlinkSync(join(repo, 'src'), join(parent, 'src'), 'dir');
const dist = join(parent, 'web', 'dist');
const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });

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
  const profile = mkdtempSync(join(tmpdir(), 'profile-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
  let ws: WebSocket;
  after(async () => { ws?.close(); server.close(); await browser.close(); });
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
  await send('Page.enable'); await send('Runtime.enable');
  return { run, open: async (query: string) => { await send('Page.navigate', { url: `${base}/?${query}` }); } };
}

const parts = () => `[...document.querySelectorAll('.profile-part')].map((el) => el.querySelector('.grow')?.textContent?.trim() ?? '')`;
const press = (i: number, what: string) => `[...[...document.querySelectorAll('.profile-part')][${i}].querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(what)}).click()`;
const setInput = (sel: string, text: string) => `(() => { const t = document.querySelector(${JSON.stringify(sel)});
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`;

test('the app is built', () => {
  assert.equal(built.status, 0, built.stderr);
  assert.ok(readdirSync(dist).some((f) => f.endsWith('.js')));
});

test('the one Memory record: a sentence can be forgotten with an Undo, and added to', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.open('demo=calm&day#/settings');
  await until('the record in plain parts', () => b.run(`document.querySelectorAll('.profile-part').length >= 3`), 30_000);
  assert.deepEqual(await b.run(parts()), [
    'I run a bakery for my neighbourhood.',
    'My business is called Morning Loaf.',
    'I write in a warm, plain voice.',
  ]);
  // Forget the middle sentence: a "Forgotten" row with an Undo sits where it was, and the record loses it.
  await b.run(press(1, 'Forget'));
  await until('the Forgotten row', () => b.run(`!!document.querySelector('.memory-lines .forgotten')`), 10_000);
  assert.deepEqual(await b.run(parts()), [
    'I run a bakery for my neighbourhood.',
    'I write in a warm, plain voice.',
  ]);
  // Leave and come back: the section reads the record afresh, so the shorter record proves the Forget landed.
  await b.run(`location.hash = '#/';`);
  await b.run(`location.hash = '#/settings';`);
  await until('the shorter record after leaving and coming back', () => b.run(`document.querySelectorAll('.profile-part').length === 2`), 30_000);
  assert.deepEqual(await b.run(parts()), [
    'I run a bakery for my neighbourhood.',
    'I write in a warm, plain voice.',
  ]);
  // Add a sentence back: it lands at the end of the record.
  await b.run(setInput('.profile-add', 'My regulars order the almond croissants.'));
  await b.run(`[...document.querySelectorAll('.add-row button')].find((x) => x.textContent === 'Add' && x.closest('.add-row').querySelector('.profile-add')).click()`);
  await until('the added part', () => b.run(`document.querySelectorAll('.profile-part').length === 3`), 10_000);
  assert.deepEqual(await b.run(parts()), [
    'I run a bakery for my neighbourhood.',
    'I write in a warm, plain voice.',
    'My regulars order the almond croissants.',
  ]);
  // Forget it, then Undo puts the exact sentence back where it was.
  await b.run(press(2, 'Forget'));
  await until('the Forgotten row again', () => b.run(`!!document.querySelector('.memory-lines .forgotten')`), 10_000);
  assert.deepEqual(await b.run(parts()), [
    'I run a bakery for my neighbourhood.',
    'I write in a warm, plain voice.',
  ]);
  await b.run(`document.querySelector('.memory-lines .forgotten button').click()`);
  await until('the sentence back', () => b.run(`!document.querySelector('.memory-lines .forgotten') && document.querySelectorAll('.profile-part').length === 3`), 10_000);
  assert.deepEqual(await b.run(parts()), [
    'I run a bakery for my neighbourhood.',
    'I write in a warm, plain voice.',
    'My regulars order the almond croissants.',
  ]);
});

// Memory (ch-ux-memory-one-section): one section for what the crew knows, not two near-identical ones, with the
// whole crew's own lines and Chief's record listed together and either one forgettable; a crew line's Forget offers
// an Undo that puts the exact line back. Driven in real Chromium.
test('one Memory section lists both records, and a crew line can be forgotten and put back', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.open('demo=calm&day#/settings');
  await until('the one Memory section', () => b.run(`document.getElementById('memory')?.textContent === 'Memory'`), 30_000);
  await until('both lists in one card', () => b.run(`document.querySelectorAll('.memory-lines .profile-part').length === 3 && document.querySelectorAll('.memory-lines .memory-you').length === 3`), 30_000);
  const you = `[...document.querySelectorAll('.memory-you .grow')].map((el) => el.textContent.trim())`;
  assert.deepEqual(await b.run(you), ['Vegetarian', 'Lives in Larkspur', 'Prefers weekend plans before Thursday']);
  assert.deepEqual(await b.run(parts()), [
    'I run a bakery for my neighbourhood.',
    'My business is called Morning Loaf.',
    'I write in a warm, plain voice.',
  ]);
  // Forget the middle crew line: a "Forgotten" row with an Undo sits where it was.
  await b.run(`[...document.querySelectorAll('.memory-you')][1].querySelector('button').click()`);
  await until('the Forgotten row', () => b.run(`!!document.querySelector('.memory-lines .row-item.forgotten')`), 10_000);
  assert.deepEqual(await b.run(you), ['Vegetarian', 'Prefers weekend plans before Thursday']);
  // Undo puts the exact line back, in its place.
  await b.run(`document.querySelector('.memory-lines .row-item.forgotten button').click()`);
  await until('the line back', () => b.run(`!document.querySelector('.memory-lines .row-item.forgotten') && document.querySelectorAll('.memory-you').length === 3`), 10_000);
  assert.deepEqual(await b.run(you), ['Vegetarian', 'Lives in Larkspur', 'Prefers weekend plans before Thursday']);
});

// A kept memory is announced once in the chat as "Saved: …" with an Undo that takes it back, and never repeats.
test('a saved memory shows one Saved: line with an Undo that takes it back', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.open('demo=saved&day#/chief');
  await until('the one Saved line', () => b.run(`document.querySelectorAll('.saved-undo').length === 1`), 30_000);
  assert.match(await b.run(`document.querySelector('.saved-undo').closest('.card.answered').textContent`), /Saved: Prefers weekend plans before Thursday/);
  await b.run(`document.querySelector('.saved-undo').click()`);
  await until('the line gone after Undo', () => b.run(`document.querySelectorAll('.saved-undo').length === 0`), 10_000);
});
