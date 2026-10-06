// Shoot one page as a phone screen at store size (430x932 at 3x = 1290x2796) with the headless Chromium on this computer.
// node shoot.mjs <address or .html file> <out.png> [--map <dir>]
// --map also writes <dir>/map.json: the screen's cards (text and box, in the PNG's pixels), its drawings (each saved as
// an .svg), its fonts (each saved) and its links to other screens, so a panel can lift a real card, the app's own art and type.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [src, out, flag, dir] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node shoot.mjs <address or .html file> <out.png> [--map <dir>]'); process.exit(2); }
const url = /^https?:/.test(src) ? src : `file://${resolve(src)}`;
const W = 430, H = 932, SCALE = 3;
const chrome = spawn(process.env.CHROME ?? 'chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--remote-debugging-pipe', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shoot-'))}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
chrome.on('error', (e) => { console.error(`error: no Chromium to shoot with (${e.message}); set CHROME to its path`); process.exit(1); });
chrome.on('exit', (code) => { if (waiting.size) { console.error(`error: Chromium quit (exit ${code})`); process.exit(1); } });

let id = 0, buf = '';
const waiting = new Map();
chrome.stdio[4].on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\0')) >= 0; buf = buf.slice(i + 1)) {
    const m = JSON.parse(buf.slice(0, i));
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  }
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
  waiting.set(++id, (m) => m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result));
  chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
const evaluate = async (s, expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s)).result.value;

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: true }, s);
  await send('Page.enable', {}, s);
  await send('Page.navigate', { url }, s);
  // Ready = fonts loaded and the page's words unchanged for a second (the app fetches its data after load), at most 20 s.
  const settled = await evaluate(s, `(async () => {
    const t0 = Date.now(); let last = '', same = 0;
    while (Date.now() - t0 < 20000) {
      await new Promise((r) => setTimeout(r, 250));
      if (document.readyState !== 'complete') continue;
      await document.fonts.ready;
      const now = document.body ? document.body.innerText + document.images.length : '';
      same = now === last ? same + 1 : 0; last = now;
      if (same >= 4 && [...document.images].every((i) => i.complete)) return true;
    }
    return false; })()`);
  if (!settled) console.error('note: the page was still changing after 20 s; shot it as it was');
  const shot = await send('Page.captureScreenshot', { format: 'png' }, s);
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`${out}: ${W * SCALE}x${H * SCALE}`);
  if (flag === '--map' && dir) {
    mkdirSync(dir, { recursive: true });
    const map = await evaluate(s, `(async () => {
      const S = ${SCALE}, box = (r) => ({ x: Math.round(r.x * S), y: Math.round(r.y * S), w: Math.round(r.width * S), h: Math.round(r.height * S) });
      const seen = (r) => r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
      // On top where it is drawn: not under a pinned header or another card.
      const shown = (e, r) => e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 20)));
      // A card: a box with its own background or border and rounded corners, holding words, smaller than the screen.
      const cards = [...document.querySelectorAll('body *')].filter((e) => {
        const c = getComputedStyle(e), r = e.getBoundingClientRect();
        const framed = c.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(c.borderTopWidth) > 0 || c.boxShadow !== 'none';
        return seen(r) && shown(e, r) && framed && parseFloat(c.borderTopLeftRadius) >= 8 && r.width >= 120 && r.height >= 36 && r.height < innerHeight * 0.6 && e.innerText.trim();
      }).map((e) => ({ text: e.innerText.trim().replace(/\\s+/g, ' ').slice(0, 90), ...box(e.getBoundingClientRect()) }));
      const art = [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('data:image/svg+xml') && seen(i.getBoundingClientRect()))
        .map((i) => ({ name: i.alt || 'drawing', svg: decodeURIComponent(i.src.split(',').slice(1).join(',')), ...box(i.getBoundingClientRect()) }));
      const fonts = [];
      for (const sheet of document.styleSheets) { try { for (const r of sheet.cssRules) if (r instanceof CSSFontFaceRule) {
        const u = /url\\(["']?([^"')]+)/.exec(r.style.getPropertyValue('src'));
        if (u) fonts.push({ family: r.style.getPropertyValue('font-family').replace(/["']/g, ''), url: new URL(u[1], sheet.href || location.href).href });
      } } catch {} }
      for (const f of fonts) f.data = await fetch(f.url).then((r) => r.blob()).then((b) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(b); })).catch(() => '');
      const links = [...new Set([...document.querySelectorAll('a[href]')].filter((a) => a.href.startsWith(location.origin) && a.innerText.trim())
        .map((a) => JSON.stringify({ text: a.innerText.trim().replace(/\s+/g, ' ').slice(0, 60), href: a.href })))].map((l) => JSON.parse(l));
      return { page: location.href, cards, art, fonts, links };
    })()`);
    const names = new Set();
    const unique = (base, ext) => { let n = base.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'file', k = n; for (let i = 2; names.has(k); i++) k = `${n}-${i}`; names.add(k); return `${k}.${ext}`; };
    for (const a of map.art) { a.file = unique(a.name, 'svg'); writeFileSync(join(dir, a.file), a.svg); delete a.svg; }
    for (const f of map.fonts) { if (f.data) { f.file = unique(f.family, f.url.split('.').pop().split(/[?#]/)[0]); writeFileSync(join(dir, f.file), Buffer.from(f.data, 'base64')); } delete f.data; }
    writeFileSync(join(dir, 'map.json'), JSON.stringify(map, null, 1));
    console.log(`${join(dir, 'map.json')}: ${map.cards.length} cards, ${map.art.length} drawings, ${map.fonts.length} fonts, ${map.links.length} links`);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
