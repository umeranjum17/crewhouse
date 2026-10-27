// Capture the calm design's screens from a built web app: node calm-cap.mjs <repo> <base-url> <out-dir>
// Chief's chat and Home at 390x844 and Chief in three panes at 1280x800, day and night, on the ?demo data, as live-<screen>-<width>-<theme>.png.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const [repo, base, out] = process.argv.slice(2);
const SCREENS = [['chat', 'demo=thread', '/chief', 390, 844], ['home', 'demo', '/', 390, 844], ['desk', 'demo=thread', '/chief', 1280, 800]];
const WebSocket = createRequire(join(repo, 'package.json'))('ws');
const profile = mkdtempSync(join(tmpdir(), 'calm-cap-'));
const chrome = spawn('/usr/bin/chromium', ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let code = 0;
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
  const ready = async () => (await send('Runtime.evaluate', { expression: "!!document.querySelector('.page')", returnByValue: true })).result.value;
  await send('Page.enable');
  for (const [name, q, hash, w, h] of SCREENS) for (const theme of ['day', 'night']) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 900 });
    await send('Page.navigate', { url: `${base}?${q}&${theme}&r=${Date.now()}#${hash}` });
    for (let i = 0; i < 100 && !(await ready().catch(() => false)); i++) await wait(100);
    await wait(4000);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `live-${name}-${w}-${theme}.png`), Buffer.from(shot.data, 'base64'));
  }
  ws.close();
} catch (e) { console.error(e); code = 1; }
chrome.kill(); await new Promise((r) => chrome.once('exit', r));
rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
process.exit(code);
