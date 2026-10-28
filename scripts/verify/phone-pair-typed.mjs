#!/usr/bin/env node
// Pairs a task-owned emulator to the lab crewd (pair-lab.sh) by the typed relay code and stops on the app's Home, for
// a proof that starts there (docs/verification/chief-computer.md). From "Where should I work?": On my computer, which opens
// the code box (an older build stops on "Put Chief on your computer" and needs Type the code; without the cloud flag the
// first screen reads Pair with my computer),
// the relay code (`phones code`'s last line: `input text` drops pieces of the relay code on a slow
// emulator), Pair, then yes at the computer over its own API. `adb reverse` carries the link and relay ports. The
// notification permission is granted up front, or with --ask each first-run question (notifications, then on Android
// running in the background) is captured to its <png> and answered Allow.
//
//   LAB=<lab> node scripts/verify/phone-pair-typed.mjs --serial <emulator> [--apk app.apk] [--ask first.png,second.png]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const SERIAL = opt('serial', null), APK = opt('apk', null), ASK = opt('ask', null), LAB = process.env.LAB;
if (!SERIAL || !LAB) { console.error('usage: LAB=<lab> phone-pair-typed.mjs --serial <emulator> [--apk a]'); process.exit(2); }
const env = Object.fromEntries(readFileSync(join(LAB, 'env'), 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
const KEY = readFileSync(join(LAB, 'state', 'person.key'), 'utf8').trim();
const PKG = 'dev.crewhouse.app';
const A = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, path, body) => {
  const r = await fetch(`${env.B}${path}`, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${KEY}` }, body: body && JSON.stringify(body) });
  const out = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${JSON.stringify(out)}`); return out;
};
const nodes = () => {
  let xml = '';
  for (let i = 0; i < 3 && !xml; i++) { try { A('shell', 'uiautomator', 'dump', '/sdcard/ui.xml'); xml = A('shell', 'cat', '/sdcard/ui.xml'); } catch { /* busy window */ } }
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => ({ text: (n.match(/ text="([^"]*)"/) || [])[1] || '', desc: (n.match(/content-desc="([^"]*)"/) || [])[1] || '',
    b: (n.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/) || []).slice(1).map(Number) }));
};
const find = (re) => nodes().find((x) => re.test(x.text) || re.test(x.desc));
const tap = (re) => { const n = find(re); if (!n) throw new Error(`no node ${re}`); A('shell', 'input', 'tap', String((n.b[0] + n.b[2]) >> 1), String((n.b[1] + n.b[3]) >> 1)); };
const waitFor = async (re, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (find(re)) return; await sleep(700); } throw new Error(`timed out waiting for ${re}`); };

if (APK) { try { A('uninstall', PKG); } catch { /* none */ } A('install', '-g', APK); }
A('shell', 'pm', 'clear', PKG);
// Both first-run questions (notifications, then running in the background) would cover the app: pm clear takes the
// first, and the background one (src/news.ts, battery optimisation) outlives pm clear, so each run sets it.
if (!ASK) { A('shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS'); A('shell', 'dumpsys', 'deviceidle', 'whitelist', `+${PKG}`); }
// The first-run questions: `install -g` and an earlier run leave the permission granted, which `pm clear` keeps.
else { A('shell', 'pm', 'revoke', PKG, 'android.permission.POST_NOTIFICATIONS'); A('shell', 'pm', 'clear-permission-flags', PKG, 'android.permission.POST_NOTIFICATIONS', 'user-set', 'user-fixed'); A('shell', 'dumpsys', 'deviceidle', 'whitelist', `-${PKG}`); }
for (const port of [env.LINK_PORT, env.RELAY.split(':').pop()]) A('reverse', `tcp:${port}`, `tcp:${port}`);
await api('POST', '/api/onboard', { address: 'Umer' }).catch(() => {}); // past Hello, so the phone opens on Home
const code = execFileSync('bash', ['-c', `${dirname(new URL(import.meta.url).pathname)}/pair-lab.sh cli phones code | tail -1`], { encoding: 'utf8', env: { ...process.env, LAB } }).trim();
A('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
// The cloud build opens on "Where should I work?"; without the cloud flag the first screen is "Pair with my computer".
await waitFor(/^(On my computer|Pair with my computer)$/, 60000);
tap(/^(Pair with my computer|On my computer)$/); // straight to the code box
if (find(/^Type the code$/)) tap(/^Type the code$/); // an older build still stops on Put Chief on your computer
await waitFor(/Type or paste the code/, 20000); tap(/Type or paste the code/); await sleep(500);
A('shell', 'input', 'text', code); await sleep(800);
A('shell', 'input', 'keyevent', '111'); await sleep(500); tap(/^Pair$/); // close the keyboard, then Pair
let pending = [];
for (let t = 0; t < 120 && !pending.length; t++) { pending = await api('GET', '/api/phones/pending'); if (!pending.length) await sleep(500); }
if (!pending.length) throw new Error('the phone never reached the computer');
await api('POST', '/api/phones/answer', { id: pending[0].id, yes: true });
await sleep(4000);
for (const [i, png] of (ASK ? ASK.split(',') : []).entries()) {
  await waitFor(/^Allow$/, i ? 15000 : 30000); await sleep(500);
  writeFileSync(png, execFileSync('adb', ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 27 })); tap(/^Allow$/); await sleep(1500);
}
try { tap(/Open Crewhouse/); } catch { /* already in */ }
await waitFor(/^(Settings|Places)$/, 30000); // Home: the places button since #777, Settings in the tab bar before
console.log(`paired by the typed code as ${pending[0].name}; the app is on Home`);
