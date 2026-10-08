// The helper's answer reaches Chief in its own words, including long sentences and bullet-only replies.
// Same real crewd / stub engine / built app / owned browser setup as chat-live; no live-line timing claims.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { taskBrowser } from './browser.ts';
import { temp } from './tmp.ts';
import { setup, until, release, holding } from './lab.ts';
import { browserBin } from '../src/desktop.ts';
import { startServer } from '../src/server.ts';

const repo = join(import.meta.dirname, '..'), bin = browserBin();
test('helper relays in Chief carry long and bullet-only answers', { skip: !bin && 'no Chromium here' }, async (t) => {
  const parent = temp('chat-relay');
  cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
  for (const d of ['src', 'templates', 'tools', 'skills', 'package.json']) symlinkSync(join(repo, d), join(parent, d));
  const built = spawnSync(process.execPath, [join(repo, 'scripts/build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const { cfg, db, crew, done } = setup();
  Object.assign(cfg, { port: 0, host: '127.0.0.1', linkPort: 0, repoDir: parent });
  const server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = (method: string, path: string, body?: object) => fetch(base + path, { method, headers: { authorization: method === 'GET' ? '' : `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  await api('POST', '/api/onboard', { address: 'Umer' });
  assert.equal((await api('POST', '/api/recruit', { template: 'scout', name: 'Scout' })).id, 'scout');
  const profile = mkdtempSync(join(tmpdir(), 'chat-relay-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank'], profile);
  let ws: WebSocket | undefined, recorder: ReturnType<typeof spawn> | undefined;
  t.after(async () => { recorder?.kill('SIGTERM'); ws?.close(); try { await browser.close(); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); done(); } });
  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 30_000);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let target: { webSocketDebuggerUrl: string } | undefined;
  await until('a page', async () => (target = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).find((p) => p.type === 'page')), 10_000);
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
  const screen = () => run("[...document.querySelectorAll('.chat .lines')].filter(e => e.offsetParent).map(e => e.innerText).join('|')");
  const evidence = process.env.CREWHOUSE_RELAY_EVIDENCE;
  if (evidence) mkdirSync(evidence, { recursive: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `${base}/?day#person=${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}` });
  await until('Chief\'s box and opening overlay gone', () => run("!!document.querySelector('.chat .dock textarea') && !document.querySelector('.splash')"), 30_000);
  const relays: string[] = [];
  for (const [slug, reply] of [
    ['long', 'I found that your three overdue invoices need attention before Friday because the water bill and dentist bill both carry late fees, while the phone bill can wait until next month without an extra charge.'],
    ['bullets', '- Water bill due Friday\n- Dentist bill due Friday\n- Phone bill due next month'],
  ]) {
    if (evidence && slug === 'long') {
      recorder = spawn(process.execPath, [join(repo, '.agents/skills/verify-crewhouse/record.mjs'), `http://127.0.0.1:${port}`, base, join(evidence, 'relay.webm')]);
      let output = ''; recorder.stdout!.on('data', (d) => { output += d; }); recorder.stderr!.on('data', (d) => { output += d; });
      await until('relay recording ready', () => output.includes('RECORDING'), 10_000);
      recorder.on('close', () => writeFileSync(join(evidence, 'recording.log'), output));
    }
    await run("document.querySelector('.chat .dock textarea').focus()");
    await send('Input.insertText', { text: `Ask Scout to ask permission first, then check my ${slug} invoice list` });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await holding(crew, 'scout');
    const task = crew.sessionOf('scout')!.task;
    await release(crew, 'scout', reply);
    await until('Scout finishes and relays to Chief', () => db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ?", task), 15_000);
    assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', task)!.state, 'done');
    const relay = db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ?", task)!.text as string;
    relays.push(relay);
    await until('the relay painted in Chief', async () => (await screen()).includes(relay), 15_000);
    if (recorder) { const exited = new Promise<number | null>((r) => recorder!.once('close', r)); recorder.kill('SIGTERM'); assert.equal(await exited, 0, 'the relay recording has multiple real frames'); recorder = undefined; }
    if (evidence) {
      writeFileSync(join(evidence, `${slug}.json`), JSON.stringify({ reply, relay, chief: await api('GET', '/api/bots/chief'), scout: await api('GET', '/api/bots/scout') }, null, 2));
      for (const width of [390, 1440]) for (const theme of ['day', 'night']) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
        await send('Page.navigate', { url: `${base}/?${theme}#/` });
        await until('relay after theme change and opening overlay gone', async () => (await screen()).includes(relay) && await run("!document.querySelector('.splash')"), 15_000);
        await run('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))');
        const geometry = await run(`(() => { const e = [...document.querySelectorAll('.chat .lines p')].find(e => e.innerText === ${JSON.stringify(relay)}); const box = e?.closest('.lines'); if (box) box.scrollTop = box.scrollHeight; window.scrollTo(0,0); const r = e?.getBoundingClientRect(); return { text:e?.innerText, rect:r?.toJSON(), width:innerWidth, height:innerHeight }; })()`);
        assert.ok(geometry.rect && geometry.rect.left >= 0 && geometry.rect.right <= width && geometry.rect.top >= 0 && geometry.rect.bottom <= geometry.height, 'the complete relay fits the viewport');
        writeFileSync(join(evidence, `${slug}-${theme}-${width}.json`), JSON.stringify(geometry));
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(evidence, `${slug}-${theme}-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
  }
  assert.match(relays[0], /^I found that your three overdue invoices.*…$/);
  assert.ok(relays[0].length <= 160);
  assert.equal(relays[1], 'Water bill due Friday…');
});
