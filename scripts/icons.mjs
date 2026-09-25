// Draws Crewhouse's icons from the mascot bitmaps in web/src/art.ts, so the icon can never drift from Chief:
// the app icon, the maskable icon, the favicon (his 12-dot cut) and the alpha-only notification glyph.
// Run after changing Chief: `node scripts/icons.mjs` (the PNGs need ImageMagick's `magick`). The outputs are committed.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chief, chiefSmall, CHIEF_PAL, NOTIFY } from '../web/src/art.ts';

const web = new URL('../web/', import.meta.url).pathname;
const BG = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd6c7"/><stop offset=".6" stop-color="#e6d6ff"/><stop offset="1" stop-color="#cfe4ff"/></linearGradient></defs>';

/** Dots of a bitmap, fitted into a box of `size` centred at (cx, cy). */
function dots(rows, pal, cx, cy, size, square = false) {
  const w = rows[0].length, h = rows.length, p = size / Math.max(w, h), x0 = cx - (w * p) / 2, y0 = cy - (h * p) / 2;
  let s = '';
  rows.forEach((r, y) => [...r].forEach((k, x) => {
    const c = pal[k];
    if (!c) return;
    s += square ? `<rect x="${(x0 + x * p).toFixed(2)}" y="${(y0 + y * p).toFixed(2)}" width="${(p + 0.02).toFixed(2)}" height="${(p + 0.02).toFixed(2)}" fill="${c}"/>`
      : `<circle cx="${(x0 + (x + 0.5) * p).toFixed(2)}" cy="${(y0 + (y + 0.5) * p).toFixed(2)}" r="${(p * 0.43).toFixed(2)}" fill="${c}"/>`;
  }));
  return s;
}
const svg = (body, bg = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${bg}${body}</svg>\n`;
const out = {
  // The app icon: Chief whole, on the Pocket Pals gradient. Rounded for browsers; launchers mask the PNGs themselves.
  'icon.svg': svg(dots(chief(), CHIEF_PAL, 512, 530, 760), `${BG}<rect width="1024" height="1024" rx="236" fill="url(#g)"/>`),
  // Maskable: full-bleed, with Chief inside the 80% safe circle.
  'icon-maskable.svg': svg(dots(chief(), CHIEF_PAL, 512, 520, 600), `${BG}<rect width="1024" height="1024" fill="url(#g)"/>`),
  // The favicon: his 12-dot cut, which is what survives at 16–48 px.
  'favicon.svg': svg(dots(chiefSmall(), CHIEF_PAL, 512, 512, 900), `${BG}<rect width="1024" height="1024" rx="236" fill="url(#g)"/>`),
  // The notification glyph: white on transparent (Android reads only the alpha), bowler, eyes and moustache.
  'notify.svg': svg(dots(NOTIFY, { x: '#ffffff' }, 512, 512, 1024, true)),
};
for (const [name, text] of Object.entries(out)) writeFileSync(web + name, text);
const png = (from, to, px) => execFileSync('magick', ['-background', 'none', '-density', '300', web + from, '-resize', `${px}x${px}`, '-depth', '8', '-strip', web + to]);
png('icon.svg', 'icon-192.png', 192);
png('icon.svg', 'icon-512.png', 512);
png('icon-maskable.svg', 'icon-maskable-512.png', 512);
png('icon-maskable.svg', 'apple-touch-icon.png', 180);
png('notify.svg', 'notify-96.png', 96);
console.log('icons written into web/');
