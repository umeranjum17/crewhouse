// Draws Crewhouse's icons from Chief's Geo face in web/src/art.ts: native/store and desktop exports, the maskable icon,
// the favicon and the Android themed layer; the notification glyph is still the helmet's head in white. It also renders the phone's faces into
// mobile/assets/pals/ from the Geo faces: Chief and every look in each face mode, required from mobile/src/faces.ts
// (written here too). Run after changing either (`node scripts/icons.mjs`; the PNGs need ImageMagick's `magick`).
// The outputs are committed.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { critter, helmetSvg, faceOf, FACE_MODES, PALS } from '../web/src/art.ts';
import { ICONS } from '../web/src/icons.ts';
import { MARKS } from '../web/src/logos.ts';

const web = new URL('../web/', import.meta.url).pathname;
const BG = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#131312"/><stop offset=".55" stop-color="#0c0c0b"/><stop offset="1" stop-color="#1a1a18"/></linearGradient></defs>';
/** A drawing placed in a box of the 1024 canvas. */
const at = (art, x, y, w, h = w) => art.replace('<svg ', `<svg x="${x}" y="${y}" width="${w}" height="${h}" `);
const svg = (body, bg = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${bg}${body}</svg>\n`;
const solid = `${BG}<rect width="1024" height="1024" fill="url(#g)"/>`;
// Chief's Geo face without its black disc, on the dark canvas. Cap to chin it is centred at (50, 54.5) of its 100 box and
// reaches 33.3 from there, so a box of `b` px needs a safe circle of .333b px.
const CHIEF = critter('chief').replace(/<circle cx="50" cy="50" r="50"[^>]*\/>/, '');
const chief = (b, art = CHIEF) => at(art, 512 - b * .5, 512 - b * .545, b);
/** The themed (monochrome) layer: the face in white with its eyes, smile and cap band cut out. Android reads the alpha. */
const MONO = CHIEF.replace(/#0B0B0B/g, '#000').replace(/#[0-9A-F]{6}/gi, '#fff')
  .replace(/(<svg[^>]*>)([\s\S]*)<\/svg>/, '$1<mask id="m">$2</mask><rect width="100" height="100" fill="#fff" mask="url(#m)"/></svg>');
/** Alpha-only: his head in white, which is all a status bar shows. */
const GLYPH = helmetSvg(30, 'here', { night: true, ink: '#fff', eye: '#fff', scan: '#fff', cw: 6, ch: 15 });
const mobile = '../mobile/assets/';
const out = {
  // The app icon: Chief on the dark canvas. Rounded for browsers; launchers mask the PNGs themselves.
  'icon.svg': svg(chief(1150), `${BG}<rect width="1024" height="1024" rx="236" fill="url(#g)"/>`),
  // Maskable: full-bleed, with Chief inside the 80% safe circle.
  'icon-maskable.svg': svg(chief(1100), solid),
  // The favicon: Chief filling the tile, which is what survives at 16–48 px.
  'favicon.svg': svg(chief(1450), `${BG}<rect width="1024" height="1024" rx="236" fill="url(#g)"/>`),
  // Native platforms supply their own mask; no rounded corners or alpha in the iOS/store master.
  [mobile + 'icon.svg']: svg(chief(1150), solid),
  // Android's 108 dp canvas has a 66 dp safe circle (625 px). These layers keep all of Chief inside it.
  [mobile + 'android-icon-foreground.svg']: svg(chief(860)),
  [mobile + 'android-icon-background.svg']: svg('', solid),
  [mobile + 'android-icon-monochrome.svg']: svg(chief(860, MONO)),
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
  for (const [look, bg] of [['day', '#F4F3EF'], ['night', '#000000']])
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
// The phone's faces: Chief and every Geo face in each face mode, at 3x for the densest screens (56 dp). The phone
// draws these with <Image>, and Metro needs literal requires, so this writes mobile/src/faces.ts beside them.
const pals = new URL('../mobile/assets/pals/', import.meta.url).pathname;
rmSync(pals, { recursive: true, force: true });
mkdirSync(pals, { recursive: true });
const faces = [];
for (const who of ['chief', ...Object.keys(PALS)]) for (const mode of FACE_MODES) {
  writeFileSync(`${pals}${who}-${mode}.svg`, critter(who, mode));
  execFileSync('magick', ['-background', 'none', '-density', '300', `${pals}${who}-${mode}.svg`, '-resize', '168x168', '-depth', '8', '-strip', `PNG32:${pals}${who}-${mode}.png`]);
  rmSync(`${pals}${who}-${mode}.svg`);
  faces.push(`  '${who}-${mode}': require('../assets/pals/${who}-${mode}.png'),`);
}
writeFileSync(new URL('../mobile/src/faces.ts', import.meta.url), `// Written by scripts/icons.mjs: Chief and every Geo face (web/src/art.ts) in each face mode, keyed \`\${who}-\${mode}\`.
// Metro needs literal requires.
export const FACES: Record<string, number> = {
${faces.join('\n')}
};
`);
console.log('faces written into mobile/assets/pals/ and mobile/src/faces.ts');
// The phone's on-screen bubble (@byokit/overlay, mobile/src/bubble.ts): the helmet on a dark disc, one still per
// mood he can wear on Home; `ask` wears the blue dot. 168 px is the bubble's 56 dp at the densest screens. The glyph is
// its notification's small icon.
const bubbles = new URL('../mobile/assets/bubble/', import.meta.url).pathname;
mkdirSync(bubbles, { recursive: true });
for (const m of ['idle', 'work', 'ask', 'happy', 'rest', 'worried', 'error']) {
  const dot = m === 'ask' ? '<circle cx="846" cy="178" r="138" fill="#0A84FF" stroke="#FFFFFF" stroke-width="36"/>' : '';
  writeFileSync(`${bubbles}chief-${m}.svg`, svg(`<circle cx="512" cy="512" r="488" fill="#0C0C0B" stroke="#ECECEC" stroke-width="24"/>${at(helmetSvg(24, faceOf(m), { night: true, cw: 8, ch: 16 }), 152, 160, 720)}${dot}`));
  execFileSync('magick', ['-background', 'none', '-density', '96', `${bubbles}chief-${m}.svg`, '-resize', '168x168', '-depth', '8', '-strip', `PNG32:${bubbles}chief-${m}.png`]);
  rmSync(`${bubbles}chief-${m}.svg`);
}
execFileSync('magick', [web + 'notify-96.png', `PNG32:${bubbles}glyph.png`]);
console.log('bubble written into mobile/assets/bubble/');
// The phone's first screen (mock C): the line marks white on transparent (the screen tints each one), and Chief's
// face in each look, at 3x.
const where = new URL('../mobile/assets/where/', import.meta.url).pathname;
mkdirSync(where, { recursive: true });
const draw = (name, art, w, h) => {
  writeFileSync(`${where}${name}.svg`, art);
  execFileSync('magick', ['-background', 'none', '-density', '600', `${where}${name}.svg`, '-resize', `${w}x${h}`, '-depth', '8', '-strip', `PNG32:${where}${name}.png`]);
  rmSync(`${where}${name}.svg`);
};
for (const k of ['cloud', 'computer', 'phone', 'shield']) draw(k, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`, 60, 60);
for (const look of ['day', 'night']) draw(`chief-${look}`, critter('chief', 'here', { aspect: 132 / 121 }).replace('<svg ', '<svg width="132" height="121" '), 132, 121);
// The tab bar's four places and Home's dock (places, search), in the web's stroke (parts.tsx Icon): 22 dp on screen, tinted there.
for (const k of ['home', 'talk', 'jobs', 'crew', 'apps', 'search']) draw(`tab-${k}`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`, 66, 66);
console.log('first-screen marks and tab bar icons written into mobile/assets/where/');
