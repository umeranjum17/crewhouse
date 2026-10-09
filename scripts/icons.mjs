// Draws Crewhouse's icons from the helmet in web/src/art.ts, so the icon can never drift from Chief:
// native/store and desktop exports, the maskable icon, the favicon (his head) and notification glyph (his head in
// white). It also renders the phone's mascot set into mobile/assets/pals/: Chief and every helper in each helmet
// mood, required from mobile/src/marks.ts. Run after changing the helmet (`node scripts/icons.mjs`; the PNGs need
// ImageMagick's `magick`). The outputs are committed.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { helmetSvg, helmetOf, POSES, PALS } from '../web/src/art.ts';
import { MARKS } from '../web/src/logos.ts';

const web = new URL('../web/', import.meta.url).pathname;
const BG = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#131312"/><stop offset=".55" stop-color="#0c0c0b"/><stop offset="1" stop-color="#1a1a18"/></linearGradient></defs>';
/** A drawing placed in a box of the 1024 canvas. */
const at = (art, x, y, w, h = w) => art.replace('<svg ', `<svg x="${x}" y="${y}" width="${w}" height="${h}" `);
const svg = (body, bg = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${bg}${body}</svg>\n`;
const solid = `${BG}<rect width="1024" height="1024" fill="url(#g)"/>`;
// The helmet, light on the dark canvas: whole for the icon, a tighter crop for the favicon.
const whole = (h, cx = 512, cy = 512) => at(helmetSvg(30, 'here', { night: true, cw: 6, ch: 15 }), cx - h * .4, cy - h / 2, h * .8, h);
const head = (size, cx = 512, cy = 512) => at(helmetSvg(24, 'here', { night: true, cw: 8, ch: 16 }), cx - size / 2, cy - size / 2, size);
/** Alpha-only: his head in white, which is all a status bar shows. */
const GLYPH = helmetSvg(30, 'here', { night: true, ink: '#fff', eye: '#fff', scan: '#fff', cw: 6, ch: 15 });
const mobile = '../mobile/assets/';
const out = {
  // The app icon: the helmet whole on the dark canvas. Rounded for browsers; launchers mask the PNGs themselves.
  'icon.svg': svg(whole(760, 512, 520), `${BG}<rect width="1024" height="1024" rx="236" fill="url(#g)"/>`),
  // Maskable: full-bleed, with Chief inside the 80% safe circle.
  'icon-maskable.svg': svg(whole(560, 512, 512), solid),
  // The favicon: his head, which is what survives at 16–48 px.
  'favicon.svg': svg(head(900), `${BG}<rect width="1024" height="1024" rx="236" fill="url(#g)"/>`),
  // Native platforms supply their own mask; no rounded corners or alpha in the iOS/store master.
  [mobile + 'icon.svg']: svg(whole(760, 512, 520), solid),
  // Android's 108 dp canvas has a 66 dp safe circle. These layers keep all of Chief inside it.
  [mobile + 'android-icon-foreground.svg']: svg(whole(540)),
  [mobile + 'android-icon-background.svg']: svg('', solid),
  [mobile + 'android-icon-monochrome.svg']: svg(at(GLYPH, 212, 212, 600)),
  // The notification glyph: white on transparent (Android reads only the alpha).
  'notify.svg': svg(at(GLYPH, 112, 112, 800)),
};
for (const [name, text] of Object.entries(out)) writeFileSync(web + name, text);
const png = (from, to, px, opaque = false) => execFileSync('magick', ['-background', 'none', '-density', '300', web + from, '-resize', `${px}x${px}`, '-depth', '8', '-strip', `${opaque ? 'PNG24' : 'PNG32'}:${web + to}`]);
png('icon.svg', 'icon-192.png', 192);
png('icon.svg', 'icon-512.png', 512);
png('icon-maskable.svg', 'icon-maskable-512.png', 512, true);
png('icon-maskable.svg', 'icon-maskable-192.png', 192, true);
png('icon-maskable.svg', 'apple-touch-icon.png', 180, true);
png('notify.svg', 'notify-96.png', 96);
for (const px of [16, 32, 48]) png('favicon.svg', `favicon-${px}.png`, px);
execFileSync('magick', [[16, 32, 48].map(px => web + `favicon-${px}.png`), web + 'favicon.ico'].flat());
png(mobile + 'icon.svg', mobile + 'icon.png', 1024, true);
for (const layer of ['foreground', 'background', 'monochrome']) png(mobile + `android-icon-${layer}.svg`, mobile + `android-icon-${layer}.png`, 1024, layer === 'background');
png('notify.svg', mobile + 'notification-icon.png', 96);
// iOS launch screens (apple-touch-startup-image): the icon on the app's own day or night page, one per device size in
// CSS px @ density, so a home-screen launch never flashes white. scripts/build-web.mjs links each one by its name.
rmSync(web + 'splash', { recursive: true, force: true });
mkdirSync(web + 'splash');
for (const [w, h, d] of [[440, 956, 3], [430, 932, 3], [428, 926, 3], [402, 874, 3], [393, 852, 3], [390, 844, 3], [375, 812, 3], [414, 896, 2], [375, 667, 2], [1024, 1366, 2], [834, 1194, 2], [820, 1180, 2], [810, 1080, 2]])
  for (const [look, bg] of [['day', '#F3EEE3'], ['night', '#0C0C0B']])
    execFileSync('magick', ['-size', `${w * d}x${h * d}`, `xc:${bg}`, '(', '-background', 'none', '-density', '300', web + 'icon.svg', '-resize', `${120 * d}x${120 * d}`, ')', '-gravity', 'center', '-composite', '-depth', '8', '-strip', `PNG8:${web}splash/${w}x${h}@${d}-${look}.png`]);
const desktop = new URL('../packaging/icons/', import.meta.url).pathname;
mkdirSync(desktop, { recursive: true });
for (const px of [16, 24, 32, 48, 64, 128, 256, 512]) png(px <= 64 ? 'favicon.svg' : 'icon.svg', `../packaging/icons/crewhouse-${px}.png`, px);
const store = new URL('../mobile/store/', import.meta.url).pathname;
mkdirSync(store, { recursive: true });
png(mobile + 'icon.svg', '../mobile/store/google-play-icon.png', 512, true);
png(mobile + 'icon.svg', '../mobile/store/app-store-icon.png', 1024, true);
// The AI account marks for the phone, which draws no SVG: white on transparent, laid on each account's tile.
const ai = new URL('../mobile/assets/ai/', import.meta.url).pathname;
mkdirSync(ai, { recursive: true });
for (const [key, d] of Object.entries(MARKS)) {
  writeFileSync(`${ai}${key}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${d}" fill="#fff"/></svg>\n`);
  execFileSync('magick', ['-background', 'none', '-density', '1200', `${ai}${key}.svg`, '-resize', '96x96', '-depth', '8', '-strip', `PNG32:${ai}${key}.png`]);
  rmSync(`${ai}${key}.svg`);
}
console.log('icons written into web/, mobile/assets/, mobile/store/ and packaging/icons/');
// The phone's mascots: the helmet whole and as a head in every mood (the office reads the same files until lane 4
// replaces the room), at 3x for the densest screens. The phone draws these with <Image>.
const pals = new URL('../mobile/assets/pals/', import.meta.url).pathname;
rmSync(pals, { recursive: true, force: true });
mkdirSync(pals, { recursive: true });
const sprite = (name, art, w, h) => {
  writeFileSync(`${pals}${name}.svg`, art);
  execFileSync('magick', ['-background', 'none', '-density', '300', `${pals}${name}.svg`, '-resize', `${w}x${h}`, '-depth', '8', '-strip', `PNG32:${pals}${name}.png`]);
  rmSync(`${pals}${name}.svg`);
};
const inkDay = { night: false, ink: '#1d1b18', eye: undefined, scan: '#3d6fd6', cw: 6, ch: 15 };
const headDay = { night: false, ink: '#1d1b18', eye: undefined, scan: '#3d6fd6', cw: 7, ch: 14 };
for (const p of POSES) {
  const mode = helmetOf(p);
  const dim = p === 'rest' ? { ink: '#6b665d' } : {};
  sprite(`chief-${p}`, helmetSvg(30, mode, { ...inkDay, ...dim }), 180, 225);
  sprite(`head-chief-${p}`, helmetSvg(24, mode, { ...headDay, ...dim }), 168, 168);
  for (const kind of Object.keys(PALS)) { sprite(`${kind}-${p}`, helmetSvg(30, mode, { ...inkDay, ...dim }), 144, 180); sprite(`head-${kind}-${p}`, helmetSvg(24, mode, { ...headDay, ...dim }), 168, 168); }
}
sprite('chief-wave', helmetSvg(30, 'needs', inkDay), 180, 225);   // the hero's ask (ChiefHero)
console.log('sprites written into mobile/assets/pals/');
// The phone's on-screen bubble (@byokit/overlay, mobile/src/bubble.ts): the helmet on a dark disc, one still per
// mood he can wear on Home; `ask` wears the blue dot. 168 px is the bubble's 56 dp at the densest screens. The glyph is
// its notification's small icon.
const bubbles = new URL('../mobile/assets/bubble/', import.meta.url).pathname;
mkdirSync(bubbles, { recursive: true });
for (const m of ['idle', 'work', 'ask', 'happy', 'rest', 'worried', 'error']) {
  const dot = m === 'ask' ? '<circle cx="846" cy="178" r="138" fill="#0A84FF" stroke="#FFFFFF" stroke-width="36"/>' : '';
  writeFileSync(`${bubbles}chief-${m}.svg`, svg(`<circle cx="512" cy="512" r="488" fill="#0C0C0B" stroke="#ECECEC" stroke-width="24"/>${at(helmetSvg(24, helmetOf(m), { night: true, cw: 8, ch: 16 }), 152, 160, 720)}${dot}`));
  execFileSync('magick', ['-background', 'none', '-density', '96', `${bubbles}chief-${m}.svg`, '-resize', '168x168', '-depth', '8', '-strip', `PNG32:${bubbles}chief-${m}.png`]);
  rmSync(`${bubbles}chief-${m}.svg`);
}
execFileSync('magick', [web + 'notify-96.png', `PNG32:${bubbles}glyph.png`]);
console.log('bubble written into mobile/assets/bubble/');
