#!/usr/bin/env node
// The approval sheet on the real paired app (features/phone-chat-keep.md): the exact outgoing text in full,
// two answer buttons, no timer. Pairs a task-owned emulator to the lab crewd (pair-lab.sh) by the typed code
// (`adb reverse` carries the code's loopback link address), opens a Tracer draft ask and captures the sheet.
//
//   LAB=<lab> node .agents/skills/verify-crewhouse/scripts/phone-asksheet.mjs --serial <emulator> --ev "$EV" [--apk app.apk]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const SERIAL = opt('serial', 'emulator-5562'), EV = opt('ev', null), APK = opt('apk', null), LAB = process.env.LAB;
if (!EV || !LAB) { console.error('usage: LAB=<lab> phone-asksheet.mjs --ev <dir> [--serial s] [--apk a]'); process.exit(2); }
mkdirSync(join(EV, 'screens'), { recursive: true });
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
    clickable: / clickable="true"/.test(n), b: (n.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/) || []).slice(1).map(Number) }));
};
const has = (re) => nodes().some((n) => re.test(n.text) || re.test(n.desc));
const tap = (re) => { const n = nodes().find((x) => re.test(x.text) || re.test(x.desc)); if (!n) throw new Error(`no node ${re}`);
  A('shell', 'input', 'tap', String((n.b[0] + n.b[2]) >> 1), String((n.b[1] + n.b[3]) >> 1)); };
const waitFor = async (re, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (has(re)) return; await sleep(700); } throw new Error(`timed out waiting for ${re}`); };
const shot = (name) => writeFileSync(join(EV, 'screens', name), execFileSync('adb', ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 27 }));
const log = []; const say = (l) => { log.push(l); console.log(l); };

if (APK) { try { A('uninstall', PKG); } catch { /* none */ } A('install', '-g', APK); }
A('shell', 'pm', 'clear', PKG);
for (const port of [env.LINK_PORT, env.RELAY.split(':').pop()]) A('reverse', `tcp:${port}`, `tcp:${port}`);
const offer = await api('POST', '/api/phones/pair', { role: 'control' });
A('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
await waitFor(/^Pair with a computer$/, 60000);
tap(/^Pair with a computer$/);
await waitFor(/^Type a code$/, 20000); tap(/^Type a code$/);
await waitFor(/Type or paste the code/, 20000);
tap(/Type or paste the code/); await sleep(500);
A('shell', 'input', 'text', offer.typed.replace(/[^A-Z0-9-]/gi, ''));
await sleep(500);
A('shell', 'input', 'keyevent', '111'); await sleep(500); tap(/^Pair$/); // close the keyboard, then Pair
let pending = [];
for (let t = 0; t < 40 && !pending.length; t++) { pending = await api('GET', '/api/phones/pending'); if (!pending.length) await sleep(500); }
if (!pending.length) throw new Error('the phone never reached the computer');
await api('POST', '/api/phones/answer', { id: pending[0].id, yes: true });
say(`paired by the typed code as ${pending[0].name}`);
await sleep(4000);
try { tap(/Open Crewhouse/); } catch { /* already in */ }

// An unsent draft in the person's name: the ask whose sheet must show every word that would go out.
await api('POST', '/api/recruit', { template: 'tracer', name: 'Tracer' });
const body = 'Hi Ada,\n\nThanks for Thursday. The signed lease is attached; the deposit went out this morning.\n\nOne thing to check: the move-in date on page 2 says the 14th, and we agreed on the 12th. Could you correct it and send a fresh copy?\n\nBest,\nUmer';
const tool = (name, input) => `[tool ${name} ${JSON.stringify(input)}]`;
await api('POST', '/api/bots/tracer/messages', { text: tool('crew_write', { path: 'files/lease.md', content: body }) +
  tool('crew_draft', { path: 'files/lease.md', channel: 'email', to: 'ada@fernwood.example', subject: 'Lease move-in date' }) });
let ask;
for (let t = 0; t < 40 && !ask; t++) { ask = (await api('GET', '/api/state')).asks.find((x) => x.bot === 'tracer'); if (!ask) await sleep(500); }
if (!ask) throw new Error('no draft ask');
say('draft ask open on the computer');
await waitFor(/Needs you|Tracer|lease|Lease/i, 30000);
shot('20-home-ask.png');
tap(/Lease move-in date|wants to send|draft/i);
await waitFor(/correct it and send a fresh copy/, 15000);
await sleep(800); shot('21-asksheet-exact-text.png');
const ns = nodes();
const buttons = ns.filter((n) => n.clickable && /^(Send|Approve|Allow|Yes.*|Not now|No.*|Deny|Don.t.*|Keep.*|Skip.*)$/i.test(n.text || n.desc)).map((n) => n.text || n.desc);
say(`sheet shows the whole body: ${ns.some((n) => n.text.includes('Best,') || n.text.includes('send a fresh copy'))}; answer buttons: ${JSON.stringify(buttons)}`);
await sleep(30000);
const still = (await api('GET', '/api/state')).asks.some((x) => x.id === ask.id) && has(/correct it and send a fresh copy/);
say(`after 30 s untouched: ask still open and the sheet still up: ${still}`); shot('22-asksheet-after-30s.png');
A('shell', 'input', 'keyevent', '4'); // back out: never answer for the person
A('shell', 'pm', 'clear', PKG);
writeFileSync(join(EV, 'phone-asksheet.log'), log.join('\n') + '\n');
