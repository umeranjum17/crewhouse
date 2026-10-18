// The mascot family as data: the Geo faces (Chief's and every helper's), dot bitmaps for the logo, and the ASCII brand moments
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

// ── The faces, Geo: Chief and every helper a flat shape in its own crew colour with one trait, on a black disc.
// Chief is the blue circle in the white cap, each template keys its own look by template id, and a helper Chief makes up
// gets a look from the made-up pool (adapter.kindOf). Hand-written SVG in a 100×100 box, so one drawing serves every face
// slot and the phone's PNGs (scripts/icons.mjs). `c` is the crew colour: the face, and the person's card for it. ──
const INK = '#0B0B0B', LIGHT = '#F7F7FB';
type Geo = { c: string; shape: string; trait?: string; eyes?: 'dot' | 'glasses' | 'arc' | 'bar'; ey: number; my: number; mouth?: 'smile' | 'flat' };
const SHAPE = {
  circle: (c: string) => `<circle cx="50" cy="56" r="38" fill="${c}"/>`,
  pill: (c: string) => `<rect x="22" y="18" width="56" height="72" rx="28" fill="${c}"/>`,
  square: (c: string) => `<rect x="20" y="20" width="60" height="60" rx="14" fill="${c}"/>`,
  arch: (c: string) => `<path d="M20 82V52A30 30 0 0 1 80 52V82Z" fill="${c}"/>`,
  hex: (c: string) => `<path d="M50 10L85 30V70L50 90L15 70V30Z" fill="${c}"/>`,
};
const badge = (glyph: string) => `<circle cx="80" cy="80" r="12" fill="${INK}"/><path d="${glyph}" fill="none" stroke="${LIGHT}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
const TRAIT = {
  cap: `<rect x="26" y="18" width="48" height="18" rx="4" fill="${LIGHT}"/><rect x="20" y="32" width="60" height="8" rx="3" fill="${INK}"/>`,
  bow: `<path d="M50 27L36 16V38ZM50 27L64 16V38Z" fill="#E0408A"/>`,
  sparkle: `<path d="M84 8L86.5 15L94 17.5L86.5 20L84 27L81.5 20L74 17.5L81.5 15Z" fill="${LIGHT}"/>`,
  arrow: badge('M74 80H86M82 75.5L86.5 80L82 84.5'),
  play: `<circle cx="80" cy="80" r="12" fill="${INK}"/><path d="M76.5 74.5L86 80L76.5 85.5Z" fill="${LIGHT}"/>`,
  prompt: badge('M74 75L78.5 79.5L74 84M80 85H86'),
  headset: `<path d="M24 54A26 26 0 0 1 76 54" fill="none" stroke="${LIGHT}" stroke-width="4"/><rect x="18" y="50" width="9" height="16" rx="4" fill="${LIGHT}"/><rect x="73" y="50" width="9" height="16" rx="4" fill="${LIGHT}"/>`,
  sprout: `<path d="M50 22V8" stroke="${LIGHT}" stroke-width="3.5" stroke-linecap="round"/><path d="M50 12C42 4 34 8 34 8C36 16 46 16 50 12ZM50 10C58 2 66 6 66 6C64 14 54 14 50 10Z" fill="#2FCB93"/>`,
  ears: (c: string) => `<circle cx="24" cy="26" r="11" fill="${c}"/><circle cx="76" cy="26" r="11" fill="${c}"/>`,
  curl: `<path d="M50 20C50 10 60 8 62 14C64 20 54 20 56 12" fill="none" stroke="${LIGHT}" stroke-width="3.5" stroke-linecap="round"/>`,
  leaf: `<path d="M76 24C76 12 88 6 94 6C94 16 88 26 76 24Z" fill="#2FCB93"/><path d="M76 24L88 12" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
  crown: `<path d="M30 30L34 8L44 20L50 6L56 20L66 8L70 30Z" fill="#FFC93C"/>`,
  tuft: `<circle cx="38" cy="20" r="9" fill="${LIGHT}"/><circle cx="50" cy="15" r="10" fill="${LIGHT}"/><circle cx="62" cy="20" r="9" fill="${LIGHT}"/>`,
  antenna: `<path d="M50 22V10" stroke="${LIGHT}" stroke-width="3.5" stroke-linecap="round"/><circle cx="50" cy="8" r="5" fill="${LIGHT}"/>`,
  antlers: `<path d="M36 22L28 6M30 14L20 12M64 22L72 6M70 14L80 12" fill="none" stroke="${LIGHT}" stroke-width="4" stroke-linecap="round"/>`,
  crop: `<path d="M10 26V10H26M74 10H90V26M90 74V90H74M26 90H10V74" fill="none" stroke="${LIGHT}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  speed: `<path d="M4 42H18M2 54H20M4 66H18" fill="none" stroke="${LIGHT}" stroke-width="3.5" stroke-linecap="round"/>`,
  spark: badge('M81 70L75 80H80L77 90L85 79H80Z'),
};
const geo = (shape: keyof typeof SHAPE, c: string, trait: string, o: Partial<Geo> = {}): Geo =>
  ({ c, shape: SHAPE[shape](c), trait, ey: shape === 'circle' ? 60 : shape === 'square' ? 50 : shape === 'hex' ? 53 : shape === 'arch' ? 58 : 56, my: shape === 'circle' ? 74 : shape === 'square' ? 68 : shape === 'hex' ? 66 : 70, ...o });
/** Eyes and mouth in each mode, centred between the eyes. `glance` (-1 left to 1 right) is where a working face's eyes
 *  are along the line it reads. */
function geoFace(p: Geo, m: FaceMode, glance: number) {
  const y = p.ey, my = p.my, g = 11;
  const line = (d: string, w = 4) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/>`;
  const dx = m === 'think' ? 3 * glance : 0, dy = m === 'think' ? -2 : 0;
  const style = m === 'needs' && p.eyes !== 'glasses' ? 'dot' : p.eyes ?? 'dot';
  const eyes = m === 'rest' ? line([-g, g].map((d) => `M${50 + d - 5} ${y}Q${50 + d} ${y + 5} ${50 + d + 5} ${y}`).join(''))
    : [-g, g].map((d) => {
      const x = 50 + d + dx, ey = y + dy;
      return style === 'glasses' ? `<circle cx="${50 + d}" cy="${y - 2}" r="9" fill="${LIGHT}"/><circle cx="${x + (m === 'think' ? 0 : 3)}" cy="${ey}" r="${m === 'needs' ? 5.5 : 4.5}" fill="${INK}"/>`
        : style === 'arc' ? line(`M${x - 5} ${ey}Q${x} ${ey - 8} ${x + 5} ${ey}`, 4.2)
        : style === 'bar' ? `<rect x="${x - 5.5}" y="${ey - 3}" width="11" height="6" rx="3" fill="${INK}"/>`
        : `<circle cx="${x}" cy="${ey}" r="${m === 'needs' ? 6.5 : 5.5}" fill="${INK}"/>`;
    }).join('');
  const mouth = m === 'think' || m === 'rest' || p.mouth === 'flat' ? line(`M${m === 'think' ? 46 : 44} ${my}H${m === 'think' ? 56 : 56}`)
    : line(`M41 ${my}Q50 ${my + 7} 59 ${my}`);
  return eyes + mouth;
}
/** Chief: the blue circle in the white cap. Nobody else wears the cap, so no helper is ever mistaken for him. */
const CHIEF = geo('circle', '#3157F2', TRAIT.cap);
/** Each look: a template helper's (keyed by template id), then the made-up pool (MADE). */
export const PALS = {
  scout: geo('square', '#FF6B5B', '', { eyes: 'glasses', ey: 52, mouth: 'flat' }), // Research Rae: glasses
  scribe: geo('arch', '#FFC93C', TRAIT.sparkle, { eyes: 'arc' }), // Writer Will: a sparkle
  tracer: geo('hex', '#2FCB93', TRAIT.arrow, { eyes: 'bar', mouth: 'flat' }), // Finder Finn: the arrow
  reel: geo('circle', '#A98BFA', TRAIT.play), // Video Vic: play
  support: geo('pill', '#4CC9F0', TRAIT.headset), // Support Sam: a headset
  xgrowth: geo('arch', '#B8E04A', TRAIT.sprout), // Growth Gus: a sprout
  cto: geo('square', '#FF9F43', TRAIT.prompt, { eyes: 'bar' }), // Terminal Tess: a prompt
  frame: geo('square', '#D946EF', TRAIT.crop), // Frame Fay: crop marks
  motion: geo('pill', '#0D9488', TRAIT.speed), // Motion Milo: speed lines
  prototype: geo('hex', '#E11D48', TRAIT.spark), // Spark Stella: a spark
  bunny: geo('pill', '#FF7AB8', TRAIT.bow),
  panda: geo('circle', '#C4B5FD', '', { shape: TRAIT.ears('#C4B5FD') + SHAPE.circle('#C4B5FD') }),
  pig: geo('square', '#FDA4AF', TRAIT.curl),
  koala: geo('hex', '#A3B4C8', TRAIT.leaf, { eyes: 'bar' }),
  lion: geo('circle', '#E8C39E', TRAIT.crown),
  sheep: geo('pill', '#E7E2D6', TRAIT.tuft),
  frog: geo('arch', '#86E3A8', TRAIT.antenna),
  deer: geo('pill', '#D4A373', TRAIT.antlers, { mouth: 'flat' }),
} satisfies Record<string, Geo>;
export type Kind = keyof typeof PALS;
/** The looks for helpers no template draws (Chief's made-up hires): never a template's, never Chief's. */
export const MADE: Kind[] = ['bunny', 'panda', 'pig', 'koala', 'lion', 'sheep', 'frog', 'deer'];
/** The crew colour: a face's own, and the card the person sees for it. Chief's blue is 3.8:1 with black words, so his
 *  card's words are light (5.6:1): `inkOn`. */
export const colourOf = (who: Kind | 'chief') => (who === 'chief' ? CHIEF : PALS[who]).c;
export const inkOn = (who: Kind | 'chief') => who === 'chief' ? LIGHT : INK;
/** Chief or a helper as a Geo face SVG on its black disc. `beat` (a working face's ticker) moves its eyes along a line,
 *  left to right, as it reads; `aspect` is the slot's width over its height. */
export const critter = (who: Kind | 'chief', mode: FaceMode = 'here', o: { beat?: number; aspect?: number } = {}) => {
  const p = who === 'chief' ? CHIEF : PALS[who], pad = 50 * ((o.aspect ?? 1) - 1);
  // A box wider than tall centres the disc in it rather than stretching it.
  return `<svg viewBox="${-pad} 0 ${100 + 2 * pad} 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="50" fill="${INK}"/>`
    + `<g transform="translate(13 13) scale(.74)">${p.shape + geoFace(p, mode, (((o.beat ?? 0) % 24) / 23) * 2 - 1) + (p.trait ?? '')}</g></svg>`;
};

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
