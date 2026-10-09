// The public web app's whole pairing journey in a real browser: the built shell served from a public-style origin
// (`crewhouse.localhost`, loopback to the browser but not a loopback name to the app) opens in demo with its Pair
// button; a relay code pastes in, the page shows the same two words the computer asks about, and on yes the same page
// opens on crewd's real data over the link (web/src/link.ts). A reload stays paired, Unpair goes back to the demo and
// the computer forgets the device, and the long direct code pairs too. Needs a Chromium on PATH (skipped without one).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { taskBrowser } from './browser.ts';
import { browserBin } from '../src/desktop.ts';
import { startRelay } from '../relay/main.ts';
import { temp } from './tmp.ts';
import { until } from './lab.ts';

const repo = join(import.meta.dirname, '..');
const bin = browserBin();
const root = temp('pwa-pair');
const free = () => new Promise<number>((r) => { const s: Server = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });

test('the public demo app pairs by a relay code or a direct code, opens on real data, and unpairs back to the demo', { skip: !bin && 'no Chromium on PATH' }, async () => {
  // A copy of the web tree, so the checkout's own dist stays as its last real build (as test/office.test.ts does).
  cpSync(join(repo, 'web'), join(root, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
  symlinkSync(join(repo, 'src'), join(root, 'src'), 'dir');
  const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(root, 'web')], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const dist = join(root, 'web', 'dist');
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
  const web = createServer((q, s) => {
    const p = decodeURIComponent(new URL(q.url ?? '/', 'http://x').pathname).replace(/\.\.+/g, '');
    const f = join(dist, p === '/' ? 'index.html' : p);
    if (!existsSync(f) || !statSync(f).isFile()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }); s.end(readFileSync(f));
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  const shell = `http://crewhouse.localhost:${(web.address() as AddressInfo).port}/`;

  const relay = await startRelay({ port: 0, dataDir: join(root, 'relay'), signup: 'open' });
  const port = await free(), linkPort = await free(), base = `http://127.0.0.1:${port}`;
  const daemon = spawn(process.execPath, [join(repo, 'src', 'main.ts')], {
    env: { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: String(linkPort), CREWHOUSE_LINK_HOST: '127.0.0.1',
      CREWHOUSE_RELAY: relay.url, CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const profile = mkdtempSync(join(tmpdir(), 'pwa-pair-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
  let ws: WebSocket | undefined;
  after(async () => { ws?.close(); daemon.kill(); web.close(); await relay.close(); await browser.close(); });

  const http = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'x-crewhouse': '1', 'content-type': 'application/json', authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8')}` }, body: body ? JSON.stringify(body) : undefined });
    return res.json() as Promise<any>;
  };
  await until('crewd and its relay', async () => (await http('GET', '/api/phones/link').catch(() => null))?.relayStatus === 'online', 30_000);

  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 30_000);
  let page: { webSocketDebuggerUrl: string } | undefined;
  await until('a page', async () => (page = ((await (await fetch(`http://127.0.0.1:${readFileSync(portFile, 'utf8').split('\n')[0]}/json/list`)).json()) as any[]).find((t) => t.type === 'page')), 10_000);
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
  const mode = () => run(`document.querySelector('main') ? (document.querySelector('.demo-tag') ? 'demo' : 'real') : document.querySelector('.hello') ? 'real' : ''`);
  const devices = async () => (await http('GET', '/api/phones')).length;

  /** Paste a code into the Pair sheet, then say yes at the computer once its two words match the page's. */
  const pair = async (code: string) => {
    await run(`location.hash = '#/pair'`);
    await until('the pair sheet', () => run(`!!document.querySelector('.pair-code')`));
    await run(`(() => { const t = document.querySelector('.pair-code');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(code)});
      t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await run(`document.querySelector('.flow .btn.go').click()`);
    let asking: { id: number; words: string } | undefined, words = '';
    await until('the computer to ask', async () => (asking = (await http('GET', '/api/phones/link')).asking[0]), 20_000);
    await until('the two words on the page', async () => (words = await run(`document.querySelector('.pair-words')?.textContent ?? ''`)));
    assert.equal(words, asking!.words, 'both screens show the same two words');
    await http('POST', '/api/phones/answer', { id: asking!.id, yes: true });
    await until('the same page on real data', async () => (await mode()) === 'real', 20_000);
  };

  await send('Page.navigate', { url: shell });
  await until('the demo', async () => (await mode()) === 'demo', 30_000);
  assert.match(await run(`document.querySelector('.pair-row')?.textContent ?? ''`), /Pair — yes, let's go/);

  // From anywhere: the relay's code, written as `./crewhouse phones code` prints it.
  const away = await http('POST', '/api/phones/code', { role: 'control' });
  await pair(`${away.short}-${away.code}@${away.relay}`);
  assert.equal(await devices(), 1, 'the computer lists this browser');
  // A change goes over the link too: the first-run name and idea land in crewd.
  await until('the first run', () => run(`!!document.querySelector('.hello .idea')`));
  await run(`(() => { document.querySelector('button.name-ask')?.click(); })()`);
  await until('the name box', () => run(`!!document.querySelector('.name-ask input')`));
  await run(`(() => { const i = document.querySelector('.name-ask input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Maya'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await run(`document.querySelector('.hello .idea').click()`);
  await until('onboarded over the link', async () => (await http('GET', '/api/state')).person.onboarded === 1, 20_000);
  assert.equal((await http('GET', '/api/state')).person.address, 'Maya');

  // A cold start keeps the grant: the installed app opens paired, never on the demo.
  await send('Page.navigate', { url: shell });
  await until('paired again after a reload', async () => (await mode()) === 'real', 30_000);
  await run(`location.hash = '#/settings'`);
  await until('the paired row', () => run(`[...document.querySelectorAll('.card')].some((c) => /Paired with your computer/.test(c.textContent))`));
  assert.equal(await run(`!!document.getElementById('setup-phones')`), false, 'phones stay the computer’s to manage');
  await run(`(() => { window.confirm = () => true; [...document.querySelectorAll('button')].find((b) => b.textContent === 'Unpair').click(); })()`);
  await until('back to the demo', async () => (await mode()) === 'demo', 20_000);
  assert.equal(await devices(), 0, 'the computer forgot this browser');

  // At home: the long direct code, as the first line `./crewhouse phones code` prints.
  await pair((await http('POST', '/api/phones/pair', { role: 'control' })).typed);
  assert.equal(await devices(), 1);
});
