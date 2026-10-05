// The phone, driven by what is on screen: tap a node by its text or label, list the texts, take a still.
//   SERIAL=emulator-5800 node phone-ui.mjs texts | tap "<text regex>" [nth] | shot <file>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const A = (...a) => execFileSync('adb', ['-s', process.env.SERIAL || 'emulator-5562', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const dump = () => { A('shell', 'uiautomator', 'dump', '--windows', '/sdcard/ui.xml'); return A('shell', 'cat', '/sdcard/ui.xml'); };
const nodes = () => [...dump().matchAll(/<node [^>]*>/g)].map(([n]) => ({
  text: (n.match(/ text="([^"]*)"/) || [])[1] || '', desc: (n.match(/content-desc="([^"]*)"/) || [])[1] || '',
  pkg: (n.match(/package="([^"]*)"/) || [])[1], focused: /focused="true"/.test(n),
  b: (n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []).slice(1).map(Number) }));
const [cmd, arg, nth] = process.argv.slice(2);
if (cmd === 'texts') for (const n of nodes()) { if (n.text || n.desc) console.log(`${n.pkg} ${n.focused ? '*' : ''}[${n.b}] ${n.text}${n.desc ? ' {' + n.desc + '}' : ''}`); }
if (cmd === 'tap') { const re = new RegExp(arg); const m = nodes().filter((n) => re.test(n.text) || re.test(n.desc)); const n = m[Number(nth || 0)];
  if (!n) { console.error('no match', arg); process.exit(1); } const [x1, y1, x2, y2] = n.b; A('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1)); console.log('tapped', n.text || n.desc); }
if (cmd === 'shot') writeFileSync(arg, execFileSync('adb', ['-s', process.env.SERIAL || 'emulator-5562', 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 27 }));
if (cmd === 'xml') writeFileSync(arg, dump());
