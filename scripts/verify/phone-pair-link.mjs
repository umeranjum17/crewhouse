#!/usr/bin/env node
// Proves the one-link pairing on a task-owned emulator against the lab crewd (pair-lab.sh): the standing link's page in the
// emulator's browser with the app absent (the install branch), the same link tapped once the app is installed (it opens the
// app, which asks the computer; yes over the lab's own API), and Paste a link on the app's first screen with the same link.
// Shots are taken only before a pairing starts and after it lands, so no pairing words or tickets reach a file.
//
//   LAB=<lab> node scripts/verify/phone-pair-link.mjs --serial <emulator> --apk app.apk --out <dir> [--browser com.android.chrome]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeSteps } from './steps.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const SERIAL = opt('serial', null), APK = opt('apk', null), OUT = opt('out', null), LAB = process.env.LAB;
if (!SERIAL || !APK || !OUT || !LAB) { console.error('usage: LAB=<lab> phone-pair-link.mjs --serial <emulator> --apk a.apk --out <dir> [--browser pkg]'); process.exit(2); }
const BROWSER = opt('browser', 'com.android.chrome'), PKG = 'dev.crewhouse.app';
const env = Object.fromEntries(readFileSync(join(LAB, 'env'), 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
const KEY = readFileSync(join(LAB, 'state', 'person.key'), 'utf8').trim();
const A = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, path, body) => {
  const r = await fetch(`${env.B}${path}`, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${KEY}` }, body: body && JSON.stringify(body) });
  const out = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return out;
};
const shot = (name) => writeFileSync(join(OUT, name), execFileSync('adb', ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 26 }));
const nodes = () => {
  let xml = '';
  for (let i = 0; i < 5 && !xml; i++) { try { A('shell', 'uiautomator', 'dump', '/sdcard/ui.xml'); xml = A('shell', 'cat', '/sdcard/ui.xml'); } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); /* busy window */ } }
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => ({ text: (n.match(/ text="([^"]*)"/) || [])[1] || '', desc: (n.match(/content-desc="([^"]*)"/) || [])[1] || '',
    b: (n.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/) || []).slice(1).map(Number) }));
};
const find = (re) => nodes().find((x) => re.test(x.text) || re.test(x.desc));
const tap = (re) => { const n = find(re);
  if (!n) throw new Error(`no node ${re}`); A('shell', 'input', 'tap', String((n.b[0] + n.b[2]) >> 1), String((n.b[1] + n.b[3]) >> 1)); };
const waitFor = async (re, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const n = find(re); if (n) return n; await sleep(700); } throw new Error(`timed out waiting for ${re}`); };
const openPage = (url) => A('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url, '-p', BROWSER);
// Chrome stops exposing a page's text to uiautomator, so the page is read over its own DevTools socket (adb forward) and the
// button is tapped where the page lays it out: the first button under the heading, at 1080 wide.
const DT = 9333;
const pageEval = async (expr) => {
  const tabs = await (await fetch(`http://127.0.0.1:${DT}/json`)).json();
  const ws = new WebSocket(tabs.find((t) => t.type === 'page' && t.url.includes('/pair/')).webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const out = await new Promise((r) => { ws.onmessage = (m) => r(JSON.parse(m.data).result.result.value); ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })); });
  ws.close(); return out;
};
const pageUntil = async (expr, ms) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await pageEval(expr)) return; } catch { /* page not up yet */ } await sleep(700); } throw new Error(`timed out waiting for ${expr}`); };
const tapJoin = () => A('shell', 'input', 'tap', '540', '838');
const firstRun = async () => { // a fresh browser may ask to sign in, accept or turn on sync first
  for (let i = 0; i < 6; i++) {
    for (const re of [/^(Accept & continue|Use without an account|No thanks|Got it|Skip)$/i]) { try { tap(re); } catch { /* not shown */ } }
    await sleep(1500);
  }
};
const allow = async () => { // the lab computer says yes to the one phone waiting
  let pending = [];
  for (let t = 0; t < 60 && !pending.length; t++) { pending = await api('GET', '/api/phones/pending'); if (!pending.length) await sleep(500); }
  if (!pending.length) throw new Error('the phone never reached the computer');
  await api('POST', '/api/phones/answer', { id: pending[0].id, yes: true });
  for (let t = 0; t < 60 && !find(/^Settings$/); t++) { // You're in, then Open Crewhouse, then Home
    try { tap(/^Open Crewhouse$/); } catch { /* not there yet, or already in */ }
    await sleep(1500);
  }
  await waitFor(/^Settings$/, 10000);
};

const link = (await api('GET', '/api/phones/link')).pairLink;
if (!link) throw new Error('the lab crewd printed no link');
console.log(`link: ${link.replace(/\/pair\/.*/, '/pair/<key>')}`);
for (const port of [env.LINK_PORT, env.RELAY.split(':').pop()]) A('reverse', `tcp:${port}`, `tcp:${port}`);
await api('POST', '/api/onboard', { address: 'Umer' }).catch(() => {}); // past Hello, so a paired phone opens on Home

// 1. The app is absent: the page opens; its button finds no app and the page says to install first.
A('forward', `tcp:${DT}`, 'localabstract:chrome_devtools_remote');
try { A('uninstall', PKG); } catch { /* none */ }
openPage(link); await sleep(2500); await firstRun();
await pageUntil("!!document.getElementById('go') && document.getElementById('install').hidden", 40000); await sleep(1500); shot('1-page-app-absent.png');
tapJoin();
await pageUntil("location.search.includes('install=1') && !document.getElementById('install').hidden && /Download the app/.test(document.body.innerText)", 40000); await sleep(1500); shot('2-install-branch.png');
console.log('install branch shown with the app absent');

// 2. The app is installed: the same link, tapped again, opens the app and pairs.
A('install', '-g', APK); A('shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS');
openPage(link); await pageUntil("!!document.getElementById('go') && !location.search", 40000); await sleep(1500);
tapJoin();
await allow(); shot('3-tapped-link-home.png');
console.log('the tapped link opened the app and paired');

// 3. Paste a link on the first screen: the same, reused link.
A('shell', 'pm', 'clear', PKG); A('shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS');
A('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
await waitFor(/^Paste a link$/, 60000); shot('4-first-screen-paste-a-link.png');
tap(/^Paste a link$/);
await waitFor(/Paste the link here/, 20000); tap(/Paste the link here/); await sleep(500);
A('shell', 'input', 'text', link); await sleep(800);
A('shell', 'input', 'keyevent', '111'); await sleep(500); shot('5-paste-screen.png'); tap(/^(Join|Pair)$/);
await allow(); shot('6-pasted-link-home.png');
console.log('Paste a link paired with the same link');
const kept = await fetch(link).then((r) => r.status);
console.log(`the link still opens after two phones: HTTP ${kept}`);
writeSteps(OUT, 'phone-pair-link');
