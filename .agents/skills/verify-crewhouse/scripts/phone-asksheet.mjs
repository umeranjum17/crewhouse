#!/usr/bin/env node
// The approval sheet on the real paired app (features/phone-chat-keep.md): the exact outgoing text in full,
// two answer buttons, no timer. Pairs a task-owned emulator to the lab crewd (pair-lab.sh) by the typed code
// (`adb reverse` carries the code's loopback link address), opens a Reel file-write ask (the sheet) and a Reel email draft (its exact text).
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
A('shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS'); // pm clear takes it; its prompt would cover the app
for (const port of [env.LINK_PORT, env.RELAY.split(':').pop()]) A('reverse', `tcp:${port}`, `tcp:${port}`);
await api('POST', '/api/onboard', { address: 'Umer' }).catch(() => {}); // past Hello, so the phone opens on Home
const offer = await api('POST', '/api/phones/pair', { role: 'control' });
A('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
await waitFor(/^Pair with a computer$/, 60000);
tap(/^Pair with a computer$/);
await waitFor(/^Type a code$/, 20000); tap(/^Type a code$/);
await waitFor(/Type or paste the code/, 20000);
tap(/Type or paste the code/); await sleep(500);
// `input text` drops the tail of a long string: the code is ~490 letters, so type it in short pieces.
const code = offer.typed.replace(/[^A-Z0-9-]/gi, '');
for (let i = 0; i < code.length; i += 60) { A('shell', 'input', 'text', code.slice(i, i + 60)); await sleep(300); }
await sleep(500);
A('shell', 'input', 'keyevent', '111'); await sleep(500); tap(/^Pair$/); // close the keyboard, then Pair
let pending = [];
for (let t = 0; t < 40 && !pending.length; t++) { pending = await api('GET', '/api/phones/pending'); if (!pending.length) await sleep(500); }
if (!pending.length) throw new Error('the phone never reached the computer');
await api('POST', '/api/phones/answer', { id: pending[0].id, yes: true });
say(`paired by the typed code as ${pending[0].name}`);
await sleep(4000);
try { tap(/Open Crewhouse/); } catch { /* already in */ }

const state = () => api('GET', '/api/state');
const denyAll = async () => { for (const a of (await state()).asks) await api('POST', `/api/asks/${a.id}/answer`, { answer: 'deny' }).catch(() => {}); };
const tapAt = (n) => A('shell', 'input', 'tap', String((n.b[0] + n.b[2]) >> 1), String((n.b[1] + n.b[3]) >> 1));
const newAsk = async () => { for (let t = 0; t < 40; t++) { const x = (await state()).asks[0]; if (x) return x; await sleep(500); } throw new Error('no ask opened'); };
await denyAll(); // one ask at a time
if (!(await state()).bots?.some?.((x) => x.id === 'reel')) await api('POST', '/api/recruit', { template: 'reel', name: 'Reel' }).catch(() => {});

// 1. The sheet: a helper's own ask (a file write outside its space) reaches it through Office -> the helper's desk -> Review
// (the phone has no Needs you pin). Two answer buttons, the standing answer only as a link, and nothing answers on a timer.
await api('POST', '/api/bots/reel/messages', { text: `save it [tool crew_write ${JSON.stringify({ path: join(LAB, 'home', 'Documents', 'lease-note.txt'), content: 'lease note' })}]` });
const ask = await newAsk(); say(`ask open on the computer: ${ask.title}`);
await waitFor(/^Office$/, 30000); tap(/^Office$/);
await waitFor(/^Reel/, 30000); shot('20-office-ask.png'); tap(/^Reel/);
await waitFor(/^Review$/, 15000); tap(/^Review$/);
await waitFor(/^Yes, go ahead$/, 15000); await sleep(800); shot('21-asksheet.png');
const sheet = nodes().filter((n) => n.b[1] > 1500); // the sheet sits over the lower half of the desk
const buttons = sheet.filter((n) => n.clickable && (n.b[3] - n.b[1]) >= 110).map((n) => n.text || n.desc).filter(Boolean);
say(`answer buttons: ${JSON.stringify(buttons)}; links: ${JSON.stringify(sheet.filter((n) => n.clickable && (n.b[3] - n.b[1]) < 110).map((n) => n.text || n.desc).filter(Boolean))}`);
await sleep(30000);
const still = (await state()).asks.some((x) => x.id === ask.id) && has(/^Yes, go ahead$/);
say(`after 30 s untouched: ask still open and the sheet still up: ${still}`); shot('22-asksheet-after-30s.png');
A('shell', 'input', 'keyevent', '4'); await sleep(800); A('shell', 'input', 'keyevent', '4'); await sleep(800); // back out: never answer for the person
await denyAll();

// 2. The exact outgoing text: a draft in the person's name lands as a card in Chief's thread with every word of the body.
const body = 'Hi Ada,\n\nThanks for Thursday. The signed lease is attached; the deposit went out this morning.\n\nOne thing to check: the move-in date on page 2 says the 14th, and we agreed on the 12th. Could you correct it and send a fresh copy?\n\nBest,\nUmer';
await api('POST', '/api/bots/reel/messages', { text: `write to Ada [tool crew_write ${JSON.stringify({ path: 'files/lease-note.md', content: body })}][tool crew_draft ${JSON.stringify({ path: 'files/lease-note.md', channel: 'email', to: 'ada@fernwood.example', subject: 'The lease: move-in date' })}]` });
await newAsk();
await waitFor(/Chief has 1 thing for you/, 30000); tap(/Chief has 1 thing for you/);
await waitFor(/correct it and send a fresh copy/, 15000);
const shown = nodes().find((n) => n.text.includes('correct it and send a fresh copy'));
const decoded = shown.text.replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
for (let i = 0; i < 6 && !has(/^Copy$/); i++) { A('shell', 'input', 'swipe', '540', '1500', '540', '900', '200'); await sleep(400); }
await sleep(600); shot('23-draft-exact-text.png');
say(`draft card shows the body exactly, whole: ${decoded === body}`);
A('shell', 'pm', 'clear', PKG);
writeFileSync(join(EV, 'phone-asksheet.log'), log.join('\n') + '\n');
