// The home-screen app proof (features/pwa-shell.md): one isolated Chromium driven over CDP from a plan.
//   node pwa-shell.mjs <plan.json>     (headed installs: under `xvfb-run -a`, with "headless": false)
// plan: { profile, home, headless?, args?, xkey?, recorder?, steps: [{ name, w, h, dpr, mobile, ua, platform, touch,
//   insets, inject, run, url, reload, offline, settle, click, key, xshot, attachApp, record, seconds, recwait, errors, eval, wait, timeout, out, grant }] }
// `run` is a shell command (the computer's side, e.g. `./crewhouse phones approve …`); its trimmed stdout replaces
// `{{out}}` (as a JSON string) in later url/eval/wait steps. `wait` polls an expression until truthy, up to `timeout` ms.
// Chromium gets a HOME and every XDG dir under plan.home and nothing from this shell: an install writes its desktop
// entry and icons to XDG_DATA_HOME, so an inherited one lands them in the owner's own menu.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
mkdirSync(plan.profile, { recursive: true });
const args = [`--user-data-dir=${plan.profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--password-store=basic', '--disable-features=Translate', ...(plan.headless === false ? ['--ozone-platform=x11'] : ['--headless=new']), ...(plan.args ?? ['about:blank'])];
const chrome = spawn(plan.bin ?? 'chromium', args, { stdio: 'ignore', env: { PATH: process.env.PATH, DISPLAY: process.env.DISPLAY ?? '', HOME: plan.home, XDG_DATA_HOME: plan.home + '/.local/share', XDG_CONFIG_HOME: plan.home + '/.config', XDG_CACHE_HOME: plan.home + '/.cache', XDG_STATE_HOME: plan.home + '/.local/state', XDG_RUNTIME_DIR: plan.home + '/run', DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + plan.home + '/no-bus' } });
const portFile = plan.profile + '/DevToolsActivePort';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 600 && !existsSync(portFile); i++) await sleep(100);
const [port] = readFileSync(portFile, 'utf8').split('\n');
const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const [res, rej] = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); } });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, [res, rej]); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { targetInfos } = await send('Target.getTargets');
let target = targetInfos.find((t) => t.type === 'page');
let { sessionId: s } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
const prep = async () => { await send('Page.enable', {}, s); await send('Runtime.enable', {}, s); };
await prep();
const out = []; let rec;
let said = '';
const fill = (t) => t?.replaceAll('{{out}}', JSON.stringify(said));
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s)).result.value;
for (const st of plan.steps) {
  try {
    if (st.w) await send('Emulation.setDeviceMetricsOverride', { width: st.w, height: st.h, deviceScaleFactor: st.dpr ?? 1, mobile: !!st.mobile }, s);
    if (st.inject) await send('Page.addScriptToEvaluateOnNewDocument', { source: st.inject }, s);
    if (st.grant) { const o = new URL(await evalJs('location.origin')); await send('Browser.grantPermissions', { origin: o.origin, permissions: st.grant }); out.push({ granted: st.grant, origin: o.origin }); }
    if (st.ua) await send('Emulation.setUserAgentOverride', { userAgent: st.ua, platform: st.platform ?? '' }, s);
    if (st.touch !== undefined) await send('Emulation.setTouchEmulationEnabled', { enabled: st.touch, maxTouchPoints: st.touch ? 5 : 1 }, s);
    if (st.insets) await send('Emulation.setSafeAreaInsetsOverride', { insets: st.insets }, s);
    if (st.run) { said = execFileSync('bash', ['-c', st.run]).toString().trim(); out.push({ step: st.name, run: said.slice(0, 200) }); }
    if (st.url) { await send('Page.navigate', { url: fill(st.url) }, s); await sleep(st.settle ?? 1500); }
    if (st.reload) { await send('Page.reload', {}, s); await sleep(st.settle ?? 1500); }
    if (st.offline !== undefined) { await send('Network.enable', {}, s); await send('Network.emulateNetworkConditions', { offline: st.offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, s); }
    if (st.click) { const r = await evalJs(`(()=>{const b=document.querySelector(${JSON.stringify(st.click)}).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }, s); await sleep(st.settle ?? 2000); }
    if (st.xshot) { execFileSync('magick', ['import', '-window', 'root', st.xshot]); out.push({ xshot: st.xshot }); }
    if (st.key) { out.push({ key: execFileSync('python3', ['-I', plan.xkey, ...String(st.key).split(' ')]).toString() }); await sleep(4000); }
    if (st.attachApp) { const { targetInfos: ts } = await send('Target.getTargets'); out.push({ targets: ts.map((t) => [t.type, t.url.replace(/#.*/, '')]) }); const app = ts.filter((t) => t.type === 'page' && t.targetId !== target.targetId && t.url.startsWith(st.attachApp)).pop(); if (app) { target = app; ({ sessionId: s } = await send('Target.attachToTarget', { targetId: app.targetId, flatten: true })); await prep(); } }
    if (st.record) { rec = spawn('node', [plan.recorder, '--cdp', port, '--out', st.record, '--seconds', String(st.seconds ?? 5), '--max-width', '1200', ...(st.match ? ['--match', st.match] : [])]); rec.out = ''; rec.stdout.on('data', (c) => rec.out += c); rec.stderr.on('data', (c) => rec.out += c); await sleep(1500); }
    if (st.recwait) { const already = rec.exitCode !== null; if (!already) await new Promise((r) => { rec.once('exit', r); }); out.push({ recorded: rec.out, already }); }
    if (st.errors) out.push({ installability: await send('Page.getInstallabilityErrors', {}, s) });
    if (st.wait) { const end = Date.now() + (st.timeout ?? 30_000); while (!(await evalJs(fill(st.wait)))) { if (Date.now() > end) throw new Error(`timed out waiting for ${st.wait}`); await sleep(100); } }
    if (st.eval) out.push({ step: st.name, value: await evalJs(fill(st.eval)) });
    if (st.out) { const { data } = await send('Page.captureScreenshot', { format: 'png' }, s); writeFileSync(st.out, Buffer.from(data, 'base64')); out.push({ shot: st.out }); }
  } catch (e) { out.push({ step: st.name, error: String(e) }); console.error(`step ${st.name}: ${e}`); }
}
console.log(JSON.stringify(out, null, 1));
ws.close(); chrome.kill('SIGTERM');
