#!/usr/bin/env node
// Proves Chief's box with the keyboard up on a task-owned emulator, the app already paired to a lab (phone-pair-typed.mjs):
// at each width, by day and by night, a PDF attached and words typed, the whole box and its send sit above the keyboard,
// the file's chip sits whole above the box, and the Home | Chief | Crew bar has stepped aside. Read from the screen's own
// layout (uiautomator), with a still of each.
//
//   node scripts/verify/phone-keyboard.mjs --serial <emulator> --out <dir> [--widths 360,390,445]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const SERIAL = opt('serial', null), OUT = opt('out', null), WIDTHS = opt('widths', '360,390,445').split(',').map(Number);
if (!SERIAL || !OUT) { console.error('usage: phone-keyboard.mjs --serial <emulator> --out <dir> [--widths 360,390,445]'); process.exit(2); }
const PKG = 'dev.crewhouse.app', FILE = 'Umer_Resume.pdf';
const A = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const attr = (n, name) => { const m = n.match(new RegExp(` ${name}=(?:"([^"]*)"|'([^']*)')`)); return m ? m[1] ?? m[2] : ''; };
const nodes = () => {
  A('shell', 'uiautomator', 'dump', '--windows', '/sdcard/ui.xml');
  return [...A('shell', 'cat', '/sdcard/ui.xml').matchAll(/<node [^>]*>/g)].map(([n]) => ({ text: attr(n, 'text'), desc: attr(n, 'content-desc'), pkg: attr(n, 'package'),
    b: (n.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/) || []).slice(1).map(Number) }));
};
const find = (re, all = nodes()) => all.find((x) => re.test(x.text) || re.test(x.desc));
const tap = (n) => A('shell', 'input', 'tap', String((n.b[0] + n.b[2]) >> 1), String((n.b[1] + n.b[3]) >> 1));
const waitFor = async (re, ms = 20000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(600)) { const n = find(re); if (n) return n; } throw new Error(`timed out waiting for ${re}`); };
const imeUp = () => /mInputShown=true/.test(A('shell', 'dumpsys', 'input_method'));

// A small PDF in Downloads, where the system picker opens.
const pdf = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
writeFileSync(join(OUT, FILE), pdf);
A('push', join(OUT, FILE), `/sdcard/Download/${FILE}`);
A('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file:///sdcard/Download/${FILE}`);
const px = Number(A('shell', 'wm', 'size').match(/(\d+)x\d+\s*$/m)[1]);
const results = [];
try {
  for (const width of WIDTHS) for (const night of [false, true]) {
    const name = `${width}-${night ? 'night' : 'day'}`;
    A('shell', 'wm', 'density', String(Math.round((px / width) * 160)));
    A('shell', 'cmd', 'uimode', 'night', night ? 'yes' : 'no');
    A('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
    await sleep(1500); // the screen redraws at its new size
    tap(await waitFor(/^Chief$/, 60000)); // the bar's Chief
    for (let x; (x = find(new RegExp(`^Remove ${FILE}$`)));) { tap(x); await sleep(600); } // one file per case
    tap(await waitFor(/^Add a photo or a document$/));
    tap(await waitFor(/^A document: PDF, Word, Excel or text$/));
    // The system picker: the file in Recent or Downloads.
    let file = await waitFor(new RegExp(`^${FILE}$|^Downloads$|^Show roots$`));
    if (file.text !== FILE) { if (file.desc === 'Show roots') { tap(file); file = await waitFor(/^Downloads$/); } tap(file); file = await waitFor(new RegExp(`^${FILE}$`)); }
    tap(file);
    for (const end = Date.now() + 20000; !nodes().some((n) => n.pkg === PKG && n.text === FILE); await sleep(600)) if (Date.now() > end) throw new Error('the file chip never showed'); // back in the app
    tap(await waitFor(/^Tell Chief anything/));
    for (const end = Date.now() + 10000; !imeUp() && Date.now() < end;) await sleep(400); // keys sent before it is up get lost
    A('shell', 'input', 'keyevent', '123', ...Array(40).fill('67')); // a kept draft goes first: end, then deletes (a ctrl+a's Ctrl can stick to the next key)
    A('shell', 'input', 'text', 'This%sis%smy%sresume');
    await sleep(800); // the keyboard's slide-in settles
    const all = nodes(), app = all.filter((n) => n.pkg === PKG), ime = all.filter((n) => /inputmethod/.test(n.pkg));
    // Where the keyboard starts: its window's frame top plus the content inset it gives the app.
    const win = A('shell', 'dumpsys', 'window', 'InputMethod');
    const top = Number(win.match(/ frame=\[\d+,(\d+)\]/)[1]) + Number(win.match(/mGivenContentInsets=\[\d+,(\d+)\]/)[1]);
    const send = find(/^Send$/, app), field = app.find((n) => /This is my resume/.test(n.text)), chip = find(new RegExp(`^${FILE}$`), app);
    const r = { name, width, night, keyboardTop: top, send: send?.b, field: field?.b, chip: chip?.b, bar: app.filter((n) => /^(Home|Crew)$/.test(n.text)).map((n) => n.b) };
    r.ok = ime.length > 0 && !!send && !!field && !!chip && send.b[3] <= top && field.b[3] <= top && chip.b[3] <= field.b[1] && chip.b[1] > 0 && r.bar.length === 0;
    writeFileSync(join(OUT, `${name}.png`), execFileSync('adb', ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 27 }));
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${name}: keyboard at ${top}, send ${send?.b}, box ${field?.b}, chip ${chip?.b}, bar ${r.bar.length ? 'shown' : 'hidden'}`);
    results.push(r);
    A('shell', 'input', 'keyevent', '111'); // keyboard down
  }
} finally {
  A('shell', 'wm', 'density', 'reset'); A('shell', 'cmd', 'uimode', 'night', 'no');
  writeFileSync(join(OUT, 'keyboard.json'), JSON.stringify(results, null, 2));
}
process.exit(results.length === WIDTHS.length * 2 && results.every((r) => r.ok) ? 0 : 1);
