// Capture the web app as the INSTALLED PWA renders it: a headless Chrome driven over CDP with the
// display-mode media feature pinned to `standalone` (what an installed home-screen app reports) and a
// phone/desk viewport, so the changed Chief header is proven in the PWA form as well as the browser.
// Chrome is launched on a task-owned profile and port; the app must already be serving on --base.
//
//   node pwa-capture.mjs --dest <dir> --prefix pwa-after --base http://127.0.0.1:PORT --key <person-key>
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const DEST = opt('dest'); const PREFIX = opt('prefix'); const BASE = opt('base'); const KEY = opt('key');
if (!DEST || !PREFIX || !BASE || !KEY) { console.error('usage: pwa-capture.mjs --dest <dir> --prefix <p> --base <url> --key <person-key>'); process.exit(2); }
mkdirSync(DEST, { recursive: true });
const profile = `/tmp/ch-chief-header-pwa-${process.pid}`;
const port = 9700 + (process.pid % 200);
rmSync(profile, { recursive: true, force: true });
const chrome = spawn('/usr/bin/google-chrome-stable', ['--headless=new', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wsUrl = async () => {
  for (let i = 0; i < 100; i++) {
    try { const v = JSON.parse(execFileSync('curl', ['-fsS', `http://127.0.0.1:${port}/json/version`], { encoding: 'utf8' })); if (v.webSocketDebuggerUrl) return v.webSocketDebuggerUrl; } catch { /* not up */ }
    await sleep(200);
  }
  throw new Error('chrome did not come up');
};
const b = new WebSocket(await wsUrl());
await new Promise((res) => b.on('open', res));
let id = 0; const pend = new Map();
b.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const cdp = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pend.set(i, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result)); b.send(JSON.stringify({ id: i, method, params, sessionId })); });
// One tab, attached flat so page-domain events flow to this socket.
const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
const send = (m, p) => cdp(m, p, sessionId);
await send('Page.enable'); await send('Runtime.enable');
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const shoot = async (out) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(out, Buffer.from(data, 'base64')); };
for (const theme of ['night', 'day']) {
  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    // The installed-PWA media signal: display-mode standalone (the app's window, not a browser tab).
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
    const url = `${BASE}/?${theme}#person=${KEY}`;
    await send('Page.navigate', { url });
    for (let i = 0; i < 60; i++) { if (await evalJs("!!document.querySelector('.home-chat .chief-hero .ch-row') || !!document.querySelector('.home-chat .composer')")) break; await sleep(250); }
    const out = join(DEST, `${PREFIX}-${theme}-${w}.png`);
    await shoot(out);
    console.log(out, await evalJs("matchMedia('(display-mode: standalone)').matches"));
  }
}
b.close(); chrome.kill('SIGTERM');
