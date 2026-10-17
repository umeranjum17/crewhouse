// The mascot family as data: the critters (Chief's and every helper's face), dot bitmaps for the logo, and the ASCII brand moments
// (the block-letter boot splash, Chief's laptop, confetti). Framework-free, so the Expo app draws the same art:
// a bitmap is an array of equal-width strings, '.' is an unlit dot, any other letter indexes a palette.

export type Mood = 'idle' | 'blink' | 'twitch' | 'hello' | 'happy' | 'work' | 'ask' | 'listen' | 'rest' | 'worried' | 'error';
/** Every mood, for the sprite pipelines that must render each one (scripts/icons.mjs, mobile/assets/pals/). */
export const MOODS: Mood[] = ['idle', 'blink', 'twitch', 'hello', 'happy', 'work', 'ask', 'listen', 'rest', 'worried', 'error'];
export type Bitmap = string[];
export type Palette = Record<string, string>;

/** Stamp hand-drawn layers onto a blank w×h bitmap: [x, y, rows], where ' ' in a layer is transparent. */
function draw(w: number, h: number, ...layers: [number, number, string[]][]): Bitmap {
  const out = Array.from({ length: h }, () => Array(w).fill('.'));
  for (const [x0, y0, rows] of layers) rows.forEach((r, j) => [...r].forEach((c, i) => {
    if (c !== ' ' && out[y0 + j] && x0 + i >= 0 && x0 + i < w) out[y0 + j][x0 + i] = c;
  }));
  return out.map((r) => r.join(''));
}

// ── Every face wears one of four modes: here | needs | think | rest (rest = eyes shut). ──
export type FaceMode = 'here' | 'needs' | 'think' | 'rest';
export const FACE_MODES: FaceMode[] = ['here', 'needs', 'think', 'rest'];
/** Every app mood wears one of the four face modes (via the five poses: work thinks, pleased sits here). */
export const faceOf = (m: Mood | Pose | FaceMode = 'idle'): FaceMode => {
  if (m === 'here' || m === 'needs' || m === 'think' || m === 'rest') return m;
  const p = poseOf(m);
  return p === 'needs' ? 'needs' : p === 'work' ? 'think' : p === 'rest' ? 'rest' : 'here';
};
// ── The helmet: the old mascot in density characters with a dark visor, still drawn by the app icon, favicon,
// notification glyph and phone bubble (scripts/icons.mjs) until those get Chief's critter. ──
export const RAMP = ' .:-=+*#%@';
export type HelmetCell = { ch: string; eye?: true; scan?: true };
/** One cell's height over its width: a mono glyph at line-height 1, helmetSvg's 10×16. The head fills a 5:4 box only
 *  when every drawing keeps it. */
export const CELL = 1.6;
/** The helmet as cells: ' ' is bare canvas, eye/scan cells wear the mood colour. */
export function helmet(cols: number, mode: FaceMode = 'here', night = true, beat = 0): HelmetCell[][] {
  const rows = Math.round((cols * 0.8) / CELL);
  const scan = ((beat % 24) / 23) * 1.8 - 0.9;
  const grid: HelmetCell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: HelmetCell[] = [];
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * 2 - 1, y = ((r + 0.5) / rows) * 2 - 1;
      const d = x ** 4 + (y * 1.08) ** 4;
      if (d > 1) { row.push({ ch: ' ' }); continue; }
      const visor = Math.abs(y - 0.08) < 0.3 && Math.abs(x) < 0.76;
      if (visor) {
        const shut = mode === 'rest';
        const eye = Math.abs(Math.abs(x) - 0.34) < 0.11 && Math.abs(y - 0.08) < (shut ? 0.05 : 0.17);
        if (eye && mode !== 'think') { row.push({ ch: shut ? '-' : '@', eye: true }); continue; }
        if (mode === 'think' && Math.abs(x - scan) < 0.07) { row.push({ ch: '|', scan: true }); continue; }
        row.push({ ch: ' ' });
        continue;
      }
      const z = Math.sqrt(Math.max(0, 1 - Math.min(1, d)));
      const lx = x + 0.45, ly = y + 0.55;
      let v = 0.12 + 0.62 * z * Math.exp(-(lx * lx + ly * ly) * 1.1) + 0.18 * z;
      v = Math.max(0, Math.min(1, v - (d > 0.86 ? 0.12 : 0)));
      const jitter = (((c * 7 + r * 13 + beat * 5) % 17) === 0 ? 1 : 0) * (beat % 2 ? 1 : -1);
      const k = Math.max(1, Math.min(RAMP.length - 1, Math.round((night ? v : 1 - v * 0.8) * (RAMP.length - 1)) + jitter));
      row.push({ ch: RAMP[k] });
    }
    grid.push(row);
  }
  return grid;
}
/** The helmet as rects, for scripts/icons.mjs: no font needed, the same head at any size. */
export function helmetSvg(cols: number, mode: FaceMode = 'here', o: { night?: boolean; beat?: number; ink?: string; eye?: string; scan?: string; bg?: string; cw?: number; ch?: number } = {}): string {
  const night = o.night ?? true, ink = o.ink ?? (night ? '#ececec' : '#1d1b18');
  const eye = o.eye ?? (mode === 'needs' ? '#0a84ff' : ink), scan = o.scan ?? '#0a84ff';
  const cw = o.cw ?? 10, chh = o.ch ?? 16, cells = helmet(cols, mode, night, o.beat ?? 0);
  const w = cols * cw, h = cells.length * chh;
  let s = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${o.bg ? `<rect width="${w}" height="${h}" fill="${o.bg}"/>` : ''}`;
  cells.forEach((row, y) => row.forEach((cell, x) => {
    if (cell.ch === ' ') return;
    const op = cell.scan || cell.eye ? 1 : 0.2 + 0.8 * (Math.max(1, RAMP.indexOf(cell.ch)) / (RAMP.length - 1));
    s += `<rect x="${x * cw}" y="${y * chh}" width="${cw}" height="${chh}" fill="${cell.scan ? scan : cell.eye ? eye : ink}" opacity="${op.toFixed(2)}"/>`;
  }));
  return s + '</svg>';
}

/** The app's moods map onto the faces' five poses (and from there onto the four face modes, faceOf). */
export type Pose = 'listen' | 'work' | 'needs' | 'pleased' | 'rest';
export const POSES: Pose[] = ['listen', 'work', 'needs', 'pleased', 'rest'];
export const poseOf = (m: Mood | Pose = 'idle'): Pose =>
  m === 'needs' || m === 'pleased' ? m : m === 'work' ? 'work' : m === 'happy' ? 'pleased' : m === 'rest' ? 'rest' : m === 'ask' || m === 'worried' || m === 'error' ? 'needs' : 'listen';

// ── The critters: Chief is a bear in a captain's cap, each template helper its own animal, and a helper Chief makes up
// gets an animal from the made-up pool (adapter.kindOf). Flat colour on a calm disc, one thin outline: warm, never a
// sticker. Hand-written SVG in a 100×100 box on its own disc, so one drawing serves every face slot and the phone's
// PNGs (scripts/icons.mjs). ──
const INK = '#2A2320';
type Critter = { fur: string; inner?: string; muzzle?: string; ears: 'round' | 'pointy' | 'long' | 'tufts' | 'mouse' | 'floppy' | 'none' | 'mane'; bg: string; eye?: string;
  mask?: string; patches?: string; beak?: boolean; owl?: boolean; whiskers?: boolean; cap?: boolean; snout?: string; tuft?: boolean; earInk?: string };
/** Eyes, brows and mouth in each mode, centred between the eyes at (50, 54). `glance` (-1 left to 1 right) is where a
 *  working face's eyes are along the line it reads. */
function face(m: FaceMode, glance: number, o: { ink: string; blush: boolean; mouthY: number }) {
  const x = 50, y = 54, g = 12, s = 0.95, ink = o.ink, my = o.mouthY;
  const line = (d: string, w: number) => `<path d="${d}" stroke="${ink}" stroke-width="${w * s}" fill="none" stroke-linecap="round"/>`;
  const r = (m === 'needs' ? 4 : 3.4) * s, dx = m === 'think' ? 1.6 * s * glance : 0, dy = m === 'think' ? -1.8 * s : 0;
  const eyes = m === 'rest' ? [-g, g].map((d) => line(`M${x + d - 4 * s} ${y}q${4 * s} ${3.6 * s} ${8 * s} 0`, 2.4)).join('')
    : [-g, g].map((d) => `<circle cx="${x + d + dx}" cy="${y + dy}" r="${r}" fill="${ink}"/><circle cx="${x + d + dx + r * 0.35}" cy="${y + dy - r * 0.35}" r="${r * 0.32}" fill="#fff"/>`).join('');
  const brows = m === 'needs' ? [-g, g].map((d) => line(`M${x + d - 4 * s} ${y - 9 * s}q${4 * s} ${-3 * s} ${8 * s} 0`, 2)).join('') : '';
  const mouth = m === 'needs' ? `<ellipse cx="${x}" cy="${my + s}" rx="${3 * s}" ry="${3.6 * s}" fill="${ink}"/>`
    : m === 'think' ? line(`M${x - 3 * s} ${my + s}q${3 * s} ${-1.6 * s} ${6 * s} ${-0.4 * s}`, 2.2)
    : m === 'rest' ? line(`M${x - 2.6 * s} ${my}q${2.6 * s} ${1.8 * s} ${5.2 * s} 0`, 2)
    : line(`M${x - 6 * s} ${my - s}q${6 * s} ${6.4 * s} ${12 * s} 0`, 2.4);
  const blush = o.blush && m !== 'think' ? [-g - 4 * s, g + 4 * s].map((d) => `<ellipse cx="${x + d}" cy="${y + 7 * s}" rx="${4 * s}" ry="${2.4 * s}" fill="#FF8FA3" opacity=".55"/>`).join('') : '';
  return blush + eyes + brows + mouth;
}
function drawCritter(p: Critter, m: FaceMode, night: boolean, glance: number, aspect: number) {
  const L = INK, w = 2.4, inner = p.inner ?? p.fur;
  const ears = {
    round: [27, 73].map((x) => `<circle cx="${x}" cy="34" r="12" fill="${p.earInk ?? p.fur}" stroke="${L}" stroke-width="${w}"/><circle cx="${x}" cy="34" r="6" fill="${inner}"/>`).join(''),
    pointy: `<path d="M22 46L25 15L47 33Z" fill="${p.fur}" stroke="${L}" stroke-width="${w}" stroke-linejoin="round"/><path d="M78 46L75 15L53 33Z" fill="${p.fur}" stroke="${L}" stroke-width="${w}" stroke-linejoin="round"/><path d="M28 36L29 23L39 32Z" fill="${inner}"/><path d="M72 36L71 23L61 32Z" fill="${inner}"/>`,
    long: [[38, -8], [62, 8]].map(([x, a]) => `<g transform="rotate(${a} ${x} 30)"><ellipse cx="${x}" cy="18" rx="7.5" ry="20" fill="${p.fur}" stroke="${L}" stroke-width="${w}"/><ellipse cx="${x}" cy="19" rx="3.4" ry="14" fill="${inner}"/></g>`).join(''),
    tufts: `<path d="M26 40L24 18L42 31Z" fill="${p.fur}" stroke="${L}" stroke-width="${w}" stroke-linejoin="round"/><path d="M74 40L76 18L58 31Z" fill="${p.fur}" stroke="${L}" stroke-width="${w}" stroke-linejoin="round"/>`,
    mouse: [24, 76].map((x) => `<circle cx="${x}" cy="34" r="15" fill="${p.fur}" stroke="${L}" stroke-width="${w}"/><circle cx="${x}" cy="34" r="9" fill="${inner}"/>`).join(''),
    floppy: '',
    none: '',
    mane: `<circle cx="50" cy="55" r="40" fill="${inner}" stroke="${L}" stroke-width="${w}"/>` + Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `<circle cx="${(50 + 37 * Math.cos(a)).toFixed(1)}" cy="${(55 + 37 * Math.sin(a)).toFixed(1)}" r="8" fill="${inner}"/>`; }).join(''),
  }[p.ears];
  const floppy = p.ears === 'floppy' ? `<path d="M22 42C10 46 10 70 18 76C26 72 28 56 30 46Z" fill="${inner}" stroke="${L}" stroke-width="${w}" stroke-linejoin="round"/><path d="M78 42C90 46 90 70 82 76C74 72 72 56 70 46Z" fill="${inner}" stroke="${L}" stroke-width="${w}" stroke-linejoin="round"/>` : '';
  const head = `<ellipse cx="50" cy="57" rx="31" ry="28" fill="${p.fur}" stroke="${L}" stroke-width="${w}"/>`;
  const tuft = p.tuft ? `<path d="M46 31q2 -10 6 -4q2 -8 6 0" stroke="${L}" stroke-width="2" fill="${p.fur}" stroke-linecap="round"/>` : '';
  const patches = p.patches ? `<ellipse cx="38" cy="54" rx="8" ry="9.5" fill="${p.patches}" transform="rotate(20 38 54)"/><ellipse cx="62" cy="54" rx="8" ry="9.5" fill="${p.patches}" transform="rotate(-20 62 54)"/>` : '';
  const mask = p.mask ? `<path d="M22 52C30 44 42 48 50 50C58 48 70 44 78 52C74 62 62 62 50 58C38 62 26 62 22 52Z" fill="${p.mask}"/>` : '';
  const muzzle = p.muzzle ? `<ellipse cx="50" cy="69" rx="15" ry="11" fill="${p.muzzle}"/>` : '';
  const owl = p.owl ? `<circle cx="38" cy="54" r="11" fill="#FFF6E6" stroke="${L}" stroke-width="2"/><circle cx="62" cy="54" r="11" fill="#FFF6E6" stroke="${L}" stroke-width="2"/>` : '';
  const snout = p.snout ? `<ellipse cx="50" cy="67" rx="10" ry="7.5" fill="${p.snout}" stroke="${L}" stroke-width="2"/><circle cx="46.5" cy="67" r="1.8" fill="${L}"/><circle cx="53.5" cy="67" r="1.8" fill="${L}"/>` : '';
  const nose = p.beak ? `<path d="M45 62L55 62L50 69Z" fill="#F7A23B" stroke="${L}" stroke-width="1.6" stroke-linejoin="round"/>` : p.snout ? '' : `<ellipse cx="50" cy="63" rx="4" ry="3" fill="${L}"/>`;
  const whisk = p.whiskers ? `<path d="M30 66l-12 -2M30 70l-11 3M70 66l12 -2M70 70l11 3" stroke="${L}" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>` : '';
  const f = face(m, glance, { ink: p.eye ?? INK, blush: !(p.owl || p.mask || p.patches), mouthY: p.beak ? 73 : p.snout ? 77 : 71 });
  const cap = p.cap ? `<path d="M26 34C26 16 74 16 74 34Z" fill="#1F3A68" stroke="${L}" stroke-width="${w}" stroke-linejoin="round"/><path d="M26 33H74" stroke="#fff" stroke-width="4"/><path d="M22 36Q50 44 78 36" stroke="${L}" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="50" cy="25" r="3.6" fill="#F5C542" stroke="${L}" stroke-width="1.4"/>` : '';
  const zz = m === 'rest' ? `<text x="76" y="26" font-family="Georgia, serif" font-style="italic" font-size="18" fill="${INK}" opacity=".55">z</text>` : '';
  // A box wider than tall (the old text helmet's 1.2:1 slot) centres the disc in it rather than stretching it.
  const pad = 50 * (aspect - 1);
  return `<svg viewBox="${-pad} 0 ${100 + 2 * pad} 100" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="d"><circle cx="50" cy="50" r="50"/></clipPath></defs>`
    + `<circle cx="50" cy="50" r="50" fill="${p.bg}"/><g clip-path="url(#d)">${ears + floppy + head + tuft + patches + mask + muzzle + owl + snout + nose + whisk + f + cap + zz}</g>`
    + `${night ? '' : '<circle cx="50" cy="50" r="49.4" fill="none" stroke="#000" stroke-opacity=".06" stroke-width="1.2"/>'}</svg>`;
}

/** Chief: the bear in the navy captain's cap. Nobody else is a bear, so no helper is ever mistaken for him. */
const CHIEF: Critter = { fur: '#B98252', inner: '#E8C49A', muzzle: '#F1D9B8', ears: 'round', bg: '#F7E3C8', cap: true };
/** Each look: a template helper's animal (keyed by template id), then the made-up pool (MADE), each with its own disc colour. */
export const PALS = {
  scout: { fur: '#EE8A3C', inner: '#FFE3C8', muzzle: '#FFF6EC', ears: 'pointy', bg: '#FFE3D0' }, // fox
  scribe: { fur: '#A27A55', ears: 'tufts', bg: '#F6E9C9', owl: true, beak: true }, // owl
  reel: { fur: '#9C9CAA', inner: '#55556A', muzzle: '#F2F2F6', ears: 'round', earInk: '#9C9CAA', bg: '#DCE6FF', mask: '#3B3B4A', eye: '#fff' }, // raccoon
  support: { fur: '#E2AA6E', inner: '#9C6A3C', muzzle: '#F8E6CC', ears: 'floppy', bg: '#E2F2D8' }, // dog
  tracer: { fur: '#BDB6CC', inner: '#FFC4D2', muzzle: '#EFEAF6', ears: 'mouse', bg: '#EEE6FF', whiskers: true }, // mouse
  xgrowth: { fur: '#FFD640', ears: 'none', bg: '#FFF2BF', beak: true, tuft: true }, // chick
  cto: { fur: '#4D4D5A', inner: '#FFB3C4', muzzle: '#6A6A78', ears: 'pointy', bg: '#D3F0EA', eye: '#D7F27A', whiskers: true }, // cat
  bunny: { fur: '#FFFFFF', inner: '#FFC4D2', muzzle: '#FFF', ears: 'long', bg: '#FFE0EA' },
  panda: { fur: '#FFFFFF', patches: '#2E2E38', ears: 'round', earInk: '#2E2E38', inner: '#2E2E38', bg: '#E4F1E6', eye: '#fff' },
  pig: { fur: '#FFB6C6', inner: '#FF8FA8', ears: 'pointy', bg: '#E3ECF6', snout: '#FF9AB2' },
  koala: { fur: '#A9AEB8', inner: '#E9D9E0', muzzle: '#D8DCE2', ears: 'mouse', bg: '#D3F0EA' },
  lion: { fur: '#F2B544', inner: '#C9782A', muzzle: '#FFE7B8', ears: 'mane', bg: '#FFEFD2' },
  sheep: { fur: '#EED9C4', inner: '#FFFFFF', ears: 'mane', bg: '#E3ECF6' },
  frog: { fur: '#8BCB6B', inner: '#6BAF4E', ears: 'none', bg: '#E2F5D6', snout: '#A6DC8A' },
  deer: { fur: '#C7A27C', inner: '#8A6440', muzzle: '#EAD7BF', ears: 'pointy', bg: '#F1E4D3' },
} satisfies Record<string, Critter>;
export type Kind = keyof typeof PALS;
/** The animals for helpers no template draws (Chief's made-up hires): never a template's, never Chief's bear. */
export const MADE: Kind[] = ['bunny', 'panda', 'pig', 'koala', 'lion', 'sheep', 'frog', 'deer'];
/** Chief or a helper as a critter SVG. `beat` (a working face's ticker) moves its eyes along a line, left to right,
 *  as it reads; `aspect` is the slot's width over its height. */
export const critter = (who: Kind | 'chief', mode: FaceMode = 'here', o: { night?: boolean; beat?: number; aspect?: number } = {}) =>
  drawCritter(who === 'chief' ? CHIEF : PALS[who], mode, !!o.night, (((o.beat ?? 0) % 24) / 23) * 2 - 1, o.aspect ?? 1);

// ── The logo: a dot house with a smile, and the wordmark in the same dots ──
export const HOUSE: Bitmap = [
  '.....rr.....', '....rrrr....', '...rrrrrr...', '..rrrrrrrr..', '.rrrrrrrrrr.', '..pppppppp..',
  '..ppeppepp..', '..ppeppepp..', '..pmppppmp..', '..ppmmmmpp..', '..pppppppp..',
];
export const HOUSE_PAL: Palette = { r: '#ff7aa2', p: '#ffc27a', e: '#3b3552', m: '#3b3552' };

/** The phone's tab bar, 9×9 dots each, one colour (the tab's ink): the same on every phone, unlike a font's glyphs. */
export type Tab = 'home' | 'crew' | 'things' | 'routines' | 'settings';
export const TABS: Record<Tab, Bitmap> = {
  home: ['....x....', '...x.x...', '..x...x..', '.x.....x.', 'xxxxxxxxx', '.x.....x.', '.x.xxx.x.', '.x.x.x.x.', '.xxx.xxx.'],
  crew: ['..xxxxx..', '.x.....x.', 'x..x.x..x', 'x..x.x..x', 'x.......x', 'x.x...x.x', 'x..xxx..x', '.x.....x.', '..xxxxx..'],
  things: ['xxxxxxxxx', 'x.......x', 'x.xxxxx.x', 'x.......x', 'x.xxxxx.x', 'x.......x', 'x.xxx...x', 'x.......x', 'xxxxxxxxx'],
  routines: ['..xxxxx.x', '.x.....xx', 'x.....xxx', 'x........', 'x.......x', '........x', 'xxx.....x', 'xx.....x.', 'x.xxxxx..'],
  settings: ['....x....', '.x.xxx.x.', '..xxxxx..', '.xxx.xxx.', 'xxx...xxx', '.xxx.xxx.', '..xxxxx..', '.x.xxx.x.', '....x....'],
};

// ── ASCII moments ──
/** The star that marks text drawn in the proportional system font — the starter chips, the Apps ▸ Skills row and
 *  the phone's idea button and empty-list ornament: U+2605, a glyph every platform font carries. The four-point
 *  sparkle it replaces (U+2726, ✦) is NOT in the iOS system font, which draws a missing-glyph box for it on iPad;
 *  the monospace .art moments (the boot plasma, confetti, the done sparkle) keep U+2726, which monospace draws. */
export const STAR = '★';
/** The quiet mark beside an empty list, and the one ornament the ASCII moments share. */
export const ORNAMENT = `·  ${STAR}  ·`;
const SHADOW: Record<string, string[]> = {
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  W: ['██╗    ██╗', '██║    ██║', '██║ █╗ ██║', '██║███╗██║', '╚███╔███╔╝', ' ╚══╝╚══╝ '],
  H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  U: ['██╗   ██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
};
/** The block-letter CREWHOUSE of the boot splash: six lines of characters. */
export const BANNER: string[] = [0, 1, 2, 3, 4, 5].map((y) => [...'CREWHOUSE'].map((ch) => SHADOW[ch][y]).join(''));

/** A slow plasma of glyphs behind the splash (Ghostty's living ASCII). */
export function field(t: number, w = 72, h = 48) {
  const ch = '    ..·:+*✦';
  let s = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.sin(x * 0.23 + t * 0.07) + Math.sin(y * 0.19 - t * 0.05) + Math.sin((x + y) * 0.11 + t * 0.03);
      s += ch[Math.max(0, Math.min(ch.length - 1, Math.floor(((v + 3) / 6) * ch.length)))];
    }
    s += '\n';
  }
  return s;
}

/** Chief's tiny laptop; its screen fills with keystrokes while the crew works. */
export function laptop(t: number) {
  const keys = '▖▗▘▝▚▞▌▐▄▀';
  const line = (n: number) => Array.from({ length: 10 }, (_, i) => (i < ((t + n * 3) % 11) ? keys[(i * 7 + n * 3 + t) % keys.length] : ' ')).join('');
  return [' ╭──────────╮', ` │${line(0)}│`, ` │${line(1)}│`, ' ╰──────────╯', '▁▁▁▁▁▁▁▁▁▁▁▁▁▁'].join('\n');
}

/** One frame of an ASCII confetti burst: glyphs fall from the top, rows are strings. */
export function confetti(t: number, w = 40, h = 16) {
  const glyphs = '✦*·°+✧♥';
  const rows = Array.from({ length: h }, () => Array(w).fill(' '));
  for (let i = 0; i < 38; i++) {
    const x = (i * 17 + Math.round(Math.sin(t / 3 + i) * 2)) % w;
    const y = Math.floor(t * (0.5 + (i % 5) * 0.18) + (i * 7) % h) % h;
    rows[y][(x + w) % w] = glyphs[i % glyphs.length];
  }
  return rows.map((r) => r.join(''));
}
export const CONFETTI_COLORS = ['#ff7aa2', '#ffc27a', '#a9cbff', '#b5ecc4', '#d9c2ff'];
