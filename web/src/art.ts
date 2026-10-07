// The mascot family as data: dot bitmaps for Chief, the pals and the logo, and the ASCII brand moments
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

// ── The helmet: Chief and every helper wear one, drawn in density characters with a dark visor (the Term-look
// mascot). mode: here | needs | think | rest (rest = eyes shut). Ported from the look board's static generator:
// the same squircle (x⁴+y⁴), visor, eyes and think-scan math; only the markup became cells, so the web (<pre>),
// the phone (dots) and the icon script (rects) all draw the same head. ──
export const RAMP = ' .:-=+*#%@';
export type HelmetMode = 'here' | 'needs' | 'think' | 'rest';
export const HELMET_MODES: HelmetMode[] = ['here', 'needs', 'think', 'rest'];
/** Every app mood wears one of the helmet's four moods (via the five poses: work thinks, pleased sits here). */
export const helmetOf = (m: Mood | Pose | HelmetMode = 'idle'): HelmetMode => {
  if (m === 'here' || m === 'needs' || m === 'think' || m === 'rest') return m;
  const p = poseOf(m);
  return p === 'needs' ? 'needs' : p === 'work' ? 'think' : p === 'rest' ? 'rest' : 'here';
};
export type HelmetCell = { ch: string; eye?: true; scan?: true };
/** The helmet as cells: ' ' is bare canvas, eye/scan cells wear the mood colour. */
export function helmet(cols: number, mode: HelmetMode = 'here', night = true, beat = 0): HelmetCell[][] {
  const rows = Math.round(cols * 0.5);
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
/** The helmet as plain text rows, for the web's <pre className="art">. */
export const helmetText = (cols: number, mode: HelmetMode = 'here', night = true, beat = 0): string[] =>
  helmet(cols, mode, night, beat).map((r) => r.map((c) => c.ch).join(''));
/** The helmet as a dot bitmap for the phone's Dots path (no mono text on the phone): one dot per character,
 *  the letter its density step, 'e' an eye and 's' the think-scan. Opacity carries the shading. */
export function helmetDots(cols: number, mode: HelmetMode = 'here', night = true, beat = 0, eye = night ? '#ececec' : '#1d1b18'): { rows: Bitmap; pal: Palette } {
  const ink: [number, number, number] = night ? [236, 236, 236] : [29, 27, 24];
  const pal: Palette = { e: mode === 'needs' ? '#0a84ff' : eye, s: '#0a84ff' };
  for (let k = 1; k < RAMP.length; k++) pal[String(k)] = `rgba(${ink[0]},${ink[1]},${ink[2]},${(0.2 + 0.8 * (k / (RAMP.length - 1))).toFixed(2)})`;
  const rows = helmet(cols, mode, night, beat).map((r) => r.map((c) =>
    c.ch === ' ' ? '.' : c.eye ? 'e' : c.scan ? 's' : String(Math.max(1, RAMP.indexOf(c.ch)))).join(''));
  return { rows, pal };
}
/** The helmet as rects, for scripts/icons.mjs: no font needed, the same head at any size. */
export function helmetSvg(cols: number, mode: HelmetMode = 'here', o: { night?: boolean; beat?: number; ink?: string; eye?: string; scan?: string; bg?: string; cw?: number; ch?: number } = {}): string {
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

// ── Studio Chief (B1): one ink line, dot eyes, paper and vermilion. Chief is the white bean in the black bowler with
// the red band; his personality lives in the brows, a small handlebar, the hat and two line arms. The crew are pastel
// beans, each with one prop. Hand-drawn SVG; the phone renders the same drawings to PNGs (scripts/icons.mjs). ──
export const INK = '#141A2A', RED = '#F0482A';
/** The drawings have five poses; every app mood wears one. */
export type Pose = 'listen' | 'work' | 'needs' | 'pleased' | 'rest';
export const POSES: Pose[] = ['listen', 'work', 'needs', 'pleased', 'rest'];
export const poseOf = (m: Mood | Pose = 'idle'): Pose =>
  m === 'needs' || m === 'pleased' ? m : m === 'work' ? 'work' : m === 'happy' ? 'pleased' : m === 'rest' ? 'rest' : m === 'ask' || m === 'worried' || m === 'error' ? 'needs' : 'listen';
type Opts = { vb?: string; floor?: boolean; wave?: boolean; night?: boolean };
/** Chief's outer line after dark: the office's night ink (tokens.ts room.night.edge), so his outline, arms and hands
 *  stay drawn on a dark page. What sits on his white body keeps the day ink. */
export const NIGHT_INK = '#C9C4DA';
const Z = 'font-family="Instrument Serif, Georgia, serif" font-style="italic"';
let uid = 0;

/** Chief whole (viewBox 0 0 200 250, feet on y 232). */
/** Chief's side shading: the ellipse cx 156 cy 178 rx 30 ry 120, its arc from the art's floor (y 240) up to where it
 *  leaves his body over the dome (the old whole arc's first third, so it is drawn as the same curve), closed outside
 *  the body. The body clip paints exactly what it did, and nothing measures past his outline or below his feet. */
const SHADE = 'M130.3144 240A30 120 0 0 1 136.5685 86.5742H150V240Z';
export function chiefSvg(mood: Mood | Pose = 'idle', o: Opts = {}) {
  const m = poseOf(mood), g = `ch${++uid}`, lw = 3.4, L = o.night ? NIGHT_INK : INK;
  const body = 'M52 232V120a48 48 0 0 1 96 0V232Z';
  const ey = m === 'work' ? 121 : 118;
  const eyes = m === 'rest' ? '' : m === 'pleased' ? `<path d="M80 ${ey + 1}q6 -7 12 0M108 ${ey + 1}q6 -7 12 0" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`
    : `<circle cx="${m === 'listen' ? 88 : 86}" cy="${ey}" r="5.6" fill="${INK}"/><circle cx="${m === 'listen' ? 116 : 114}" cy="${ey}" r="5.6" fill="${INK}"/>`;
  const brow = { listen: 'M78 104q8 -4 15 -1M107 100q8 -3 15 2', work: 'M78 106l14 3M108 109l14 -3', needs: 'M77 99q8 -7 16 -2M107 97q8 -5 16 2', pleased: 'M78 104q8 -4 15 0M107 104q8 -4 15 0', rest: '' }[m];
  const tip = m === 'pleased' ? -5 : 0;
  const tash = `<path d="M100 131C94 127 86 128 80 132C76 135 72 ${134 + tip} 71 ${129 + tip}C69 ${136 + tip} 74 141 81 140C88 139 95 137 100 135C105 137 112 139 119 140C126 141 131 ${136 + tip} 129 ${129 + tip}C128 ${134 + tip} 124 135 120 132C114 128 106 127 100 131Z" fill="${INK}"/>`;
  const mouth = m === 'pleased' ? `<path d="M93 145q7 5 14 0" stroke="${INK}" stroke-width="2.8" fill="none" stroke-linecap="round"/>` : m === 'needs' ? `<ellipse cx="100" cy="146" rx="3" ry="2.6" fill="${INK}"/>` : '';
  const hand = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="7" fill="#fff" stroke="${L}" stroke-width="${lw - .6}"/>`;
  const arm = (d: string) => `<path d="${d}" stroke="${L}" stroke-width="${lw}" fill="none" stroke-linecap="round"/>`;
  // The bowler never leaves his head: a pose only tilts it about the crown's seat (or pulls it over his eyes to nap).
  // A thin paper edge keeps the black hat whole against a night background.
  // `wave` (Chief's hero only, B1): calling for you, he lifts the bowler off his head by its brim instead of tipping it.
  const wave = !!o.wave && m === 'needs';
  const hatAt = wave ? 'translate(14 -34) rotate(-14 100 78)' : { listen: 'rotate(4 100 76)', work: '', needs: 'rotate(-7 100 78)', pleased: 'rotate(-5 100 78)', rest: 'translate(0 16) rotate(2 100 76)' }[m];
  const hat = `<g class="hat"><g transform="${hatAt}"><path d="M50 78Q100 94 150 78" stroke="#fff" stroke-width="9.6" fill="none" stroke-linecap="round"/><path d="M68 77C68 51 82 37 100 37C118 37 132 51 132 77Z" fill="${INK}" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><path d="M69 71H131" stroke="${RED}" stroke-width="5"/><path d="M50 78Q100 94 150 78" stroke="${INK}" stroke-width="5.2" fill="none" stroke-linecap="round"/><path d="M80 60C80 52 86 46 93 44" stroke="rgba(255,255,255,.28)" stroke-width="3" fill="none" stroke-linecap="round"/></g></g>`;
  const arms = {
    listen: arm('M54 166C44 184 44 198 48 210') + hand(48, 213) + arm('M146 164C160 160 156 148 132 146') + hand(128, 146),
    work: arm('M54 166C60 184 74 192 88 192') + hand(90, 192) + `<g class="watch"><circle cx="102" cy="196" r="12" fill="#fff" stroke="${L}" stroke-width="2.8"/><path d="M102 189v7l5 3" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/></g><path d="M114 192C124 186 132 178 134 168" stroke="${L}" stroke-width="1.6" fill="none" stroke-dasharray="2 3"/>` + arm('M146 166C156 184 156 198 152 210') + hand(152, 213),
    needs: arm('M54 166C44 184 44 198 48 210') + hand(48, 213) + (wave ? arm('M146 162C172 140 178 82 164 42') + hand(163, 38) : arm('M146 162C166 146 172 112 160 80') + hand(158, 76)),
    pleased: arm('M54 166C38 172 30 160 32 148') + hand(32, 144) + arm('M146 166C162 172 170 160 168 148') + hand(168, 144),
    rest: arm('M54 170C70 190 112 190 132 176') + arm('M146 170C130 190 88 190 68 176') + hand(66, 175) + hand(134, 175),
  }[m];
  const marks = m === 'needs' ? `<path class="cue" d="${wave ? 'M180 62l9 -9M186 78l12 -3M176 50l6 -10' : 'M178 56l9 -9M186 70l12 -3M170 48l2 -12'}" stroke="${RED}" stroke-width="3.4" stroke-linecap="round"/>`
    : m === 'rest' ? `<g class="zz"><text x="150" y="62" ${Z} font-size="30" fill="${L}" opacity=".55">z</text><text x="168" y="40" ${Z} font-size="21" fill="${L}" opacity=".4">z</text></g>`
    : m === 'work' ? `<path d="M30 96l8 4M26 112h9" stroke="${RED}" stroke-width="3" stroke-linecap="round"/>` : '';
  return `<svg viewBox="${o.vb ?? '0 0 200 250'}" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="${g}c"><path d="${body}"/></clipPath></defs>`
    + (o.floor === false ? '' : `<ellipse cx="100" cy="235" rx="58" ry="4.5" fill="${L}" opacity=".1"/>`)
    + `<g class="body"><path d="${body}" fill="#fff"/><g clip-path="url(#${g}c)"><path d="${SHADE}" fill="#EEF1F6"/></g>`
    + `<path d="${body}" fill="none" stroke="${L}" stroke-width="${lw}" stroke-linejoin="round"/>`
    + `<circle cx="76" cy="134" r="6.5" fill="${RED}" opacity=".2"/><circle cx="124" cy="134" r="6.5" fill="${RED}" opacity=".2"/>`
    + `<g class="eyes">${eyes}</g>${brow ? `<path d="${brow}" stroke="${INK}" stroke-width="3.6" fill="none" stroke-linecap="round"/>` : ''}${tash}${mouth}`
    + `<path d="M100 170L86 162V178ZM100 170L114 162V178Z" fill="${RED}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><circle cx="100" cy="170" r="3.6" fill="${RED}" stroke="${INK}" stroke-width="2.2"/>`
    + `${arms}${hat}</g>${marks}</svg>`;
}

/** A crew member whole (viewBox 0 0 120 150, feet on y 140), with their one prop. */
export function beanSvg(kind: Kind, mood: Mood | Pose = 'idle', o: Opts = {}) {
  const m = poseOf(mood), lw = 2.6, f = PALS[kind].body, shut = kind === 'pip' || m === 'rest';
  const body = 'M30 140V74a30 30 0 0 1 60 0V140Z';
  const eyes = shut ? `<path d="M44 84q5 4 10 0M66 84q5 4 10 0" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
    : m === 'pleased' ? `<circle cx="50" cy="80" r="3.4" fill="${INK}"/><circle cx="70" cy="80" r="3.4" fill="${INK}"/><path d="M54 92l5 5l8 -9" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle cx="50" cy="82" r="3.6" fill="${INK}"/><circle cx="70" cy="82" r="3.6" fill="${INK}"/>`;
  const prop = {
    scout: (m === 'needs' ? `<g class="cue"><path d="M88 104C100 92 104 76 102 62" stroke="${INK}" stroke-width="${lw}" fill="none" stroke-linecap="round"/><circle cx="102" cy="58" r="5.4" fill="${RED}" stroke="${INK}" stroke-width="2"/></g>` : '')
      + `<g class="prop"><path d="M64 98l26 -12l3 7l-26 12z" fill="#fff" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M84 89l3 7" stroke="${RED}" stroke-width="3"/></g>`,
    reel: `<g class="prop"><path d="M28 80C28 50 92 50 92 80" stroke="${INK}" stroke-width="3.4" fill="none"/><rect x="22" y="74" width="11" height="18" rx="5.5" fill="${INK}"/><rect x="87" y="74" width="11" height="18" rx="5.5" fill="${INK}"/></g>`,
    scribe: `<path d="M42 90h16M62 90h16" stroke="${INK}" stroke-width="2"/><path d="M42 90a8 6 0 0 0 16 0M62 90a8 6 0 0 0 16 0" fill="rgba(255,255,255,.5)" stroke="${INK}" stroke-width="2"/><rect x="58" y="108" width="30" height="22" rx="2" fill="#fff" stroke="${INK}" stroke-width="2"/><path d="M63 115h18M63 121h12" stroke="${INK}" stroke-width="1.6"/><g class="prop"><path d="M92 102l-10 18" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/><path d="M92 102l3 -5" stroke="${RED}" stroke-width="2.6" stroke-linecap="round"/></g>`,
    tracer: `<g class="prop"><rect x="58" y="100" width="30" height="36" rx="3" fill="#fff" stroke="${INK}" stroke-width="2"/><rect x="66" y="96" width="14" height="7" rx="2" fill="${INK}"/><path d="M63 112l3 3l5 -5M63 124l3 3l5 -5" stroke="${RED}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M74 113h9M74 125h9" stroke="${INK}" stroke-width="1.6"/></g>`,
    // The looks for helpers Chief makes up: each its own pastel and one thing to wear, so a new hire is never a clone.
    bow: `<path d="M60 106l-13 -8v16zM60 106l13 -8v16z" fill="${RED}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><circle cx="60" cy="106" r="3.2" fill="${RED}" stroke="${INK}" stroke-width="2"/>`,
    cap: `<path d="M32 68C32 42 88 42 88 68Z" fill="#fff" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/><path d="M31 68h58" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><circle cx="60" cy="41" r="5" fill="${RED}" stroke="${INK}" stroke-width="2"/>`,
    specs: `<circle cx="50" cy="82" r="8.5" fill="rgba(255,255,255,.35)" stroke="${INK}" stroke-width="2.2"/><circle cx="70" cy="82" r="8.5" fill="rgba(255,255,255,.35)" stroke="${INK}" stroke-width="2.2"/><path d="M58.5 82h3" stroke="${INK}" stroke-width="2.2"/>`,
    scarf: `<path d="M31 100Q60 111 89 100v9Q60 120 31 109Z" fill="${RED}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M68 112l3 22l9 -2l-3 -21" fill="${RED}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`,
    pip: `<path d="M30 76C28 50 50 40 68 44C84 48 98 62 104 84C98 88 92 82 88 74Z" fill="#fff" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/><path d="M34 62C46 58 70 58 84 64" stroke="${f}" stroke-width="5"/><circle cx="104" cy="88" r="6" fill="${RED}" stroke="${INK}" stroke-width="2"/>`,
  }[kind];
  const zz = shut ? `<text class="zz" x="90" y="34" ${Z} font-size="20" fill="${INK}" opacity=".5">z</text>` : '';
  const cushion = kind === 'pip' ? `<ellipse cx="60" cy="140" rx="40" ry="9" fill="${f}" stroke="${INK}" stroke-width="2.2"/>` : '';
  return `<svg viewBox="${o.vb ?? '0 0 120 150'}" xmlns="http://www.w3.org/2000/svg">${o.floor === false ? '' : `<ellipse cx="60" cy="143" rx="34" ry="3.5" fill="${INK}" opacity=".1"/>`}${cushion}`
    + `<g class="body"><path d="${body}" fill="${f}" stroke="${INK}" stroke-width="${lw}" stroke-linejoin="round"/><g class="eyes">${eyes}</g>${prop}</g>${zz}</svg>`;
}

/** Head and shoulders, for faces and avatars: square crops of the same drawings. */
export const headSvg = (who: Kind | 'chief', mood: Mood | Pose = 'idle', night = false) =>
  who === 'chief' ? chiefSvg(mood, { vb: '30 28 140 140', floor: false, night }) : beanSvg(who, mood, { vb: '8 26 104 104', floor: false });

// ── The crew's colours: the bean's pastel and the tile behind a face ──
export type Kind = 'reel' | 'scout' | 'scribe' | 'tracer' | 'pip' | 'bow' | 'cap' | 'specs' | 'scarf';
export const PALS: Record<Kind, { body: string; soft: string }> = {
  reel: { body: '#DCEBFF', soft: '#EDF4FF' },
  scout: { body: '#FFE3DB', soft: '#FFF1EC' },
  scribe: { body: '#FFF3C8', soft: '#FFF9E3' },
  tracer: { body: '#DDF4E6', soft: '#EEF9F2' },
  pip: { body: '#ECE6FF', soft: '#F5F2FF' },
  bow: { body: '#D4F3EF', soft: '#EAF9F7' },
  cap: { body: '#FFDDEA', soft: '#FFEEF4' },
  specs: { body: '#F1E4D3', soft: '#F8F1E8' },
  scarf: { body: '#E8F4CC', soft: '#F3F9E5' },
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
/** The quiet mark beside an empty list, and the one ornament the ASCII moments share. */
export const ORNAMENT = '·  ✦  ·';
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
