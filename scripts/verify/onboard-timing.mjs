#!/usr/bin/env node
// How long onboarding really takes, one recipe per run, from install start to Chief's first useful answer.
//   node scripts/verify/onboard-timing.mjs --recipe phone|computer|cloud --serial <emulator> --apk <release apk> --out <dir>
//        [--key-file <MiniMax key>] [--ask "<question>"] [--base <crewd url> --state <crewd state dir>]   (computer)
//        [--boat-sock <boat-run.mjs ctrl.sock>]                                                          (cloud)
// Writes <out>/timing-<recipe>.json (steps with a timestamp each, total, slowest step, every wait above 30 s and the
// step it was spent in) and timing-<recipe>.log, and prints the summary line. A step the run could not reach is
// recorded as missing, never estimated. The emulator, the computer lab and the rented machine are the caller's.
// The key is typed three letters at a time (a controlled field drops faster text) and never printed; that typing is
// the harness's, a person pastes, so the step is marked `harness` and kept out of "slowest step".
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, loadavg } from 'node:os';
import { writeStepsRecord } from './steps.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const RECIPE = opt('recipe'), SERIAL = opt('serial'), APK = opt('apk'), OUT = opt('out');
if (!['phone', 'computer', 'cloud'].includes(RECIPE) || !SERIAL || !APK || !OUT) {
  console.error('usage: onboard-timing.mjs --recipe phone|computer|cloud --serial <emulator> --apk <apk> --out <dir>'); process.exit(2);
}
const ASK = opt('ask', 'Hi Chief, in one short sentence, what can you do for me?');
const KEY_FILE = opt('key-file', join(process.env.HOME, 'firstmate/config/minimax-api-key'));
const BASE = opt('base', ''), STATE = opt('state', ''), SOCK = opt('boat-sock', '');
const PKG = 'dev.crewhouse.app', SLOW = 30;
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, `timing-${RECIPE}.log`);
writeFileSync(LOG, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const say = (line) => { const l = `${new Date().toISOString()} ${line}`; console.log(l); appendFileSync(LOG, l + '\n'); };

// The timeline: every mark is a step that just finished; the wait is the time since the mark before it.
if (!args.includes('--resume') && !args.includes('--tail')) try { adb('uninstall', PKG); } catch { /* nothing installed: a clean device */ }
const TAIL = opt('tail', ''), RESUME = args.includes('--resume') || !!TAIL, STATE_FILE = join(OUT, `.timing-${RECIPE}.state.json`);
// --tail signin|ask: only that part, on a computer that is already up (a cloud run's AI sign-in or first question, timed on its own clock)
const saved = RESUME && !TAIL ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : null; // a run that stopped part-way: the clock and steps so far
const LOAD0 = loadavg()[0]; // the host's one-minute load: a loaded host makes every time here an upper bound
const T0 = saved ? saved.T0 : Date.now(); const steps = saved ? saved.steps : [];
const mark = (name, extra = {}) => {
  const now = Date.now(), prev = steps.length ? steps[steps.length - 1].t : T0;
  steps.push({ step: name, at: new Date(now).toISOString(), t: now, afterSeconds: +((now - prev) / 1000).toFixed(1), sinceStartSeconds: +((now - T0) / 1000).toFixed(1), ...extra });
  writeFileSync(STATE_FILE, JSON.stringify({ T0, steps }));
  say(`step ${name} +${((now - prev) / 1000).toFixed(1)}s (${((now - T0) / 1000).toFixed(1)}s since install start)${extra.harness ? ' [harness]' : ''}`);
};

// What is on screen: text and label of every node.
const nodes = () => {
  for (let i = 0; ; i++) { try { adb('shell', 'uiautomator', 'dump', '--windows', '/sdcard/fm-timing.xml'); break; } catch (e) { if (i > 12) throw e; execFileSync('sleep', ['1']); } } // a dump fails while the screen changes
  const attr = (n, name) => { const m = n.match(new RegExp(` ${name}=(?:"([^"]*)"|'([^']*)')`)); return m ? m[1] ?? m[2] : ''; };
  return [...adb('shell', 'cat', '/sdcard/fm-timing.xml').matchAll(/<node [^>]*>/g)].map(([n]) => ({
    text: attr(n, 'text'), desc: attr(n, 'content-desc'), pkg: attr(n, 'package'),
    b: (n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []).slice(1).map(Number) }));
};
const has = (re, ns) => ns.find((n) => n.pkg === PKG && (re.test(n.text) || re.test(n.desc)));
const see = async (re, seconds = 60) => {
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(700)) { const n = has(re, nodes()); if (n) return n; }
  throw new Error(`never saw ${re} in ${seconds}s`);
};
const tap = (n) => adb('shell', 'input', 'tap', String((n.b[0] + n.b[2]) >> 1), String((n.b[1] + n.b[3]) >> 1));
const tapWhen = async (re, seconds = 60) => { const n = await see(re, seconds); tap(n); return n; };
const type = async (secret) => { for (const part of secret.match(/.{1,3}/g)) { adb('shell', `input text '${part}'`); await sleep(400); } };
const keysUp = () => /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'));
const focus = async (box) => { for (let i = 0; i < 5 && !keysUp(); i++) { tap(box); await sleep(1200); } if (!keysUp()) throw new Error('the keyboard never opened on the box'); };
const hideKeys = () => { if (/mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'))) adb('shell', 'input', 'keyevent', '4'); };
const shot = (name) => writeFileSync(join(OUT, name), execFileSync('adb', ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 27 }));
const theme = (night) => adb('shell', 'cmd', 'uimode', 'night', night ? 'yes' : 'no');

// Chief's first useful answer: after the question is sent, the first text that was not on screen before and is a
// sentence (not the question, not a status word) and holds still for two looks.
async function answer(before, said = ASK, seconds = 240) {
  const known = new Set(before.map((n) => n.text));
  let last = '', same = 0;
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(1500)) {
    const fresh = nodes().filter((n) => n.pkg === PKG && n.text.length > 25 && !known.has(n.text) && !(said.length > 10 && n.text.includes(said)) && !/working|thinking|typing|(Ask|Tell) Chief|sign in|signed in|start now/i.test(n.text));
    const text = fresh.map((n) => n.text).join('|');
    same = text && text === last ? same + 1 : 0; last = text;
    if (same >= 1) return fresh[0].text.length;
  }
  throw new Error(`no answer from Chief in ${seconds}s`);
}

async function ask(line = ASK, label = 'question', last = true, wait = true) {
  const box = await see(/(Ask|Tell) Chief anything/, 60);
  const before = nodes();
  tap(box); await sleep(800);
  adb('shell', 'input', 'text', line.replace(/ /g, '%s').replace(/,/g, ''));
  await sleep(500); hideKeys(); await sleep(500);
  mark(`${label} typed (harness)`, { harness: true });
  tap(await see(/^Send$/i, 15));
  mark(`${label} sent`);
  if (!wait) return;
  const length = await answer(before, line);
  mark(last ? "Chief's first useful answer" : `Chief replied to the ${label}`, { answerLength: length });
}

// Install start is the clock's zero: adb install of the release APK onto a wiped app.
function install() {
  adb('install', '-r', APK);
  mark('app installed');
  adb('shell', 'pm', 'clear', PKG);
  adb('shell', 'wm', 'size', '1080x2400'); adb('shell', 'wm', 'density', '443'); // 390 wide
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
}

const recipes = {
  async phone() {
    install();
    await see(/Where should I work/, 90); mark('opening screen: Where should I work?');
    await tapWhen(/^Just chat from this phone, no setup$/); await see(/Chief on this phone/); mark('picked: just chat from this phone');
    await tapWhen(/^MiniMax$/); await focus(await see(/Paste your MiniMax key/));
    await type(readFileSync(KEY_FILE, 'utf8').trim()); hideKeys();
    mark('MiniMax key entered (harness types it; a person pastes)', { harness: true });
    await tapWhen(/^Connect$/); await see(/Which model should Chief use/, 60); mark('key accepted, model list shown');
    await tapWhen(/^MiniMax M3\.1 Flash$/, 20); await tapWhen(/^Use MiniMax/, 20); mark('model picked and confirmed');
    await ask();
  },
};
// The computer is already running (onboard-timing.sh brought it up and timed that); the phone pairs by the relay code,
// because an emulator cannot hear the Wi-Fi announcement the 12-letter code needs. The yes is the computer's own API call.
const api = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${readFileSync(join(STATE, 'person.key'), 'utf8').trim()}` }, body: body && JSON.stringify(body) });
  const out = await r.json(); if (!r.ok) throw new Error(out.error || `HTTP ${r.status}`); return out;
};
recipes.computer = async () => {
  install();
  await see(/Where should I work/, 90); mark('opening screen: Where should I work?');
  await tapWhen(/^My computer$/); mark('picked: My computer (how-to-run card)');
  await tapWhen(/^Type the code$/); const box = await see(/^Pairing code$|^Type or paste the code$/); await focus(box); mark('pairing box open');
  const offer = await api('/api/phones/code', { role: 'control' });
  await sleep(500);
  await type(`${offer.short}-${offer.code}@${offer.relay}`); hideKeys();
  mark('code typed (harness types it; a person reads and types it)', { harness: true });
  await tapWhen(/^Pair$/);
  let asking = [];
  let retries = 0;
  for (const end = Date.now() + 180000; Date.now() < end && !asking.length; await sleep(500)) {
    asking = await api('/api/phones/pending');
    const slow = !asking.length && retries < 3 && has(/slow to answer/, nodes()); // the app's own wait ran out: a person presses Pair again
    if (slow) { retries++; mark(`phone said "Your computer is slow to answer" (retry ${retries})`); await tapWhen(/^Pair$/, 10); }
  }
  if (!asking.length) throw new Error('the computer never saw the phone ask to pair');
  mark('phone asking; the two words are on both screens');
  await api('/api/phones/answer', { id: asking[0].id, yes: true }); // the computer card's "Yes, the words match"
  mark('computer said yes');
  // Android's own notification question can come first (another package, so looked for on every node); a person answers it.
  for (const end = Date.now() + 90000; Date.now() < end; await sleep(700)) {
    const ns = nodes(), allow = ns.find((n) => /^Allow$/.test(n.text)), open = has(/^Open Crewhouse$/, ns);
    if (allow) { tap(allow); mark('notification question answered (Allow)'); } else if (open) { tap(open); mark('paired, Crewhouse opened'); break; } else if (has(/(Ask|Tell) Chief anything/, ns)) break;
  }
  // First run on a computer: Chief asks what to call the person before anything else, so the name goes first.
  if (has(/call you|name/i, nodes())) await ask('Sam', 'name', false);
  await ask();
};
// The driver (boat-run.mjs) holds the boat.dev fleet key and rents/deletes the one computer; the key is typed into the
// phone by it, never read here. A sign-in by emailed code needs a person at boat.dev, so the run pastes a key, which
// the key box only reads from the clipboard: the harness stages it through the sign-in's email box (a person copies it).
const boat = (path) => execFileSync('curl', ['-sS', '--unix-socket', SOCK, `http://x/${path}`], { encoding: 'utf8' });
const names = (re, ns = nodes()) => ns.filter((n) => n.pkg === PKG && re.test(n.text)).map((n) => n.text);
recipes.cloud = async () => {
  if (!SOCK) throw new Error('the cloud recipe needs --boat-sock (boat-run.mjs)');
  install();
  await see(/Where should I work/, 90); mark('opening screen: Where should I work?');
  await tapWhen(/^Cloud$/); await see(/Sign in to boat\.dev/); mark('picked: Cloud (boat.dev sign-in shown)');
  await focus(await see(/^Email address$/));
  boat('deliver'); await sleep(1000);
  adb('shell', 'input', 'keycombination', '113', '29'); adb('shell', 'input', 'keycombination', '113', '31'); adb('shell', 'input', 'keyevent', '67');
  hideKeys(); await sleep(800);
  mark('boat.dev key put on the clipboard (harness; a person copies it from boat.dev)', { harness: true });
  await tapWhen(/^Other ways/); await tapWhen(/^Paste a boat\.dev key$/); await tapWhen(/^Paste key$/);
  await see(/Which computer should I use/, 60); mark('key accepted, computers listed');
  await tapWhen(/^Make a new computer instead$/); await see(/Make it and set it up/); mark('new-computer card with the cost line');
  await tapWhen(/^Make it and set it up$/); mark('rented: pressed Make it and set it up');
  let shown = '';
  for (const end = Date.now() + 25 * 60000; Date.now() < end; await sleep(2000)) {
    const ns = nodes(), rows = names(/\b(Making|Installing|Starting|Setting|Connecting|Pairing|Waiting|Downloading|Checking|Creating)\b/i, ns).join(' | ');
    if (rows && rows !== shown) { shown = rows; mark(`setup: ${rows.slice(0, 80)}`); }
    if (has(/Chief is on your cloud computer/, ns)) { mark('setup finished: Chief is on your cloud computer'); break; }
    if (has(/Try again/, ns)) throw new Error(`setup stopped: ${names(/./, ns).filter((t) => /stopped|problem|failed/i.test(t)).join(' ').slice(0, 160)}`);
  }
  await cloudTail();
};
async function cloudTail() {
  await tapWhen(/^Talk to Chief$/, 30); mark('Talk to Chief pressed');
  for (const end = Date.now() + 60000; Date.now() < end; await sleep(700)) { const a = nodes().find((n) => /^Allow$/.test(n.text)); if (a) { tap(a); mark('notification question answered (Allow)'); } else if (has(/(Ask|Tell) Chief anything/, nodes())) break; }
  if (has(/call you|name/i, nodes())) await ask('Sam', 'name', false);
  await ask(ASK, 'question', true, false); // no AI account yet: Chief says to sign in, and keeps the question waiting
  await cloudResume();
}


// The rented computer has no AI account: Chief says so and waits. The person pastes their MiniMax key in Settings on the
// phone that set the computer up (the driver types it, masked), signs in, picks the model, and Chief answers the waiting question.
async function cloudAi() {
  const wasThere = nodes();
  tap(await see(/^Settings$/, 30)); await see(/This phone/, 30); mark('Settings opened');
  let paste = null;
  for (let i = 0; i < 10 && !paste; i++) { paste = has(/^Paste your MiniMax key$/, nodes()); if (!paste) { adb('shell', 'input', 'swipe', '540', '1800', '540', '700', '300'); await sleep(700); } }
  if (!paste) throw new Error('Settings never showed Paste your MiniMax key');
  mark('found: Paste your MiniMax key'); tap(paste);
  await focus(await see(/^MiniMax key$/, 20)); boat('ai'); await sleep(800);
  mark('MiniMax key entered (harness types it; a person pastes)', { harness: true });
  await tapWhen(/^Sign in with MiniMax$/, 20); await see(/You.re signed in with MiniMax/, 90); mark('signed in with MiniMax');
  await tapWhen(/^MiniMax M3$/, 20); mark('model picked');
  adb('shell', 'input', 'keyevent', '4'); await sleep(1000);
  const chat = nodes().filter((n) => n.pkg === PKG && /^Chief$/.test(n.text)).at(-1); if (chat) tap(chat);
  await see(/(Ask|Tell) Chief anything/, 30); mark('back in Chief chat');
  return wasThere;
}
async function cloudResume() {
  const before = nodes();
  await cloudAi();
  const length = await answer(before, ASK, 300);
  mark("Chief's first useful answer", { answerLength: length });
}
let failure = null;
try { await (TAIL === 'signin' ? cloudAi() : TAIL === 'ask' ? ask() : RESUME ? cloudResume() : recipes[RECIPE]()); } catch (e) { failure = String(e.message || e); say(`FAILED: ${failure}`); }
const end = Date.now(); // the clock stops at the answer, before the captures
// The first useful screen, as the installed app shows it, light and dark at 390 wide.
try { for (const night of [false, true]) { theme(night); await sleep(2500); shot(`first-useful-screen-${RECIPE}-390-${failure ? 'failed-' : ''}${night ? 'dark' : 'light'}.png`); } theme(false); } catch { /* no emulator left to ask */ }

const timed = steps.filter((s) => !s.harness);
const slowest = timed.reduce((a, s) => (!a || s.afterSeconds > a.afterSeconds ? s : a), null);
const result = {
  hostLoad: { oneMinuteAtStart: +LOAD0.toFixed(1), oneMinuteAtEnd: +loadavg()[0].toFixed(1), cores: cpus().length },
  recipe: RECIPE, startedAt: new Date(T0).toISOString(), finishedAt: new Date(end).toISOString(), reachedAnswer: !failure, failure,
  totalSeconds: failure ? null : +((end - T0) / 1000).toFixed(1),
  harnessSeconds: +steps.filter((s) => s.harness).reduce((a, s) => a + s.afterSeconds, 0).toFixed(1),
  slowestStep: slowest && { step: slowest.step, seconds: slowest.afterSeconds },
  waitsOver30s: steps.filter((s) => s.afterSeconds > SLOW).map((s) => ({ spentIn: s.step, seconds: s.afterSeconds, harness: !!s.harness })),
  steps: steps.map(({ t, ...s }) => s),
};
writeFileSync(join(OUT, `timing-${RECIPE}.json`), JSON.stringify(result, null, 2) + '\n');
writeStepsRecord(join(OUT, RECIPE), {
  target: { version: JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version },
  start: `A wiped Android emulator with no Crewhouse installed (${RECIPE} recipe).`,
  steps: steps.map((s) => s.step),
  result: failure ? `Did not reach an answer: ${failure}` : "Chief's first answer to the question is on screen.",
});
say(`host one-minute load ${LOAD0.toFixed(1)} at start, ${loadavg()[0].toFixed(1)} at end, on ${cpus().length} cores`);
say(`${RECIPE}: ${failure ? 'NO NUMBER (' + failure + ')' : result.totalSeconds + ' s total'}; slowest ${slowest ? slowest.step + ' ' + slowest.afterSeconds + ' s' : 'n/a'}`);
process.exit(failure ? 1 : 0);
