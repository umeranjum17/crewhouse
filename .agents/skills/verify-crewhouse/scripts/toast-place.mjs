// Where the one shared toast lands, at 390 in day and night: Settings after adding an About-you line ("Remembered"),
// then Chief's chat while that toast is still up. Writes <screen>-<look>-390-<tag>.png and toast-<tag>.json, which
// lists the words of anything under the toast (outside the box you type in): it must be empty.
// Usage: node toast-place.mjs <base> <outdir> <tag>   (crewd on the stub engine, onboarded, a few chat lines)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const [base, out, tag] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'toast-'));
const chrome = spawn(process.env.CHROMIUM ?? '/usr/bin/chromium', ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await f().catch(() => undefined); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await sleep(100); } };
const pf = join(profile, 'DevToolsActivePort');
await until(async () => existsSync(pf) && readFileSync(pf, 'utf8').includes('\n'));
const port = readFileSync(pf, 'utf8').split('\n')[0];
const page = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'));
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const wait = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); wait.get(d.id)?.(d); wait.delete(d.id); };
const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; wait.set(n, (m) => (m.error ? j(new Error(m.error.message)) : r(m.result))); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const shot = async (name) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}-${tag}.png`), Buffer.from(data, 'base64')); };
// What lies under the toast: the words of any element whose box meets it, outside the toast and the box you type in.
const under = `(() => { const t = document.querySelector('.toast'); if (!t) return 'no toast'; const r = t.getBoundingClientRect();
  const hit = [...document.querySelectorAll('.lines > *, .row-item, .card, p, h2, .label')].filter((e) => !e.closest('.dock') && !t.contains(e) && e.offsetParent).filter((e) => { const b = e.getBoundingClientRect(); return b.bottom > r.top && b.top < r.bottom && b.right > r.left && b.left < r.right; });
  return JSON.stringify({ toast: [Math.round(r.top), Math.round(r.bottom)], under: hit.map((e) => e.innerText.replace(/\\s+/g, ' ').slice(0, 60)) }); })()`;
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const report = {};
for (const look of ['day', 'night']) {
  // Settings: add a line to "About me and my work", with the accounts list at the foot of the screen.
  await send('Page.navigate', { url: `${base}/?${look}#/settings` });
  await until(() => run("!!document.querySelector('.settings, .page') && document.body.textContent.includes('Your AI accounts')"));
  await sleep(600);
  const input = "[...document.querySelectorAll('input')].find((i) => /vegetarian|about you|your work/i.test(i.placeholder))";
  await run(`${input}.scrollIntoView({ block: 'start' }); window.scrollBy(0, -40); true`);
  await run(`${input}.focus(); true`);
  await send('Input.insertText', { text: 'I like short answers.' });
  await run(`[...${input}.parentElement.querySelectorAll('button')].find((b) => b.textContent === 'Add').click(); true`);
  await until(() => run("!!document.querySelector('.toast')"), 5000);
  await sleep(400);
  report[`settings-${look}`] = JSON.parse(await run(under));
  await shot(`settings-${look}-390`);
  // Chief's chat, inside the toast's 3 s: the same toast follows to the new screen.
  await run(`location.hash = '#/'; true`);
  await until(() => run("!!document.querySelector('.chat .dock textarea')"));
  const had = await until(() => run("!!document.querySelector('.toast')"), 4000).catch(() => false);
  await sleep(400);
  report[`chat-${look}`] = had ? JSON.parse(await run(under)) : 'no toast';
  await shot(`chat-${look}-390`);
}
writeFileSync(join(out, `toast-${tag}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
ws.close(); chrome.kill('SIGTERM');
