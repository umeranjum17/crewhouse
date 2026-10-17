#!/usr/bin/env node
// The phone-only chat's own durability proof (mobile/src/phone-only.ts, mobile/App.tsx): the chat lives in
// app storage, reloads on open, and a turn the app was killed inside of comes back stopped with Try again;
// a document effect killed inside comes back "Interrupted. Retry?" with exactly one file; a message written
// with no connection waits as "Queued, not sent yet" and goes when the phone hears the model again.
//
//   node scripts/verify/phone-chat-keep.mjs \
//     --serial emulator-5562 --repo "$PWD" --ev "$EV" --key-file "$HOME/.config/openrouter/api_key" \
//     [--apk path.apk] [--seed-turns 52] [--offline] [--interrupted]
//
// It drives the real release app on an emulator: sign in with the person's own OpenRouter key (file only,
// pushed to the device and typed without ever touching this process's argv), send turns, force-stop and
// relaunch, kill a turn mid-flight, then Try again. --offline cuts the emulator's wifi to prove the queued
// state and back. --interrupted seeds the exact on-disk state a kill inside crew_document leaves (a turn's
// start marker plus a `started` request journal entry and its file) and proves reopen shows "Interrupted."
// with Retry, and Retry reuses the one file. With --seed-turns it writes a long log straight into the app's
// own files (emulator root) and measures the reopen, so the 50+-turn load and scroll are real.
//
// The key is never printed, logged or committed: it is read from --key-file and pushed to /data/local/tmp,
// typed by the device shell (`cat`), then deleted from the device. `adb root` is used only on this task's
// emulator (google_apis image); the app's private files are erased at the end.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);
const SERIAL = opt('serial', 'emulator-5562');
const EV = opt('ev', null);
const KEY_FILE = opt('key-file', `${process.env.HOME}/.config/openrouter/api_key`);
const APK = opt('apk', null);
const SEED = Number(opt('seed-turns', 0));
const OFFLINE = has('offline');
const INTERRUPTED = has('interrupted');
// --no-answers: the provider has no credit (HTTP 402, the app's plain error line), so prove keeping with that line.
const NO_ANSWERS = has('no-answers');
if (!EV) { console.error('usage: phone-chat-keep.mjs --ev <evidence-dir> [--serial s] [--apk a] [--seed-turns n] [--offline] [--interrupted]'); process.exit(2); }
mkdirSync(join(EV, 'screens'), { recursive: true });

const PKG = 'dev.crewhouse.app';
const FILES = `/data/data/${PKG}/files`;
const A = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const Aout = (file, ...a) => writeFileSync(file, execFileSync('adb', ['-s', SERIAL, ...a], { maxBuffer: 1 << 27 }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nodes = () => {
  let xml = '';
  for (let i = 0; i < 3; i++) { try { A('shell', 'uiautomator', 'dump', '--windows', '/sdcard/ui.xml'); xml = A('shell', 'cat', '/sdcard/ui.xml'); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); } }
  if (!xml) return []; // a busy window can refuse the dump; the caller polls again
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => ({
    text: (n.match(/ text="([^"]*)"/) || [])[1] || '', desc: (n.match(/content-desc="([^"]*)"/) || [])[1] || '',
    enabled: (n.match(/ enabled="(true|false)"/) || [])[1] !== 'false',
    b: (n.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/) || []).slice(1).map(Number) }));
};
const shot = (name) => Aout(join(EV, 'screens', name), 'exec-out', 'screencap', '-p');
const tapText = (re, nth = 0) => { const m = nodes().filter((n) => new RegExp(re).test(n.text) || new RegExp(re).test(n.desc)); const n = m[nth];
  if (!n) throw new Error(`no node matching ${re}`); const [x1, y1, x2, y2] = n.b; A('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1)); return n.text || n.desc; };
const type = (s) => A('shell', 'input', 'text', s.trim().replace(/ /g, '%s'));
// The lowest match on screen, any case: an Alert dialog's button (Android capitalises it) sits below the header link.
const tapLowest = (re) => { const m = nodes().filter((n) => new RegExp(re, 'i').test(n.text) || new RegExp(re, 'i').test(n.desc));
  if (!m.length) throw new Error(`no node matching ${re}`); const n = m.reduce((a, b) => (b.b[1] > a.b[1] ? b : a));
  A('shell', 'input', 'tap', String((n.b[0] + n.b[2]) >> 1), String((n.b[1] + n.b[3]) >> 1)); return n.text || n.desc; };
const launch = () => A('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
const forceStop = () => A('shell', 'am', 'force-stop', PKG);
// Stop then start in one call: a plain start on a live app only brings it to the front, so the mount effects
// (the connectivity probe and the queued flush) would never run. -S guarantees a cold remount.
const relaunch = () => A('shell', 'am', 'start', '-S', '-n', `${PKG}/.MainActivity`);
const hasNode = (re) => nodes().some((n) => new RegExp(re).test(n.text) || new RegExp(re).test(n.desc));
const speakers = (who) => nodes().filter((n) => n.text === who && n.b[0] === 42).length;
// A cold emulator under CPU contention can throw a System UI "isn't responding" dialog over the app; Wait clears it.
const dismissAnr = () => { try { if (hasNode("isn.t responding")) { tapText('^Wait$'); return true; } } catch { /* dump raced */ } return false; };
const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (dismissAnr()) await sleep(400); if (fn()) return Date.now() - t0; await sleep(700); } throw new Error(`timed out waiting for ${what}`); };
// A turn is done when the screen's text stops changing: while Chief streams, the growing words and the
// blinking cursor keep the text in motion; once the answer is committed the text holds still.
const settle = async (ms = 120000) => { let prev = '', still = 0; const t0 = Date.now();
  while (Date.now() - t0 < ms) { const cur = nodes().map((n) => n.text).join('\n'); if (cur === prev && cur.includes('Ask Chief anything')) { if (++still >= 2) return Date.now() - t0; } else still = 0; prev = cur; await sleep(900); } return Date.now() - t0; };
const log = [];
const say = (line) => { log.push(line); console.log(line); };
const chat = () => { try { return A('shell', 'cat', `${FILES}/phone-chat.jsonl`); } catch { return ''; } };
const requests = () => { try { return A('shell', 'cat', `${FILES}/phone-requests.jsonl`); } catch { return ''; } };
const files = () => { try { return A('shell', 'ls', FILES).split('\n'); } catch { return []; } };
const chiefCount = (body) => (body.match(/"t":"chief"/g) || []).length;
const writeDevice = (name, body) => { writeFileSync(join(EV, name), body); const tmp = `/data/local/tmp/${name}`, dst = `${FILES}/${name}`;
  A('push', join(EV, name), tmp);
  A('shell', `cp '${tmp}' '${dst}'`);
  const owner = A('shell', 'stat', '-c', '%u:%g', FILES).trim();
  A('shell', `chown '${owner}' '${dst}'`); A('shell', `chmod 660 '${dst}'`); A('shell', `restorecon '${dst}'`); A('shell', `rm -f '${tmp}'`); };

const run = async () => {
  // --- fresh install of the real app ---
  if (APK) { try { A('uninstall', PKG); } catch { /* not installed */ } A('install', '-r', '-g', APK); }
  A('shell', 'pm', 'clear', PKG);
  try { A('root'); A('wait-for-device'); await sleep(1500); } catch { /* already root or not permitted */ }
  A('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
  A('shell', 'wm', 'density', 'reset');
  launch();
  await waitFor(() => hasNode('Use this phone only'), 90000, 'first run');
  say('first run shown'); shot('00-firstrun.png');

  // --- sign in with the person's own key (file only; never this process's argv) ---
  tapText('Use this phone only');
  await waitFor(() => hasNode('Paste your .* key'), 15000, 'key screen');
  tapText('Paste your .* key');
  A('push', KEY_FILE, '/data/local/tmp/kc.txt');
  A('shell', 'input text "$(cat /data/local/tmp/kc.txt)"');
  A('shell', 'rm', '-f', '/data/local/tmp/kc.txt');
  await sleep(800);
  tapText('^Connect$');
  await waitFor(() => hasNode('Ask Chief anything'), 30000, 'the composer');
  say('signed in, composer ready'); shot('01-chat-empty.png');

  const sendWait = async (text, what, expect) => {
    for (let i = 1; i <= 8; i++) {
      tapText('Ask Chief anything'); await sleep(500); await type(text); await sleep(500); tapText('Send');
      const ms = await settle();
      if (!expect) { say(`${what}: settled in ${ms} ms`); return ms; }
      const ok = await (async () => { const t = Date.now(); while (Date.now() - t < 45000) { if (expect()) return true; await sleep(1500); } return false; })();
      if (ok) { say(`${what}: settled in ${ms} ms${i > 1 ? ` (try ${i})` : ''}`); return ms; }
      say(`${what}: attempt ${i} did not land, sending again`); await sleep(3000);
    }
    throw new Error(`${what} did not land after 8 tries (emulator network / provider)`);
  };

  if (NO_ANSWERS) {
    await sendWait('Say hello back in five words.', 'hello turn (provider error line expected)', () => speakers('Chief') >= 1); shot('02-hello.png');
    forceStop(); await sleep(1200); launch();
    const t1 = Date.now(); await waitFor(() => hasNode('Ask Chief anything') && speakers('Chief') >= 1 && hasNode('Say hello back'), 30000, 'the reloaded turn');
    say(`chat reloaded after a kill in ${Date.now() - t1} ms (real answer and document legs: see the credited run)`); shot('04-after-kill.png');
  } else {
  // --- a real turn, then a real document (a short document: the emulator drops the odd long stream) ---
  await sendWait('Say hello back in five words.', 'hello turn', () => speakers('Chief') >= 1); shot('02-hello.png');
  await sendWait('Make a Word file called Note with one paragraph: All set.', 'document turn', () => hasNode('Document'));
  say('document card shown'); shot('03-document.png');

  // --- the chat survives a kill ---
  forceStop(); await sleep(1200); launch();
  const t0 = Date.now(); await waitFor(() => hasNode('Ask Chief anything'), 30000, 'the reloaded composer');
  await waitFor(() => speakers('Chief') >= 2, 8000, 'the two reloaded answers');
  await waitFor(() => hasNode('Document'), 8000, 'the kept document card');
  say(`chat reloaded after a kill in ${Date.now() - t0} ms`); shot('04-after-kill.png');

  // --- the document card still reads after the reload (its parts were kept) ---
  tapText('^Read$'); await waitFor(() => hasNode('All set'), 6000, 'the kept document'); shot('05-read-after-reload.png');
  tapText('^Close$'); await sleep(600);
  }

  // --- a turn cut off mid-flight comes back stopped, with Try again ---
  let stopped = false;
  for (let i = 1; i <= 4 && !stopped; i++) {
    tapText('Ask Chief anything'); await sleep(400); await type('Write one friendly sentence about coffee.'); await sleep(400);
    // Kill the moment the turn's start marker is on disk: before any answer (or a quick provider error) lands.
    const marks = (chat().match(/coffee/g) || []).length;
    tapText('Send'); for (let w = 0; w < 40 && (chat().match(/coffee/g) || []).length === marks; w++) await sleep(50); forceStop();
    say('killed the app while the turn ran'); await sleep(1200); launch();
    try { await waitFor(() => hasNode('Try again') || hasNode('Retry'), 16000, 'the stopped turn'); stopped = true; shot('06-stopped.png'); }
    catch { say(`cut-off attempt ${i}: the answer landed before the kill; trying again`); }
  }
  if (!stopped) throw new Error('could not leave a cut-off turn on disk');

  // --- Try again re-sends it as a new turn and answers ---
  const beforeRetry = (chat().match(/coffee/g) || []).length;
  tapText('^Try again$');
  await waitFor(() => (chat().match(/coffee/g) || []).length > beforeRetry, 25000, 'the retried turn written');
  say(`Try again wrote a new turn; settled in ${await settle()} ms`); shot('07-retry-answer.png');

  // --- interrupted crew_document: reopen shows "Interrupted." with Retry and exactly one file ---
  if (INTERRUPTED) {
    say('seeding the exact state a kill inside crew_document leaves');
    forceStop(); await sleep(800);
    try { A('root'); } catch { /* already root */ }
    await sleep(1500);
    const RID = 'rid-interrupted-1', CALL = 'call-interrupted-1', NAME = 'Interrupted proof';
    writeDevice('phone-chat.jsonl', JSON.stringify({ t: 'you', text: 'Make a Word file called Proof with one paragraph: Done.', rid: RID }) + '\n');
    writeDevice('phone-requests.jsonl', JSON.stringify({ rid: RID, callId: CALL, fileName: `chief-${CALL}-${NAME}.docx`, state: 'started' }) + '\n');
    writeDevice('phone-meta.json', JSON.stringify({ heardAt: Date.now() }) + '\n');
    writeDevice(`chief-${CALL}-${NAME}.docx`, 'PK-partial');
    launch();
    await waitFor(() => hasNode('Interrupted') && hasNode('Retry'), 30000, 'the interrupted turn');
    say('reopen shows: ' + nodes().filter((n) => /Interrupted|Retry/.test(n.text)).map((n) => n.text.trim()).filter(Boolean).join(' | '));
    shot('08-interrupted.png');
    say(`files before Retry: ${files().filter((f) => f.startsWith(`chief-${CALL}`)).length}`);
    tapText('^Retry$');
    await waitFor(() => speakers('Chief') >= 1, 15000, 'the retried document turn');
    await settle();
    const n = files().filter((f) => f.startsWith(`chief-${CALL}`)).length;
    say(`exactly one file after Retry: ${n === 1} (${n})`); shot('09-interrupted-retry.png');
    if (n !== 1) throw new Error(`retry doubled the document: ${n} files`);
  }

  // --- offline: banner, a queued message that never looks sent, actions off, then it goes ---
  if (OFFLINE) {
    const ping = () => { try { return /1 received|1 packets received/.test(A('shell', 'ping', '-c1', '-W2', '8.8.8.8')); } catch { return false; } };
    A('shell', 'svc', 'wifi', 'disable'); A('shell', 'svc', 'data', 'disable');
    await waitFor(() => !ping(), 20000, 'the emulator network to drop');
    await sleep(2000);
    forceStop(); await sleep(1000); launch();
    await waitFor(() => hasNode('Ask Chief anything'), 90000, 'the chat back while offline');
    await waitFor(() => hasNode('No connection'), 60000, 'the offline banner');
    say('offline banner shown'); shot('10-offline.png');
    // A send-side action is inert offline: tapping the retry control writes nothing new.
    const beforeTap = chat().split('\n').filter(Boolean).length;
    try { tapText('Try again'); } catch { try { tapText('Retry'); } catch { /* none on screen */ } }
    await sleep(2500);
    const afterTap = chat().split('\n').filter(Boolean).length;
    say(`offline retry control inert (chat lines ${beforeTap} -> ${afterTap})`);
    if (afterTap > beforeTap) throw new Error('a retry ran while offline');
    tapText('Ask Chief anything'); await sleep(500); await type('This one waits for the network.'); await sleep(500); tapText('Send');
    await waitFor(() => hasNode('Queued, not sent yet'), 25000, 'the queued state');
    say('offline message shown as Queued, not sent yet; it does not look sent'); shot('11-offline-queued.png');
    const beforeChiefs = chiefCount(chat());
    A('shell', 'svc', 'wifi', 'enable'); A('shell', 'svc', 'data', 'enable');
    await waitFor(() => ping(), 20000, 'the emulator network to return');
    // No relaunch: the open chat hears the connection come back by itself (it re-checks while offline).
    // It went once: the on-disk log gains exactly the one Chief answer for the queued turn.
    await waitFor(() => chiefCount(chat()) > beforeChiefs, 90000, 'the queued turn answered');
    await waitFor(() => !hasNode('No connection') && !hasNode('Queued, not sent yet'), 30000, 'the banner and queued mark gone');
    await settle();
    say(`queued message went once back online (chiefs ${beforeChiefs} -> ${chiefCount(chat())})`); shot('12-queued-sent.png');
  }

  // --- 50+ turns: load and scroll (seeded straight into the app's own files, emulator root) ---
  if (SEED) {
    try { A('root'); } catch { /* already root */ }
    await sleep(1500);
    const lines = [];
    for (let i = 0; i < SEED; i++) { lines.push(JSON.stringify({ t: 'you', text: `Turn ${i}: what is ${i} plus ${i}?`, rid: `seed-${i}` })); lines.push(JSON.stringify({ t: 'chief', text: `Turn ${i}: that is ${i + i}.` })); }
    forceStop();
    writeDevice('phone-chat.jsonl', lines.join('\n') + '\n');
    const s0 = Date.now(); launch();
    await waitFor(() => hasNode('Ask Chief anything'), 30000, 'the reloaded composer');
    await waitFor(() => speakers('Chief') >= 1, 8000, 'lines on screen');
    say(`${SEED} turns reloaded in ${Date.now() - s0} ms`); shot('13-many-turns.png');
    for (let i = 0; i < 25 && !hasNode('^Turn 0: '); i++) { A('shell', 'input', 'swipe', '540', '500', '540', '1900', '120'); await sleep(400); } // finger down: back to the first turns
    await waitFor(() => hasNode('^Turn 0: '), 8000, 'the first turn');
    say('scrolled to the top of the long chat'); shot('14-many-turns-top.png');
    A('shell', 'settings', 'put', 'system', 'font_scale', '1.3'); A('shell', 'wm', 'density', '480');
    await sleep(1500); await waitFor(() => hasNode('Ask Chief anything') && hasNode('^Turn 51: '), 30000, 'the chat at 1.3x'); // the density change restarts the activity
    shot('15-narrow-1.3x.png');
    A('shell', 'settings', 'put', 'system', 'font_scale', '1.0'); A('shell', 'wm', 'density', 'reset'); await sleep(800);
  }

  // --- sign out removes the key AND the kept chat; "Use a computer" keeps both ---
  {
    const keptFiles = () => files().filter((f) => /^phone-|^chief-/.test(f)).length;
    // "Use a computer" leaves phone-only (and its mode flag) without clearing the key or the chat. Coming back
    // with "Use this phone only" goes straight to the kept chat — no key screen — so the key is still there.
    const beforeUse = keptFiles();
    tapText('^Use a computer$');
    await waitFor(() => hasNode('Use this phone only'), 10000, 'the chooser after Use a computer');
    const afterUse = keptFiles();
    say(`Use a computer kept the chat files: ${beforeUse} -> ${afterUse}`);
    tapText('^Use this phone only$');
    await waitFor(() => hasNode('Ask Chief anything'), 20000, 'the kept chat back (key still saved)');
    say(`back in the kept chat with no new sign-in; files ${keptFiles()}`); shot('16-use-a-computer-keeps.png');
    // The confirmed sign out: the dialog names what goes, then the key and the kept chat are removed.
    tapText('^Sign out$');
    await waitFor(() => hasNode('Sign out of Chief?'), 8000, 'the sign-out confirm');
    shot('17-signout-confirm.png');
    tapLowest('^sign out$'); await sleep(3000);
    const left = keptFiles();
    say(`chat files left after sign out: ${left}`);
    forceStop(); await sleep(1000); launch();
    await waitFor(() => hasNode('Use this phone only') || hasNode('Pair with a computer'), 30000, 'the chooser after sign out');
    say('signed out: relaunch opens the chooser, no chat'); shot('18-signed-out.png');
    if (left !== 0) throw new Error(`sign out left ${left} chat files`);
  }

  // --- erase the key and the chat from this emulator ---
  try { A('root'); } catch { /* already root */ }
  A('shell', 'rm', '-f', `${FILES}/phone-chat.jsonl`, `${FILES}/phone-requests.jsonl`, `${FILES}/phone-meta.json`);
  A('shell', 'pm', 'clear', PKG);
  A('uninstall', PKG);
  say('erased the key, the chat and the app from the emulator');
  writeFileSync(join(EV, 'phone-chat-keep.log'), log.join('\n') + '\n');
};
run().catch((e) => { console.error('FAILED:', e.message); writeFileSync(join(EV, 'phone-chat-keep.log'), log.join('\n') + `\nFAILED: ${e.message}\n`); process.exit(1); });
