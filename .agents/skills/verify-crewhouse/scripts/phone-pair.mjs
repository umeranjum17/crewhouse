#!/usr/bin/env node
// Phone pairing, proven end to end on the real app: the phone's camera reads the code the computer is
// showing, the person confirms on the computer, and the phone lands on "You're in". Writes a screenshots
// and timings folder and prints one timings line per run.
//
//   node scripts/phone-pair.mjs --out "$EV/phone" [--serial emulator-5562] [--base http://127.0.0.1:$PORT]
//                                [--apk path.apk] [--camera-file <png>] [--runs 3] [--record] [--qr-file <txt>]
//
// Task-owned prerequisites, none of the owner's:
//   - crewd on the stub engine, started as the SKILL says, with CREWHOUSE_LINK_PORT on a free port so two
//     lanes never share a link port.
//   - an emulator whose camera is fed the code:
//       emulator -avd <name> -no-window -gpu swiftshader_indirect -camera-back imagefile:<abs path>
//     The imagefile camera renders that file stretched into its 1280x960 frame (measured on a 1080x2400
//     preview: screen_x = 1.575*src_x - 94, screen_y = 3.325*src_y + 2, visible source window x 0..745,
//     y 0..719), so the code is drawn pre-squashed at module 8x4 inside that window. Each run rewrites the
//     same file before the phone opens the camera, which is when the camera reads it.
//   - the app installed, camera permission granted (`adb shell pm grant dev.crewhouse.app
//     android.permission.CAMERA`), or the tap lands on the permission sheet instead of the camera.
//
// What it drives: POST /api/phones/pair (what the web card's "Add a phone" makes), the phone's own Pair
// screen (tap "Scan the code"), and POST /api/phones/answer — the request the card's "Yes, the words
// match" button makes, so the computer's side is the real one. Nothing writes to crewd's database.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const flag = (name) => args.includes(`--${name}`);
const OUT = opt('out', null);
if (!OUT) { console.error('usage: phone-pair.mjs --out <dir> [--serial emulator-5562] [--base http://127.0.0.1:7801] [--apk apk] [--camera-file png] [--runs 3] [--record] [--qr-file <txt>]'); process.exit(2); }
const STATE = opt('state', process.env.CREWHOUSE_STATE_DIR);
if (!STATE) throw new Error('Pass --state for the task-owned crewd state directory');
const SERIAL = opt('serial', 'emulator-5562');
const BASE = opt('base', 'http://127.0.0.1:7801');
const APK = opt('apk', null);
const RUNS = Number(opt('runs', 1));
const CAMERA_FILE = opt('camera-file', '/home/umer/lab-tmp/ch-pm-19/ev/live-qr.png');
const TAP_SCAN = opt('tap-scan', '540 1598').split(' ');  // "Scan the code" at 1080x2400
const TAP_OPEN = opt('tap-open', '540 1626').split(' ');  // "Open Crewhouse" at 1080x2400
const PKG = 'dev.crewhouse.app';
// --qr-file: the exact code already showing on the computer's pairing card (read out of that card's own pixels), so
// the recording shows the phone reading the screen the person is looking at instead of a second, hidden code.
const QR_FILE = opt('qr-file', null);
mkdirSync(OUT, { recursive: true });

const require = createRequire(process.env.CREWHOUSE_REPO ? join(process.env.CREWHOUSE_REPO, 'package.json') : join(process.cwd(), 'package.json'));
const { qrMatrix } = require('@byokit/ui-core');
const adb = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${readFileSync(join(STATE, 'person.key'), 'utf8')}` }, body: JSON.stringify(body) } : undefined);
  const out = await r.json(); if (!r.ok) throw new Error(out.error || `HTTP ${r.status}`); return out;
};
const shot = async (name) => { await new Promise((res, rej) => { const s = spawn('adb', ['-s', SERIAL, 'exec-out', 'screencap', '-p']); const out = []; s.stdout.on('data', (d) => out.push(d)); s.on('close', () => { writeFileSync(join(OUT, name), Buffer.concat(out)); res(); }); s.on('error', rej); }); return name; };
/** The computer's code, drawn the way the emulator camera sees it: pre-squashed modules in its visible window. */
function drawPoster(qr, out) {
  const m = qrMatrix(qr, { border: 4 });
  const W = 1280, H = 960, sx = 8, sy = 4, ox = 40, oy = 60;
  const buf = Buffer.alloc(W * H, 0xff);
  m.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < sy; dy++) buf.fill(0, (oy + y * sy + dy) * W + ox + x * sx, (oy + y * sy + dy) * W + ox + x * sx + sx);
  }));
  const pgm = join(OUT, 'camera-frame.pgm');
  writeFileSync(pgm, Buffer.concat([Buffer.from(`P5\n${W} ${H}\n255\n`), buf]));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', pgm, out]);
}

const log = [];
for (let run = 1; run <= RUNS; run++) {
  const offer = QR_FILE ? { qr: readFileSync(QR_FILE, 'utf8').trim() } : await api('/api/phones/pair', { role: 'control' });
  drawPoster(offer.qr, CAMERA_FILE);
  writeFileSync(join(OUT, `offer-${run}.json`), JSON.stringify(offer, null, 2));
  if (APK) { try { adb('uninstall', PKG); } catch { /* not installed */ } adb('install', '-g', APK); }
  adb('shell', 'pm', 'clear', PKG);
  adb('shell', 'pm', 'grant', PKG, 'android.permission.CAMERA'); // pm clear takes the permission with it
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  await sleep(8000);
  await shot(`run${run}-1-pair.png`);
  // screenrecord writes on the device, so record there and pull the file back when the run is over.
  const deviceRec = `/sdcard/${PKG}-pairing.mp4`;
  const recorder = flag('record') ? spawn('adb', ['-s', SERIAL, 'shell', 'screenrecord', '--time-limit', '60', deviceRec]) : null;
  const t0 = Date.now();
  adb('shell', 'input', 'tap', ...TAP_SCAN);
  let asking = [];
  for (let waited = 0; waited < 15000 && !asking.length; waited += 200) { asking = await api('/api/phones/pending'); if (!asking.length) await sleep(200); }
  const tRead = Date.now();
  await shot(`run${run}-2-words.png`);
  if (!asking.length) throw new Error(`run ${run}: the camera never read the code`);
  await api('/api/phones/answer', { id: asking[0].id, yes: true });  // the card's "Yes, the words match"
  // The phone lands on "You're in" once it has the grant; the computer's device list says the same thing.
  let paired = false;
  for (let waited = 0; waited < 20000 && !paired; waited += 250) {
    await sleep(250);
    paired = (await api('/api/phones')).some((p) => p.name === asking[0].name);
  }
  const tPaired = Date.now();
  await shot(`run${run}-3-yourein.png`);
  adb('shell', 'input', 'tap', ...TAP_OPEN);
  await sleep(3000);
  await shot(`run${run}-4-open.png`);
  if (recorder) { // SIGINT makes screenrecord finalise the file; then pull it off the device
    recorder.kill('SIGINT');
    await sleep(2500);
    try { adb('pull', deviceRec, join(OUT, `run${run}-pairing.mp4`)); adb('shell', 'rm', deviceRec); } catch { /* nothing recorded */ }
  }
  const row = { run, words: asking[0].words, secondsToReadCode: (tRead - t0) / 1000, secondsToPaired: (tPaired - t0) / 1000, paired };
  log.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(join(OUT, 'timings.json'), JSON.stringify(log, null, 2));
if (log.some((r) => !r.paired)) process.exit(1);