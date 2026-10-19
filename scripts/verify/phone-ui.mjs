// The phone, driven by what is on screen: tap a node by its text or label, list the texts, take a still.
//   SERIAL=emulator-5800 node phone-ui.mjs texts | tap "<text regex>" [nth] | reveal "<text regex>" | shot <file>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const A = (...a) => execFileSync('adb', ['-s', process.env.SERIAL || 'emulator-5562', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const dump = () => { A('shell', 'uiautomator', 'dump', '--windows', '/sdcard/ui.xml'); return A('shell', 'cat', '/sdcard/ui.xml'); };
// A value holding a double quote is written in single quotes.
const attr = (n, name) => { const m = n.match(new RegExp(` ${name}=(?:"([^"]*)"|'([^']*)')`)); return m ? m[1] ?? m[2] : ''; };
const nodes = () => [...dump().matchAll(/<node [^>]*>/g)].map(([n]) => ({
  text: attr(n, 'text'), desc: attr(n, 'content-desc'),
  pkg: (n.match(/package="([^"]*)"/) || [])[1], focused: /focused="true"/.test(n), scrollable: /scrollable="true"/.test(n),
  b: (n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []).slice(1).map(Number) }));
const [cmd, arg, nth] = process.argv.slice(2);
if (cmd === 'texts') for (const n of nodes()) { if (n.text || n.desc) console.log(`${n.pkg} ${n.focused ? '*' : ''}[${n.b}] ${n.text}${n.desc ? ' {' + n.desc + '}' : ''}`); }
if (cmd === 'tap' || cmd === 'tap-if') { const re = new RegExp(arg); const m = nodes().filter((n) => re.test(n.text) || re.test(n.desc)); const n = m[Number(nth || 0)];
  if (!n) { if (cmd === 'tap-if') { console.log('already beyond', arg); process.exit(0); } console.error('no match', arg); process.exit(1); } const [x1, y1, x2, y2] = n.b; A('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1)); console.log('tapped', n.text || n.desc); }
if (cmd === 'reveal') {
  const [w, h] = [...A('shell', 'wm', 'size').matchAll(/(\d+)x(\d+)/g)].at(-1).slice(1).map(Number), re = new RegExp(arg);
  // ponytail: eight forward swipes; raise the bound for longer office lists.
  for (let i = 0; ; i++) {
    const all = nodes(), n = all.find((n) => re.test(n.text) || re.test(n.desc));
    if (n && n.b[1] < h * .25 && n.b[3] > h * .05) { console.log('revealed', n.text || n.desc); break; }
    if (i === 8) throw new Error(`could not reveal ${arg}`);
    const area = all.filter((n) => n.scrollable).sort((a, b) => (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]) - (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]))[0]?.b ?? [0, 0, w, h];
    const start = area[1] + (area[3] - area[1]) * .8, distance = Math.min((area[3] - area[1]) * .6, n ? Math.max(h * .2, n.b[1] - h * .2) : h * .5), x = (area[0] + area[2]) / 2;
    A('shell', 'input', 'swipe', String(x | 0), String(start | 0), String(x | 0), String(start - distance | 0), '300');
  }
}
if (cmd === 'shot') writeFileSync(arg, execFileSync('adb', ['-s', process.env.SERIAL || 'emulator-5562', 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 27 }));
if (cmd === 'xml') writeFileSync(arg, dump());
