// Draws Crewhouse's icons from the B1 drawings in web/src/art.ts (Studio Chief), so the icon can never drift from Chief:
// native/store and desktop exports, the maskable icon, the favicon (his head) and notification glyph (his bowler and
// handlebar in white). It also renders the phone's mascot set into mobile/assets/pals/: Chief and every helper whole
// in each pose, and their heads for faces, required from mobile/src/marks.ts. Run after changing Chief, a helper, or
// an AI account's mark (web/src/logos.ts): `node scripts/icons.mjs` (the PNGs need ImageMagick's `magick`). The
// outputs are committed.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chiefSvg, beanSvg, headSvg, INK, POSES, PALS } from '../web/src/art.ts';
import { MARKS } from '../web/src/logos.ts';

const web = new URL('../web/', import.meta.url).pathname;
const BG = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE9E3"/><stop offset=".55" stop-color="#F6F7F9"/><stop offset="1" stop-color="#DCEBFF"/></linearGradient></defs>';
/** A drawing placed in a box of the 1024 canvas. */
const at = (art, x, y, w, h = w) => art.replace('<svg ', `<svg x="${x}" y="${y}" width="${w}" height="${h}" `);
const svg = (body, bg = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${bg}${body}</svg>\n`;
const solid = `${BG}<rect width="1024" height="1024" fill="url(#g)"/>`;
const head = (size, cx = 512, cy = 512) => at(headSvg('chief', 'listen'), cx - size / 2, cy - size / 2, size);
const whole = (h, cx = 512, cy = 512) => at(chiefSvg('listen', { floor: false, vb: '28 30 144 206' }), cx - h * .35, cy - h / 2, h * .7, h);
/** Alpha-only: his bowler, eyes and handlebar in white, which is all a status bar shows. */
const GLYPH = `<svg viewBox="40 24 120 130" xmlns="http://www.w3.org/2000/svg" fill="#fff"><path d="M68 77C68 51 82 37 100 37C118 37 132 51 132 77Z"/><path d="M50 78Q100 94 150 78" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round"/><circle cx="86" cy="112" r="8"/><circle cx="114" cy="112" r="8"/><path d="M100 129C94 125 86 126 80 130C76 133 72 132 71 127C69 134 74 141 81 140C88 139 95 137 100 135C105 137 112 139 119 140C126 141 131 134 129 127C128 132 124 133 120 130C114 126 106 125 100 129Z" stroke="#fff" stroke-width="4"/></svg>`;
const mobile = '../mobile/assets/';
const out = {
  // The app icon: Chief whole on the B1 paper gradient. Rounded for browsers; launchers mask the PNGs themselves.
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
// The phone's mascots: Chief and each helper whole in every pose (the office), and their heads (faces and avatars),
// at 3x for the densest screens. The phone draws these with <Image>.
const pals = new URL('../mobile/assets/pals/', import.meta.url).pathname;
rmSync(pals, { recursive: true, force: true });
mkdirSync(pals, { recursive: true });
const sprite = (name, art, w, h) => {
  writeFileSync(`${pals}${name}.svg`, art);
  execFileSync('magick', ['-background', 'none', '-density', '300', `${pals}${name}.svg`, '-resize', `${w}x${h}`, '-depth', '8', '-strip', `PNG32:${pals}${name}.png`]);
  rmSync(`${pals}${name}.svg`);
};
for (const p of POSES) {
  sprite(`chief-${p}`, chiefSvg(p), 180, 225);
  sprite(`head-chief-${p}`, headSvg('chief', p), 168, 168);
  for (const kind of Object.keys(PALS)) { sprite(`${kind}-${p}`, beanSvg(kind, p), 144, 180); sprite(`head-${kind}-${p}`, headSvg(kind, p), 168, 168); }
}
sprite('chief-wave', chiefSvg('needs', { wave: true }), 180, 225);   // the hero's lifted hat (ChiefHero)
console.log('sprites written into mobile/assets/pals/');
// The phone's on-screen bubble (@byokit/overlay, mobile/src/bubble.ts): Chief's head on a paper disc, one still per
// mood he can wear on Home; `ask` wears the red dot. 168 px is the bubble's 56 dp at the densest screens. The glyph is
// its notification's small icon.
const bubbles = new URL('../mobile/assets/bubble/', import.meta.url).pathname;
mkdirSync(bubbles, { recursive: true });
for (const m of ['idle', 'work', 'ask', 'happy', 'rest', 'worried', 'error']) {
  const dot = m === 'ask' ? '<circle cx="846" cy="178" r="138" fill="#F0482A" stroke="#FFFFFF" stroke-width="36"/>' : '';
  writeFileSync(`${bubbles}chief-${m}.svg`, svg(`<circle cx="512" cy="512" r="488" fill="#F3F5FA" stroke="${INK}" stroke-width="24"/>${at(headSvg('chief', m), 152, 160, 720)}${dot}`));
  execFileSync('magick', ['-background', 'none', '-density', '96', `${bubbles}chief-${m}.svg`, '-resize', '168x168', '-depth', '8', '-strip', `PNG32:${bubbles}chief-${m}.png`]);
  rmSync(`${bubbles}chief-${m}.svg`);
}
execFileSync('magick', [web + 'notify-96.png', `PNG32:${bubbles}glyph.png`]);
console.log('bubble written into mobile/assets/bubble/');
