// Send one message in the real web app and record what the thread shows from send to the end: every visible change
// timed in the page (changes.json: the longest still screen), a row per change every 250 ms (screen.jsonl), one
// screenshot a second named by ms since send (frames/), and crewd's own /ws push (push.jsonl).
// Usage: node chat-probe.mjs <base> <outdir> <message> [width height] [path, e.g. /?night#/] [max seconds]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const [base, out, message, W = '1440', H = '900', path = '/?day#/', maxS = '300'] = process.argv.slice(2);
mkdirSync(join(out, 'frames'), { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'chat-probe-'));
const chrome = spawn(process.env.CHROMIUM ?? '/usr/bin/chromium', ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 30000) => { const end = Date.now() + ms; for (;;) { const v = await f().catch(() => undefined); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await sleep(100); } };
const pf = join(profile, 'DevToolsActivePort');
await until(async () => existsSync(pf) && readFileSync(pf, 'utf8').includes('\n'));
const port = readFileSync(pf, 'utf8').split('\n')[0];
const page = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const wait = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); wait.get(d.id)?.(d); wait.delete(d.id); };
const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; wait.set(n, (m) => (m.error ? j(new Error(m.error.message)) : r(m.result))); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 600 });
await send('Page.navigate', { url: base + path });
await until(() => run("!!document.querySelector('.dock textarea')"));
await sleep(1500);
// crewd's push, as the app hears it
const push = new WebSocket(base.replace('http', 'ws') + '/ws');
const log = join(out, 'push.jsonl');
push.onmessage = (m) => { const e = JSON.parse(m.data); appendFileSync(log, JSON.stringify({ t: Date.now(), kind: e.kind, bot: e.bot, data: JSON.stringify(e.data ?? {}).slice(0, 200) }) + '\n'); };
const PROBE = `(() => {
  const chat = [...document.querySelectorAll('.chat')].find((c) => c.offsetParent) ?? document;
  const lines = [...chat.querySelectorAll('.lines > *')].filter((e) => e.offsetParent).slice(-4).map((e) => (e.className.replace(/line-wrap ?/, '') + ': ' + e.innerText.replace(/\\s+/g, ' ')).slice(0, 160));
  const aside = [...chat.querySelectorAll('.working-on')].filter((e) => e.offsetParent).map((e) => e.innerText.replace(/\\s+/g, ' ').slice(0, 160)).join(' | ');
  const hero = document.querySelector('.chief-hero, .hero')?.innerText.replace(/\\s+/g, ' ').slice(0, 120) ?? '';
  return JSON.stringify({ lines, aside, hero });
})()`;
const tl = join(out, 'screen.jsonl');
await send('Runtime.evaluate', { expression: "document.querySelector('.dock textarea').focus()" });
await send('Input.insertText', { text: message });
// Every change to the visible thread, timed in the page itself (independent of this loop's sampling).
await run(`window.__chg = []; new MutationObserver(() => __chg.push(Date.now())).observe([...document.querySelectorAll('.chat .lines')].find((e) => e.offsetParent), { subtree: true, childList: true, characterData: true }); true`);
const t0 = Date.now();
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
writeFileSync(join(out, 't0'), String(t0));
let last = '', frame = 0, nextShot = t0, settledAt = 0;
while (Date.now() - t0 < +maxS * 1000) {
  const s = await run(PROBE).catch(() => '');
  const t = Date.now();
  if (s !== last) { appendFileSync(tl, JSON.stringify({ ms: t - t0, ...JSON.parse(s || '{}') }) + '\n'); last = s; settledAt = t; }
  if (t >= nextShot) { const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 }); writeFileSync(join(out, 'frames', `${String(frame).padStart(3, '0')}-${String(t - t0).padStart(6, '0')}ms.jpg`), Buffer.from(data, 'base64')); frame++; nextShot += 1000; }
  // done: the task row reached an end state and the screen has been still for 8 s
  if (t - t0 > 15000 && t - settledAt > 8000) {
    const st = await (await fetch(base + '/api/state')).json().catch(() => ({}));
    const busy = (st.bots ?? []).some((b) => b.task && ['working', 'queued'].includes(b.task.state));
    if (!busy) break;
  }
  await sleep(250);
}
const chg = (await run('JSON.stringify(window.__chg)').then(JSON.parse)).map((t) => t - t0).filter((t) => t >= 0);
const endAt = (await run("JSON.stringify(document.querySelector('.live-end') ? 1 : 0)")) === '1' ? JSON.parse(readFileSync(tl, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((r) => r.lines.some((x) => x.startsWith('live-end')))?.ms ?? 'null') : null;
let gap = 0, from = 0, prev = 0; for (const t of chg) { if (endAt != null && t > endAt) break; if (t - prev > gap) { gap = t - prev; from = prev; } prev = t; }
writeFileSync(join(out, 'changes.json'), JSON.stringify({ endAt, longestStillMs: gap, from, changes: chg }));
console.log('end at', endAt, 'ms; longest still', gap, 'ms from', from);
push.close(); ws.close(); chrome.kill('SIGTERM'); chrome.on('exit', () => rmSync(profile, { recursive: true, force: true }));
console.log('done', Date.now() - t0, 'ms', frame, 'frames');
