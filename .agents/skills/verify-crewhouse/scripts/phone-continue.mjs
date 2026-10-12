#!/usr/bin/env node
// Continue on your computer (features/phone-continue.md): a chat with Chief on the phone alone goes to Chief on the
// paired computer as one message, and the phone copy goes only once the computer stored it. Drives the real release
// app on a task-owned emulator (google_apis image: `adb root` reads and seeds the app's own files) against the lab crewd
// from pair-lab.sh, paired by the typed code (`adb reverse` carries the code's loopback link address).
//
//   LAB=<lab> node .agents/skills/verify-crewhouse/scripts/phone-continue.mjs --serial <emulator> --ev "$EV" \
//     --apk <app-release.apk> --key-file /home/umer/.config/openrouter/api_key [--seed-turns 52]
//
// 1. a real phone-only chat (the OpenRouter key is pushed and typed on the device, never in argv or logs);
// 2. pair, the offer shows on Home, Continue on your computer: one Chief message on the computer, the phone's chat
//    file and tool index gone, its documents kept;
// 3. a seeded long chat (--seed-turns, one very long turn): Not now keeps it and the offer is back on the next open;
// 4. a failed send (the lab crewd frozen with SIGSTOP, so the link stays up but nothing answers): the plain failure
//    line, the copy kept; SIGCONT, Continue again, stored exactly once (the trimmed note when over 40,000 characters);
// 5. the offer and the moved message at 360 dp and 1.3x text, dark and light.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const SERIAL = opt('serial', 'emulator-5562'), EV = opt('ev', null), APK = opt('apk', null), LAB = process.env.LAB;
const KEY_FILE = opt('key-file', '/home/umer/.config/openrouter/api_key'), SEED = Number(opt('seed-turns', 52));
if (!EV || !LAB) { console.error('usage: LAB=<lab> phone-continue.mjs --ev <dir> [--serial s] [--apk a] [--key-file f] [--seed-turns n]'); process.exit(2); }
mkdirSync(join(EV, 'screens'), { recursive: true });
const env = Object.fromEntries(readFileSync(join(LAB, 'env'), 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
const KEY = readFileSync(join(LAB, 'state', 'person.key'), 'utf8').trim();
const CREWD = Number(readFileSync(join(LAB, 'state', 'crewd.pid'), 'utf8').trim()); // crewd's own pid, not the lab's wrapper shell
const PKG = 'dev.crewhouse.app', FILES = `/data/data/${PKG}/files`;
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
    enabled: (n.match(/ enabled="(true|false)"/) || [])[1] !== 'false', b: (n.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/) || []).slice(1).map(Number) }));
};
const has = (re) => nodes().some((n) => re.test(n.text) || re.test(n.desc));
const tap = (re) => { const n = nodes().find((x) => re.test(x.text) || re.test(x.desc)); if (!n) throw new Error(`no node ${re}`);
  A('shell', 'input', 'tap', String((n.b[0] + n.b[2]) >> 1), String((n.b[1] + n.b[3]) >> 1)); };
const waitFor = async (re, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (has(re)) return Date.now() - t; await sleep(700); } throw new Error(`timed out waiting for ${re}`); };
const gone = async (re, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (!has(re)) return Date.now() - t; await sleep(700); } throw new Error(`still showing ${re}`); };
const shot = (name) => writeFileSync(join(EV, 'screens', name), execFileSync('adb', ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 27 }));
const log = []; const say = (l) => { log.push(l); console.log(l); };
const kept = () => A('shell', 'ls', FILES).split(/\s+/).filter(Boolean);
const relaunch = () => A('shell', 'am', 'start', '-S', '-n', `${PKG}/.MainActivity`);
const moves = async () => (await api('GET', '/api/bots/chief')).messages.filter((m) => m.author === 'person' && m.text.startsWith("I'm continuing our chat from my phone"));
const writeChat = (body) => { const tmp = '/data/local/tmp/phone-chat.jsonl', dst = `${FILES}/phone-chat.jsonl`; writeFileSync(join(EV, 'seeded-phone-chat.jsonl'), body);
  A('push', join(EV, 'seeded-phone-chat.jsonl'), tmp); A('shell', `cp '${tmp}' '${dst}'`);
  const owner = A('shell', 'stat', '-c', '%u:%g', FILES).trim();
  A('shell', `chown '${owner}' '${dst}'`); A('shell', `chmod 660 '${dst}'`); A('shell', `restorecon '${dst}'`); A('shell', `rm -f '${tmp}'`); };
const OFFER = /^Continue on your computer$/;

if (APK) { try { A('uninstall', PKG); } catch { /* none */ } A('install', '-g', APK); }
A('shell', 'pm', 'clear', PKG);
A('shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS');
try { A('root'); A('wait-for-device'); await sleep(1500); } catch { /* already root */ }
A('shell', 'settings', 'put', 'system', 'font_scale', '1.0'); A('shell', 'wm', 'density', 'reset'); A('shell', 'cmd', 'uimode', 'night', 'no');
for (const port of [env.LINK_PORT, env.RELAY.split(':').pop()]) A('reverse', `tcp:${port}`, `tcp:${port}`);
await api('POST', '/api/onboard', { address: 'Umer' }).catch(() => {}); // past Hello, so the paired phone opens on Home

// 1. A real chat with Chief on the phone alone.
relaunch();
await waitFor(/^Use this phone only$/, 90000); tap(/^Use this phone only$/);
await waitFor(/Paste your .* key/, 15000); tap(/Paste your .* key/);
A('push', KEY_FILE, '/data/local/tmp/kc.txt'); A('shell', 'input text "$(cat /data/local/tmp/kc.txt)"'); A('shell', 'rm', '-f', '/data/local/tmp/kc.txt');
await sleep(800); tap(/^Connect$/);
await waitFor(/Ask Chief anything/, 30000);
const turn = async (text) => {
  tap(/Ask Chief anything/); await sleep(400); A('shell', 'input', 'text', text.replace(/ /g, '%s')); await sleep(400); tap(/^Send$/);
  await sleep(2000); const t = Date.now();
  while (Date.now() - t < 120000 && (has(/Chief is working/) || has(/▍/))) await sleep(1000);
  await sleep(1500);
};
await turn('Draft a one-page packing list for a 3-day trip as a document');
await turn('Thanks. What should I check before I leave the house?');
const noCredit = has(/Could not finish on this phone/);
say(noCredit ? 'phone-only chat: the provider gave no answer (plain error lines kept as the chat)' : `phone-only chat: real answers${has(/^Document$/) ? ' and a document card' : ''}`);
shot('01-phone-only-chat.png');
const before = kept(); say(`phone files before the move: ${before.join(' ')}`);

// 2. Pair, then Continue on your computer.
tap(/^Use a computer$/);
await waitFor(/^Pair with a computer$/, 20000); tap(/^Pair with a computer$/);
await waitFor(/^Type a code$/, 20000); tap(/^Type a code$/);
await waitFor(/Type or paste the code/, 20000); tap(/Type or paste the code/); await sleep(500);
const offer = await api('POST', '/api/phones/pair', { role: 'control' });
const code = offer.typed.replace(/[^A-Z0-9-]/gi, '');
for (let i = 0; i < code.length; i += 60) { A('shell', 'input', 'text', code.slice(i, i + 60)); await sleep(300); }
A('shell', 'input', 'keyevent', '111'); await sleep(500); tap(/^Pair$/);
let pending = [];
for (let t = 0; t < 40 && !pending.length; t++) { pending = await api('GET', '/api/phones/pending'); if (!pending.length) await sleep(500); }
if (!pending.length) throw new Error('the phone never reached the computer');
await api('POST', '/api/phones/answer', { id: pending[0].id, yes: true });
await waitFor(/Open Crewhouse/, 30000); tap(/Open Crewhouse/);
await waitFor(OFFER, 30000); await sleep(800); shot('02-offer.png');
say('paired; the offer shows on Home');
tap(OFFER);
await gone(OFFER, 40000); await waitFor(/continuing our chat from my phone/, 20000); await sleep(1200); shot('03-moved-phone.png');
const first = await moves();
const after = kept();
say(`moved: ${first.length} Chief message(s) from the phone; phone chat file ${after.includes('phone-chat.jsonl') ? 'STILL THERE' : 'gone'}, tool index ${after.includes('phone-requests.jsonl') ? 'STILL THERE' : 'gone'}, documents kept: ${after.filter((f) => f.startsWith('chief-')).length} of ${before.filter((f) => f.startsWith('chief-')).length}`);
writeFileSync(join(EV, 'moved-message.txt'), first.at(-1)?.text ?? '');

// 3. A long kept chat: Not now keeps it; the offer is back on the next open.
const long = [];
for (let i = 1; i <= SEED; i++) {
  long.push(JSON.stringify({ t: 'you', text: `Turn ${i}: what should I pack for day ${i}?`, rid: `seed-${i}` }));
  long.push(JSON.stringify({ t: 'chief', text: i === SEED ? `Turn ${i}: ${'A very long answer with a long link https://example.com/'.concat('x'.repeat(300), ' and many words. ').repeat(12)}` : `Turn ${i}: ${'Pack light layers, a charger and your ticket. '.repeat(16)}` }));
}
A('shell', 'am', 'force-stop', PKG); writeChat(long.join('\n') + '\n'); relaunch();
await waitFor(OFFER, 60000); await sleep(800); shot('04-offer-long-chat.png');
tap(/^Not now$/); await gone(OFFER, 10000); await sleep(600); shot('05-not-now.png');
say(`Not now: offer gone, chat file ${kept().includes('phone-chat.jsonl') ? 'kept' : 'MISSING'}`);
relaunch(); await waitFor(OFFER, 60000); await sleep(800); shot('06-offer-back-on-open.png');
say('the offer is back on the next app open');

// 4. A failed send keeps the copy; the retry stores it once.
const was = (await moves()).length;
process.kill(CREWD, 'SIGSTOP');
try {
  tap(OFFER);
  const ms = await waitFor(/Your chat is still on this phone/, 70000); await sleep(600); shot('07-failed-send.png');
  say(`failed send (computer not answering): the plain line after ${Math.round(ms / 1000)} s, chat file ${kept().includes('phone-chat.jsonl') ? 'kept' : 'MISSING'}`);
} finally { process.kill(CREWD, 'SIGCONT'); }
await sleep(3000);
const late = (await moves()).length;
say(`after the computer woke: ${late - was} late copies stored (the link told it not to start after the bound)`);
const enabled = async () => { const t = Date.now(); while (Date.now() - t < 60000) { const n = nodes().find((x) => OFFER.test(x.text)); if (n?.enabled) return; await sleep(1000); } throw new Error('Continue never came back'); };
await enabled(); tap(OFFER);
await gone(OFFER, 40000); await sleep(1500); shot('08-moved-after-retry.png');
const all = await moves();
const last = all.at(-1)?.text ?? '';
say(`retry: ${all.length - was} new Chief message(s); ${last.length} characters; ${last.includes('(Earlier turns left out.)') ? 'oldest turns left out, said so' : 'whole'}; chat file ${kept().includes('phone-chat.jsonl') ? 'STILL THERE' : 'gone'}`);
writeFileSync(join(EV, 'moved-long-message.txt'), last);

// 5. Narrow and large text, dark and light: the offer and the moved long message.
A('shell', 'am', 'force-stop', PKG); writeChat(long.slice(0, 6).join('\n') + '\n');
A('shell', 'settings', 'put', 'system', 'font_scale', '1.3'); A('shell', 'wm', 'density', '480');
for (const night of ['yes', 'no']) {
  A('shell', 'cmd', 'uimode', 'night', night); relaunch();
  await waitFor(OFFER, 60000); await sleep(1200); shot(`09-offer-360dp-1.3x-${night === 'yes' ? 'night' : 'day'}.png`);
}
tap(/^Not now$/); await gone(OFFER, 10000);
for (let i = 0; i < 4; i++) { A('shell', 'input', 'swipe', '540', '700', '540', '1500', '150'); await sleep(400); } // up into the long moved message
for (const night of ['yes', 'no']) { A('shell', 'cmd', 'uimode', 'night', night); await sleep(2500); shot(`10-thread-360dp-1.3x-${night === 'yes' ? 'night' : 'day'}.png`); }
A('shell', 'settings', 'put', 'system', 'font_scale', '1.0'); A('shell', 'wm', 'density', 'reset'); A('shell', 'cmd', 'uimode', 'night', 'no');
A('shell', 'pm', 'clear', PKG); // the key and the chats go with the app's data
say('erased the key and the app data from the emulator');
writeFileSync(join(EV, 'phone-continue.log'), log.join('\n') + '\n');
