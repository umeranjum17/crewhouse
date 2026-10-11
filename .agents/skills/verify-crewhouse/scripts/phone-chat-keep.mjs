#!/usr/bin/env node
// The phone-only chat's own durability proof (mobile/src/phone-only.ts): the chat lives in app storage,
// reloads on open, and a turn the app was killed in the middle of comes back stopped with Try again.
//
//   node .agents/skills/verify-crewhouse/scripts/phone-chat-keep.mjs \
//     --serial emulator-5562 --repo "$PWD" --ev "$EV" --key-file /home/umer/.config/openrouter/api_key \
//     [--apk path.apk] [--seed-turns 52]
//
// It drives the real release app on an emulator: sign in with the person's own OpenRouter key (file only,
// pushed to the device and typed without ever touching this process's argv), send turns, force-stop and
// relaunch, kill a turn mid-flight, then Try again. With --seed-turns it writes a long log straight into the
// app's own files (emulator root) and measures the reopen, so the 50+-turn load and scroll are real.
//
// The key is never printed, logged or committed: it is read from --key-file and pushed to /data/local/tmp,
// typed by the device shell (`cat`), then deleted from the device. `adb root` is used only on this task's
// emulator (google_apis image); the app's private files are erased at the end.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const SERIAL = opt('serial', 'emulator-5562');
const REPO = opt('repo', process.cwd());
const EV = opt('ev', null);
const KEY_FILE = opt('key-file', '/home/umer/.config/openrouter/api_key');
const APK = opt('apk', null);
const SEED = Number(opt('seed-turns', 0));
if (!EV) { console.error('usage: phone-chat-keep.mjs --ev <evidence-dir> [--serial s] [--repo r] [--key-file k] [--apk a] [--seed-turns n]'); process.exit(2); }
mkdirSync(join(EV, 'screens'), { recursive: true });

const PKG = 'dev.crewhouse.app';
const A = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const Aout = (file, ...a) => writeFileSync(file, execFileSync('adb', ['-s', SERIAL, ...a], { maxBuffer: 1 << 27 }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nodes = () => {
  let xml = '';
  for (let i = 0; i < 3; i++) { try { A('shell', 'uiautomator', 'dump', '--windows', '/sdcard/ui.xml'); xml = A('shell', 'cat', '/sdcard/ui.xml'); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); } }
  if (!xml) return []; // a busy window can refuse the dump; the caller polls again
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => ({
    text: (n.match(/ text="([^"]*)"/) || [])[1] || '', desc: (n.match(/content-desc="([^"]*)"/) || [])[1] || '',
    b: (n.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/) || []).slice(1).map(Number) }));
};
const shot = (name) => Aout(join(EV, 'screens', name), 'exec-out', 'screencap', '-p');
const tapText = (re, nth = 0) => { const m = nodes().filter((n) => new RegExp(re).test(n.text) || new RegExp(re).test(n.desc)); const n = m[nth];
  if (!n) throw new Error(`no node matching ${re}`); const [x1, y1, x2, y2] = n.b; A('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1)); return n.text || n.desc; };
const type = (s) => A('shell', 'input', 'text', s.trim().replace(/ /g, '%s'));
const launch = () => { A('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`); };
const forceStop = () => A('shell', 'am', 'force-stop', PKG);
// A speaker label ("You"/"Chief") sits at x=42; the header and hero sit further right.
const speakers = (who) => nodes().filter((n) => n.text === who && n.b[0] === 42).length;
const has = (re) => nodes().some((n) => new RegExp(re).test(n.text) || new RegExp(re).test(n.desc));
// A cold emulator under CPU contention can throw a System UI "isn't responding" dialog over the app; Wait clears it.
const dismissAnr = () => { try { if (has("isn.t responding")) { tapText('^Wait$'); return true; } } catch { /* dump raced */ } return false; };
const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (dismissAnr()) await sleep(400); if (fn()) return Date.now() - t0; await sleep(700); } throw new Error(`timed out waiting for ${what}`); };
// A turn is done when the screen's text stops changing: while Chief streams, the growing words and the
// blinking cursor keep the text in motion; once the answer is committed the text holds still.
const settle = async (ms = 90000) => { let prev = '', still = 0; const t0 = Date.now();
  while (Date.now() - t0 < ms) { const cur = nodes().map((n) => n.text).join('\n'); if (cur === prev && cur.includes('Ask Chief anything')) { if (++still >= 2) return Date.now() - t0; } else still = 0; prev = cur; await sleep(900); } return Date.now() - t0; };
const log = [];
const say = (line) => { log.push(line); console.log(line); };

const run = async () => {
  // --- fresh install of the real app ---
  if (APK) { try { A('uninstall', PKG); } catch { /* not installed */ } A('install', '-r', '-g', APK); }
  A('shell', 'pm', 'clear', PKG);
  A('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
  A('shell', 'wm', 'density', 'reset');
  launch();
  await waitFor(() => has("Use this phone only"), 90000, "first run");
  say('first run shown'); shot('00-firstrun.png');

  // --- sign in with the person's own key (file only; never this process's argv) ---
  tapText('Use this phone only');
  await waitFor(() => has('Paste your .* key'), 15000, 'key screen');
  tapText('Paste your .* key');
  A('push', KEY_FILE, '/data/local/tmp/kc.txt');
  A('shell', 'input text "$(cat /data/local/tmp/kc.txt)"');
  A('shell', 'rm', '-f', '/data/local/tmp/kc.txt');
  await sleep(800);
  tapText('^Connect$');
  await waitFor(() => has('Ask Chief anything'), 30000, 'the composer');
  say('signed in, composer ready'); shot('01-chat-empty.png');

  // --- a real turn, then a real document ---
  // The emulator's slirp networking drops the odd outbound request; a person just sends again, so the driver
  // does the same (this also exercises sending a second turn), and only reports a leg once it truly landed.
  const errs = () => nodes().filter((n) => /Could not finish on this phone|No internet connection|at its limit|cut short/.test(n.text)).length;
  const send = async (text, what, expect) => {
    for (let i = 1; i <= 6; i++) {
      const before = errs();
      tapText('Ask Chief anything'); await sleep(500); await type(text); await sleep(600); tapText('Send');
      const ms = await settle();
      if (errs() === before && (!expect || expect())) { say(`${what}: settled in ${ms} ms${i > 1 ? ` (try ${i})` : ''}`); return ms; }
      say(`${what}: attempt ${i} did not land, sending again`); await sleep(1800);
    }
    throw new Error(`${what} did not land after 6 tries (emulator network / provider)`);
  };
  await send('Say hello back in five words.', 'hello turn'); shot('02-hello.png');
  await send('Use your document tool to make a Word file named Packing list with a heading Essentials and a bullet list: 3 shirts, 3 socks, toothbrush.', 'document turn', () => has('Document')); shot('03-document.png');
  say('document card shown');

  // --- the chat survives a kill ---
  forceStop(); await sleep(1200); launch();
  const t0 = Date.now(); await waitFor(() => has('Ask Chief anything'), 30000, 'the reloaded composer');
  await waitFor(() => speakers('Chief') >= 2, 8000, 'the two reloaded answers');
  say(`chat reloaded after a kill in ${Date.now() - t0} ms`); shot('04-after-kill.png');

  // --- the document card still reads after the reload (its parts were kept) ---
  tapText('^Read$'); await waitFor(() => has('Essentials'), 6000, 'the kept document'); shot('05-read-after-reload.png');
  tapText('^Close$'); await sleep(600);

  // --- a turn cut off mid-flight comes back stopped, with Try again ---
  tapText('Ask Chief anything'); await sleep(500); await type('Write one friendly sentence about coffee.'); await sleep(600);
  tapText('Send'); forceStop();
  say('killed the app while the turn ran'); await sleep(1200); launch();
  await waitFor(() => has('Try again'), 30000, 'the stopped turn'); shot('06-stopped.png');

  // --- Try again re-sends it as a new turn and answers ---
  const beforeRetry = speakers('You');
  tapText('^Try again$');
  await waitFor(() => speakers('You') > beforeRetry, 15000, 'the retried turn to start');
  const rms = await settle();
  say(`Try again settled in ${rms} ms`); shot('07-retry-answer.png');

  // --- 50+ turns: load and scroll (seeded straight into the app's own files, emulator root) ---
  if (SEED) {
    try { A('root'); } catch { /* already root or not permitted */ }
    await sleep(1500);
    const lines = [];
    for (let i = 0; i < SEED; i++) { lines.push(JSON.stringify({ t: 'you', text: `Turn ${i}: what is ${i} plus ${i}?` })); lines.push(JSON.stringify({ t: 'chief', text: `Turn ${i}: that is ${i + i}.` })); }
    const file = join(EV, `seed-${SEED}.jsonl`); writeFileSync(file, lines.join('\n') + '\n');
    const target = `/data/data/${PKG}/files/phone-chat.jsonl`;
    const owner = A('shell', 'stat', '-c', '%u:%g', `/data/data/${PKG}/files`).trim();
    forceStop();
    A('push', file, '/data/local/tmp/seed.jsonl');
    A('shell', 'cp', '/data/local/tmp/seed.jsonl', target);
    A('shell', 'chown', owner, target);
    A('shell', 'chmod', '660', target);
    A('shell', 'restorecon', target); // give it the app's own SELinux label, or the app cannot read it
    A('shell', 'rm', '-f', '/data/local/tmp/seed.jsonl');
    const s0 = Date.now(); launch();
    await waitFor(() => has('Ask Chief anything'), 30000, 'the reloaded composer');
    const loaded = Date.now() - s0;
    await waitFor(() => speakers('Chief') >= 1, 8000, 'lines on screen');
    say(`${SEED} turns reloaded in ${loaded} ms`); shot('08-many-turns.png');
    for (let i = 0; i < 6; i++) { A('shell', 'input', 'swipe', '540', '1900', '540', '500', '180'); await sleep(300); }
    say('scrolled to the top of the long chat'); shot('09-many-turns-top.png');
    // narrow width at 1.3x text (360 dp: 1080 px / 360 dp * 160)
    A('shell', 'settings', 'put', 'system', 'font_scale', '1.3');
    A('shell', 'wm', 'density', '480');
    await sleep(1500); shot('10-narrow-1.3x.png');
    A('shell', 'settings', 'put', 'system', 'font_scale', '1.0'); A('shell', 'wm', 'density', 'reset'); await sleep(800);
  }

  // --- erase the key and the chat from this emulator ---
  A('shell', 'rm', '-f', '/data/data/' + PKG + '/files/phone-chat.jsonl');
  A('shell', 'pm', 'clear', PKG);
  A('uninstall', PKG);
  say('erased the key, the chat and the app from the emulator');
  writeFileSync(join(EV, 'phone-chat-keep.log'), log.join('\n') + '\n');
};
run().catch((e) => { console.error('FAILED:', e.message); writeFileSync(join(EV, 'phone-chat-keep.log'), log.join('\n') + `\nFAILED: ${e.message}\n`); process.exit(1); });
