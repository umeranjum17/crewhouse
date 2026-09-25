// The mascot family as data: dot bitmaps for Chief, the pals and the logo, and the ASCII brand moments
// (the block-letter boot splash, Chief's laptop, confetti). Framework-free, so the Expo app draws the same art:
// a bitmap is an array of equal-width strings, '.' is an unlit dot, any other letter indexes a palette.

export type Mood = 'idle' | 'blink' | 'happy' | 'work' | 'ask' | 'rest';
export type Bitmap = string[];
export type Palette = Record<string, string>;

const pad = (rows: string[], w: number) => rows.map((r) => (r + '.'.repeat(w)).slice(0, w));

// ── Chief: a round dot gentleman with a bowler, moustache and bow tie ──
export const CHIEF_PAL: Palette = { h: '#3b3552', H: '#5a5275', y: '#ffd9a0', e: '#3b3552', c: '#ff9bb3', m: '#6b4a3a', w: '#ffffff', b: '#ff7aa2' };
/** At night his bowler catches the light, or it would vanish into the dark. */
export const CHIEF_PAL_NIGHT: Palette = { ...CHIEF_PAL, h: '#6a5a9a', H: '#9c8cd0' };
export function chief(mood: Mood = 'idle'): Bitmap {
  const eyes = {
    idle: ['.yyyeyyyyeyyy.', '.yyyeyyyyeyyy.'],
    blink: ['.yyyyyyyyyyyy.', '.yyeeyyyyeeyy.'],
    happy: ['.yyeyeyyeyeyy.', '.yyyyyyyyyyyy.'],
    work: ['.yyyyyyyyyyyy.', '.yyyeyyyyeyyy.'],
    ask: ['.yyyeyyyyeyyy.', '.yyyeyyyyeyyy.'],
    rest: ['.yyyyyyyyyyyy.', '.yyeeyyyyeeyy.'],
  }[mood];
  return pad([
    '.....hhhh.....', '....hhhhhh....', '....hHhhhh....', '....bbbbbb....', '..hhhhhhhhhh..',
    '...yyyyyyyy...', '..yyyyyyyyyy..', eyes[0], eyes[1], '.ycyyyyyyyycy.',
    '.yyymmmmmmyyy.', '.yymmyyyymmyy.', '..yyyyyyyyyy..', '...yyyyyyyy...',
    '....wwbbww....', '...wwwbbwww...',
  ], 14);
}

// ── The pals: one blob shape, two dot eyes, a colour and an accessory each ──
export type Kind = 'reel' | 'scout' | 'scribe' | 'tracer' | 'pip';
export const PALS: Record<Kind, { body: string; dark: string; soft: string }> = {
  reel: { body: '#ffb199', dark: '#e0664a', soft: '#ffe6dd' },
  scout: { body: '#a9cbff', dark: '#4d7fd6', soft: '#e3eeff' },
  scribe: { body: '#b5ecc4', dark: '#3f9d63', soft: '#e3f7e9' },
  tracer: { body: '#d9c2ff', dark: '#8a5fd6', soft: '#f0e8ff' },
  pip: { body: '#ffe38f', dark: '#d9a21c', soft: '#fff5d6' },
};
const HATS: Record<Kind, string[]> = {
  reel: ['..dd....dd..', '.dwwd..dwwd.', '..dd....dd..'], // film-reel ears
  scout: ['............', '...dddddd...', '..dddddddd..'], // a cap
  scribe: ['.........d..', '........d...', '.......d....'], // a pencil
  tracer: ['............', '..dd....dd..', '...dddddd...'], // a headset
  pip: ['..d......d..', '...d....d...', '....dddd....'], // antennae
};
export function pal(kind: Kind, mood: Mood = 'idle'): Bitmap {
  const eyes = mood === 'happy' ? ['.beebbbbeeb.', '.bbbbbbbbbb.']
    : mood === 'blink' || mood === 'rest' ? ['.bbbbbbbbbb.', '.bbeebbeebb.'] : ['.bbebbbbebb.', '.bbebbbbebb.'];
  const mouth = mood === 'ask' ? '.bbbbmbbbbb.' : mood === 'happy' ? '.bbbmmmmbbb.' : '.bbbbmmbbbb.';
  return pad([...HATS[kind], '...bbbbbb...', '..bbbbbbbb..', eyes[0], eyes[1], '.bcbbbbbbcb.', mouth, '..bbbbbbbb..', '...bbbbbb...'], 12);
}
export const palPalette = (kind: Kind): Palette => ({ b: PALS[kind].body, d: PALS[kind].dark, e: '#3b3552', c: '#ff8fa8', m: '#3b3552', w: '#ffffff' });

// ── The logo: a dot house with a smile, and the wordmark in the same dots ──
export const HOUSE: Bitmap = [
  '.....rr.....', '....rrrr....', '...rrrrrr...', '..rrrrrrrr..', '.rrrrrrrrrr.', '..pppppppp..',
  '..ppeppepp..', '..ppeppepp..', '..pmppppmp..', '..ppmmmmpp..', '..pppppppp..',
];
export const HOUSE_PAL: Palette = { r: '#ff7aa2', p: '#ffc27a', e: '#3b3552', m: '#3b3552' };

const DOTFONT: Record<string, string[]> = {
  c: ['.....', '.....', '.###.', '#....', '#....', '#....', '.###.'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  h: ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#'],
  s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'],
};
/** "crew" in ink, "house" in pink. */
export const WORD: Bitmap = [0, 1, 2, 3, 4, 5, 6].map((y) => [...'crewhouse'].map((ch, i) => DOTFONT[ch][y].replace(/#/g, i < 4 ? 'a' : 'b')).join('.'));
export const WORD_PAL: Palette = { a: '#2e2a40', b: '#ff7aa2' };
export const WORD_PAL_NIGHT: Palette = { a: '#efe9dc', b: '#ff7aa2' };

// ── ASCII moments ──
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

/** Blend a gradient of hex stops at t in [0, 1]. */
export function mix(stops: string[], t: number) {
  const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const u = t * (stops.length - 1) - seg;
  const a = parseInt(stops[seg].slice(1), 16), b = parseInt(stops[seg + 1].slice(1), 16);
  return '#' + [16, 8, 0].map((s) => Math.round(((a >> s) & 255) * (1 - u) + ((b >> s) & 255) * u).toString(16).padStart(2, '0')).join('');
}

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
