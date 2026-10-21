// The public web app's whole pairing journey in a real browser: the built shell served by crewd's phone link at a
// public-style origin (`crewhouse.localhost`, loopback to the browser but not a loopback name to the app) opens on
// Chief's first question, Where should I work?; On my computer opens the Pair sheet, a relay code pastes in, the page shows the same two words the computer asks about, and on yes
// the same page opens on crewd's real data over the link (web/src/link.ts). A reload stays paired, Unpair goes back to
// the first question and the computer forgets the device, and the computer's 12-letter code pairs too. Paired, Home offers closed-app news
// once (Not now keeps it away). Needs a Chromium on PATH (skipped without one).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { taskBrowser } from './browser.ts';
import { browserBin } from '../src/desktop.ts';
import { startRelay } from '../relay/main.ts';
import { temp } from './tmp.ts';
import { until, delegated } from './lab.ts';
import { LinkError } from '@byokit/pair';
import { pair } from '../web/src/link.ts';
import { pairWords } from '../mobile/src/pair-words.ts';
import { NO_COMPUTER, NO_HERE } from '../web/src/typed.ts';

const repo = join(import.meta.dirname, '..');
const bin = browserBin();
const root = temp('pwa-pair');
const free = () => new Promise<number>((r) => { const s: Server = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });

test('the public web app asks where Chief works, pairs by a relay code or the 12-letter code, opens on real data, and unpairs back to the question', { skip: !bin && 'no Chromium on PATH' }, async () => {
  // The app as the installed web app opens it: from crewd's own link port (`./crewhouse phones web` publishes that).
  if (!existsSync(join(repo, 'web', 'dist', 'index.html'))) assert.equal(spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs')]).status, 0);
  const relay = await startRelay({ port: 0, dataDir: join(root, 'relay'), signup: 'open' });
  const port = await free(), linkPort = await free(), base = `http://127.0.0.1:${port}`, shell = `http://crewhouse.localhost:${linkPort}/`;
  const daemon = spawn(process.execPath, [join(repo, 'src', 'main.ts')], {
    env: { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: String(linkPort), CREWHOUSE_LINK_HOST: '127.0.0.1',
      CREWHOUSE_RELAY: relay.url, CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const profile = mkdtempSync(join(tmpdir(), 'pwa-pair-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
  let ws: WebSocket | undefined;
  after(async () => { ws?.close(); daemon.kill(); await relay.close(); await browser.close(); });

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
  // Unpair and reload navigate the page under a poll: a poll that lands mid-navigation is "not yet", not a failure.
  const mode = () => run(`document.querySelector('.where') ? 'where' : document.querySelector('main') ? (document.querySelector('.demo-tag') ? 'demo' : 'real') : document.querySelector('.fr-hello') ? 'real' : ''`)
    .catch((e: Error) => { if (/navigated or closed/.test(e.message)) return ''; throw e; });
  const devices = async () => (await http('GET', '/api/phones')).length;

  /** Paste a code into the Pair sheet, then say yes at the computer once its two words match the page's. */
  const pair = async (code: string) => {
    await run(`[...document.querySelectorAll('.where-opt')].find((b) => /On my computer/.test(b.textContent)).click()`);
    await until('the pair sheet', () => run(`!!document.querySelector('.pair-code')`));
    await run(`(() => { const t = document.querySelector('.pair-code');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(code)});
      t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await run(`document.querySelector('.fr-acts .btn.go').click()`);
    let asking: { id: number; words: string } | undefined, words = '';
    await until('the computer to ask', async () => (asking = (await http('GET', '/api/phones/link')).asking[0]), 20_000);
    await until('the two words on the page', async () => (words = await run(`document.querySelector('.pair-words')?.textContent ?? ''`)));
    assert.equal(words, asking!.words, 'both screens show the same two words');
    await http('POST', '/api/phones/answer', { id: asking!.id, yes: true });
    await until('the same page on real data', async () => (await mode()) === 'real', 20_000);
  };

  await send('Page.navigate', { url: shell });
  await until('the first question', async () => (await mode()) === 'where', 30_000);
  // A release build keeps the cloud row off until BYOKit's cloud kit is published (CREWHOUSE_CLOUD unset).
  assert.deepEqual(await run(`[...document.querySelectorAll('.where-opt b')].map((b) => b.textContent)`), ['On my computer']);
  // The web app has no phone-only mode to offer, so there is no row that dead-ends.

  // A share that lands before the person has paired is kept, not dropped: the Share view asks to connect first (J14).
  await send('Page.navigate', { url: `${shell}share?text=Dinner%20at%20Luigi` });
  await until('the share view, unpaired', () => run(`!!document.querySelector('.share .share-tile') && /Dinner at Luigi/.test(document.body.innerText)`), 20_000);
  assert.equal(await run(`!!document.querySelector('.where')`), false, 'a share is not swallowed by the first question');
  await run(`[...document.querySelectorAll('.share .btn.go')].find((b) => /Connect to send/.test(b.textContent)).click()`);
  await until('the pair page over the share', () => run(`!!document.querySelector('.pair-code')`));
  await send('Page.navigate', { url: shell });
  await until('the first question again', async () => (await mode()) === 'where', 30_000);

  // From anywhere: the relay's code, written as `./crewhouse phones code` prints it.
  const away = await http('POST', '/api/phones/code', { role: 'control' });
  await pair(`${away.short}-${away.code}@${away.relay}`);
  assert.equal(await devices(), 1, 'the computer lists this browser');
  // A change goes over the link too: the first run opens on Chief's chat, and the name answered there lands in crewd.
  await until('Chief asks the name', () => run(`location.hash === '#/chief' && /What shall I call you/.test(document.body.innerText)`));
  await run(`document.querySelector('.dock textarea').focus()`);
  await send('Input.insertText', { text: 'Umer' });
  await until('the send button ready', () => run(`!document.querySelector('.dock button.send').disabled`));
  await run(`document.querySelector('.dock button.send').click()`);
  await until('onboarded over the link', async () => (await http('GET', '/api/state')).person.onboarded === 1, 20_000);
  await until('his pitch with the ideas to try', () => run(`document.querySelectorAll('.chips.center .chip').length >= 3`));
  assert.equal((await http('GET', '/api/state')).person.address, 'Umer');

  // A cold start keeps the grant: the installed app opens paired, never on the demo.
  await send('Page.navigate', { url: shell });
  await until('paired again after a reload', async () => (await mode()) === 'real', 30_000);
  // Closed-app news is offered once on Home, as a tap (a browser prompts only from one); Not now puts it away on
  // this device for good, and Settings keeps its own row.
  const offer = `[...document.querySelectorAll('.card')].find((c) => /Get news when the app is closed/.test(c.textContent))`;
  await run(`location.hash = '#/'`); // onboarding left the page on Chief's thread; the offer is on Home
  await until('the news offer', () => run(`!!${offer}`), 20_000);
  await run(`[...${offer}.querySelectorAll('button')].find((b) => b.textContent === 'Not now').click()`);
  assert.equal(await run(`!!${offer}`), false, 'Not now puts the offer away');
  assert.equal(await run(`localStorage.getItem('crewhouse.newsOffer')`), '1', 'and this device remembers the answer');
  await run(`location.hash = '#/settings'`);
  await until('the paired row', () => run(`[...document.querySelectorAll('.card')].some((c) => /Paired with your computer/.test(c.textContent))`));
  assert.equal(await run(`!![...document.querySelectorAll('.go-to .grow b')].find((b) => b.textContent === 'Phones')`), false, 'phones stay the computer’s to manage');
  // Chief's computer is the cloud kit's too: a release build lists no row for it.
  assert.deepEqual(await run(`[...document.querySelectorAll('.go-to .grow b')].map((a) => a.textContent)`), ['You', 'What the crew remembers', 'AI accounts', 'Apps']);
  // Notifications are first-class paired: the state line and its one action sit on the paired card, its key asked
  // over the link (`POST /api/push {key}`, never /api/phones/link).
  await until('the notifications line', () => run(`/Notifications: (On|Off)/.test(document.body.innerText)`));
  assert.match(await run(`document.body.innerText`), /Notifications: Off · Turn on/);
  await run(`(() => { window.confirm = () => true; [...document.querySelectorAll('button')].find((b) => b.textContent === 'Unpair').click(); })()`);
  await until('back to the first question', async () => (await mode()) === 'where', 20_000);
  assert.equal(await devices(), 0, 'the computer forgot this browser');

  // At home: the 12-letter code, as the first line `./crewhouse phones code` prints; the app dials its own address.
  const typed = (await http('POST', '/api/phones/pair', { role: 'control' })).typed;
  assert.equal(typed.replace(/-/g, '').length, 12);
  await pair(typed);
  assert.equal(await devices(), 1);
  // A computer with no mailbox: the paired app (direct-paired, so still connected) says so in plain words,
  // never a broken toggle. The switch itself stays off — nothing to tap that cannot work.
  await http('PUT', '/api/phones/relay', { url: '' });
  await send('Page.navigate', { url: shell });
  await until('paired after the mailbox went', async () => (await mode()) === 'real', 30_000);
  await run(`location.hash = '#/settings'`);
  await until('the plain no-mailbox words', () => run(`/no mailbox for notifications yet/.test(document.body.innerText)`));
  assert.equal(await run(`[...document.querySelectorAll('.notify-on,.notify-off')].length`), 0, 'nothing to tap that cannot work');

  // The computer's QR is a link to its own web app once it has a web address (Tailscale's, or the person's own server's;
  // here the page's own origin): the phone's camera opens that app, which pairs from the address with no typing.
  await run(`(() => { window.confirm = () => true; [...document.querySelectorAll('button')].find((b) => b.textContent === 'Unpair').click(); })()`);
  await until('back to the first question for the link', async () => (await mode()) === 'where', 20_000);
  assert.deepEqual(await http('PUT', '/api/phones/web', { address: 'not an address' }).then((r) => r.error), 'a web address starts with https://');
  assert.equal((await http('PUT', '/api/phones/web', { address: new URL(shell).origin })).web, new URL(shell).origin);
  const qr = (await http('POST', '/api/phones/pair', { role: 'control' })).qr as string;
  assert.ok(qr.startsWith(`${new URL(shell).origin}/#byokit-link:`), 'the QR is a link to the computer\'s own app');
  await send('Page.navigate', { url: qr });
  let asking: { id: number; words: string } | undefined;
  await until('the computer to ask', async () => (asking = (await http('GET', '/api/phones/link')).asking[0]), 20_000);
  await until('the two words on the page', async () => (await run(`document.querySelector('.pair-words')?.textContent ?? ''`)) === asking!.words);
  assert.equal(await run(`location.hash`), '#/pair', 'the offer is out of the address bar once it is used');
  await http('POST', '/api/phones/answer', { id: asking!.id, yes: true });
  await until('the same page on real data from the link', async () => (await mode()) === 'real', 20_000);
  assert.equal(await devices(), 1, 'the computer lists this browser');
});

test('a well-formed code whose relay cannot be reached says so in plain words and pairs nothing', async () => {
  await assert.rejects(pair('VBF8PJ-G4S7-KC97-H5GM@http://127.0.0.1:1', () => {}), { message: "Could not reach your computer's relay. Check it is on and try again." });
});

test('a mistyped 12-letter code says it has a typo, not that it is cut off', async () => {
  await assert.rejects(pair('BCDF-GHJK-MNP1', () => {}), { message: 'That code has a typo. Check the 12 letters on your computer and try again.' });
});

test('a 12-letter code typed on a page that is not the computer says to scan its QR', async () => {
  // The page's own origin is the computer's link (web/src/link.ts `pair`): nothing listens on this one.
  Object.assign(globalThis, { location: new URL('http://127.0.0.1:1/') });
  try {
    await assert.rejects(pair('BCDF-GHJK-MNPQ', () => {}), { message: NO_HERE });
  } finally {
    delete (globalThis as { location?: unknown }).location;
  }
});

test('the phone words a failure with the same sentences the web app shows, and an approval that timed out with the link\'s own', async () => {
  const failure = (p: Promise<unknown>) => p.then(() => assert.fail('it paired'), (e: Error) => e);
  const relay = await failure(pair('VBF8PJ-G4S7-KC97-H5GM@http://127.0.0.1:1', () => {}));
  const computer = new Error(NO_COMPUTER); // the phone's own (mobile/src/link.ts): it is on the Wi-Fi
  assert.equal(pairWords(computer), 'Your phone could not find your computer on this Wi-Fi. Scan the QR on your computer instead.');
  assert.equal(pairWords(relay), "Could not reach your computer's relay. Check it is on and try again.");
  assert.equal(pairWords(new LinkError('timeout')), "Your computer didn't answer in time.");
  assert.equal(pairWords(new Error('That code has a typo. Check the 12 letters on your computer and try again.')), 'That code has a typo. Check the 12 letters on your computer and try again.');
});
