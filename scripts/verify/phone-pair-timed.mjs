#!/usr/bin/env node
// Phone pairing by the typed code, on the real app: the computer mints its 12-letter code, the phone types it at a
// person's pace, finds the computer on the Wi-Fi by its announcement, shows the two words, the computer says yes, and
// the phone lands on "You're in". Prints one timings line per run and writes screenshots and timings.json.
//
//   node scripts/verify/phone-pair-timed.mjs --out "$EV/phone-typed" --state "$LAB/state"
//                                [--serial <id>] [--base http://127.0.0.1:$PORT] [--cps 2] [--runs 1]
//
// Unlike phone-pair.mjs it never clears or reinstalls the app, so it runs on a real phone as the app stands: it starts
// from "Where should I work?" ("On my computer") or phone-only mode ("Use a computer", which keeps the phone's own key).
// --cps is keystrokes a second, one `input text` per letter, so typing time is a person's, not adb's paste.
// The computer side is the real one: POST /api/phones/pair (the card's code) and POST /api/phones/answer (the card's
// "Yes, the words match"). It does not forget the computer afterwards; the phone's Settings › Forget does that.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const OUT = opt('out', null), STATE = opt('state', process.env.CREWHOUSE_STATE_DIR);
if (!OUT || !STATE) { console.error('usage: phone-pair-timed.mjs --out <dir> --state <crewd state dir> [--serial id] [--base url] [--cps 2] [--runs 1]'); process.exit(2); }
const SERIAL = opt('serial', 'emulator-5562'), BASE = opt('base', 'http://127.0.0.1:7801');
const CPS = Number(opt('cps', 2)), RUNS = Number(opt('runs', 1)), PKG = 'dev.crewhouse.app';
mkdirSync(OUT, { recursive: true });

const adb = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${readFileSync(join(STATE, 'person.key'), 'utf8').trim()}` }, body: body && JSON.stringify(body) });
  const out = await r.json(); if (!r.ok) throw new Error(out.error || `HTTP ${r.status}`); return out;
};
const shot = (name) => writeFileSync(join(OUT, name), execFileSync('adb', ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 27 }));
const nodes = () => { adb('shell', 'uiautomator', 'dump', '/sdcard/fm-ui.xml'); return [...adb('shell', 'cat', '/sdcard/fm-ui.xml').matchAll(/<node [^>]*>/g)].map(([n]) => ({
  text: (n.match(/ text="([^"]*)"/) || [])[1] || '', desc: (n.match(/content-desc="([^"]*)"/) || [])[1] || '',
  b: (n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []).slice(1).map(Number) })); };
const find = (re, ns = nodes()) => ns.find((n) => re.test(n.text) || re.test(n.desc));
const tap = (n) => adb('shell', 'input', 'tap', String((n.b[0] + n.b[2]) >> 1), String((n.b[1] + n.b[3]) >> 1));
async function tapWhen(re, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const n = find(re); if (n) { tap(n); return n; } }
  throw new Error(`never saw ${re}`);
}

const log = [];
for (let run = 1; run <= RUNS; run++) {
  adb('shell', 'am', 'force-stop', PKG); // a cold start, so no half-typed box from an earlier try
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  await sleep(3000);
  // phone-only chat → "Where should I work?" → Put Chief or Pair → the code box, whichever of those the app opens on
  for (let step = 0; ; step++) {
    if (step > 6) throw new Error('never reached the code box');
    // Put Chief's "Type the code" first: its back row also reads "On my computer"
    const n = await tapWhen(/^Type the code$/, 1500).catch(() => tapWhen(/^(Use a computer instead|On my computer|Pair with a computer|Type a code)$/));
    if (/^Type (a|the) code$/.test(n.text || n.desc)) break;
    await sleep(800);
  }
  await tapWhen(/^Pairing code$|^Type or paste the code$/);
  const offer = await api('/api/phones/pair', { role: 'control' });
  writeFileSync(join(OUT, `offer-${run}.json`), JSON.stringify({ typed: offer.typed, expires: offer.expires, urls: offer.urls }, null, 2));
  await sleep(600);
  const letters = offer.typed.replace(/-/g, '');
  const t0 = Date.now();
  for (const ch of letters) { adb('shell', 'input', 'text', ch); await sleep(1000 / CPS); }
  const tTyped = Date.now();
  shot(`run${run}-1-typed.png`);
  await tapWhen(/^Pair$/);
  let asking = [];
  for (const end = Date.now() + 40000; Date.now() < end && !asking.length && !find(/Couldn't|didn't|missing|run out|not a Crewhouse/); await sleep(250)) asking = await api('/api/phones/pending');
  const tWords = Date.now();
  if (!asking.length) { // what the phone said instead, kept as a row: a failed run is evidence too
    const said = find(/Couldn't|didn't|missing|run out|not a Crewhouse/);
    shot(`run${run}-2-failed.png`);
    const row = { run, code: offer.typed, letters: letters.length, cps: CPS, secondsTyping: (tTyped - t0) / 1000, secondsPairToFailure: (tWords - tTyped) / 1000, phoneSaid: said?.text, paired: false };
    log.push(row); console.log(JSON.stringify(row)); continue;
  }
  await sleep(800);
  const phoneWords = find(new RegExp(asking[0].words.replace(/[^\w ]/g, '.')));
  shot(`run${run}-2-words.png`);
  await api('/api/phones/answer', { id: asking[0].id, yes: true }); // the card's "Yes, the words match"
  let paired = false;
  for (const end = Date.now() + 20000; Date.now() < end && !paired; await sleep(250)) paired = (await api('/api/phones')).some((p) => p.name === asking[0].name);
  const tPaired = Date.now();
  await sleep(1200);
  shot(`run${run}-3-yourein.png`);
  await tapWhen(/^Open Crewhouse$/).catch(() => {});
  await sleep(3000);
  shot(`run${run}-4-open.png`);
  const row = { run, code: offer.typed, letters: letters.length, cps: CPS, words: asking[0].words, phoneShowedWords: !!phoneWords,
    secondsTyping: (tTyped - t0) / 1000, secondsPairToWords: (tWords - tTyped) / 1000, secondsTypingToPaired: (tPaired - t0) / 1000, paired };
  log.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(join(OUT, 'timings.json'), JSON.stringify(log, null, 2));
if (log.some((r) => !r.paired || !r.phoneShowedWords)) process.exit(1);
