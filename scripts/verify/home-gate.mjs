// Home's headless gate (home-states.sh). Capture one app URL at 390 and 1280, day and night, and run the headless gate on each:
// no text under 16px outside caps labels, pills and tab labels; no clipped text (a .clamp/.clamp1 line ends in its
// ellipsis by design: a chat list's preview); no horizontal scroll.
//   node scripts/verify/home-gate.mjs <repo> <url-with-#hash> <out-dir> <slug> [then-js]
// Writes <slug>-<390|1280>-<day|night>.png (GATE_PWA=1: 390 only, in standalone display mode) and <slug>-gate.json; exits 1 when any gate fails.
// GATE_SCOPE=<selector> gates the text under it instead of main and .page (a file panel sits outside both).
// GATE_DOWNLOADS=<dir> keeps whatever the page saves (a PDF or Word file) in that folder.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const [repo, url, out, slug, then] = process.argv.slice(2);
const WebSocket = createRequire(join(repo, 'package.json'))('ws');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'crewhouse-gate-'));
const chrome = spawn('/usr/bin/chromium', ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = async (code) => { chrome.kill(); await new Promise((r) => chrome.once('exit', r)); rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); process.exit(code); };
try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !(existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n')); i++) await wait(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));
  let id = 0; const waiting = new Map();
  ws.on('message', (m) => { const d = JSON.parse(m); waiting.get(d.id)?.(d); waiting.delete(d.id); });
  const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; waiting.set(n, (d) => d.error ? j(new Error(`${method}: ${d.error.message}`)) : r(d.result)); ws.send(JSON.stringify({ id: n, method, params })); });
  const run = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed'); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  if (process.env.GATE_DOWNLOADS) await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: process.env.GATE_DOWNLOADS }); // a file the page saves lands there
  const gate = {}; let bad = false;
  const [base, hash] = url.split('#');
  for (const theme of ['day', 'night']) for (const [w, h] of (process.env.GATE_PWA ? [[390, 844]] : [[390, 844], [1280, 832]])) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 900 });
    if (process.env.GATE_PWA) await send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] }); // the installed app's window mode
    await send('Page.navigate', { url: `${base}${base.includes('?') ? '&' : '?'}${theme}&r=${Date.now()}#${hash ?? '/'}` });
    for (let i = 0; i < 100 && !(await run("!!document.querySelector('.page')").catch(() => false)); i++) await wait(100);
    await wait(1200);
    if (then) { await run(then); await wait(600); }
    const m = await run(`(() => {
      const seen = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('.sr'); };
      const texty = [...document.querySelectorAll(${JSON.stringify(process.env.GATE_SCOPE ?? 'main *, .page *')})].filter((e) => [...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && seen(e));
      const small = (e) => { const cs = getComputedStyle(e); return cs.textTransform === 'uppercase' || e.closest('.st-pill, .pill, .tabbar, .tab, .count, .badge, time, [aria-hidden="true"]'); };
      const tiny = texty.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16 && !small(e)).map((e) => e.className + ': ' + e.textContent.trim().slice(0, 40));
      const clipped = texty.filter((e) => { const cs = getComputedStyle(e); return !/clamp/.test(e.className) && ((e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== 'visible' && cs.overflowX !== 'auto') || (e.scrollHeight > e.clientHeight + 2 && /hidden|clip/.test(cs.overflowY))); }).map((e) => e.className + ': ' + e.textContent.trim().slice(0, 40));
      const hscroll = document.documentElement.scrollWidth > innerWidth + 1;
      return { checked: texty.length, tiny, clipped, hscroll };
    })()`);
    const key = `${w}-${theme}`; gate[key] = m;
    if (m.tiny.length || m.clipped.length || m.hscroll) bad = true;
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `${slug}-${key}.png`), Buffer.from(shot.data, 'base64'));
  }
  writeFileSync(join(out, `${slug}-gate.json`), JSON.stringify({ slug, url: base.replace(/#.*/, ''), ...gate }, null, 1));
  console.log(JSON.stringify(gate));
  ws.close();
  await done(bad ? 1 : 0);
} catch (e) { console.error(e); await done(2); }
