// The mascot family as data: dot bitmaps for Chief, the pals and the logo, and the ASCII brand moments
// (the block-letter boot splash, Chief's laptop, confetti). Framework-free, so the Expo app draws the same art:
// a bitmap is an array of equal-width strings, '.' is an unlit dot, any other letter indexes a palette.

export type Mood = 'idle' | 'blink' | 'twitch' | 'hello' | 'happy' | 'work' | 'ask' | 'listen' | 'rest' | 'worried' | 'error';
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

// Little signs beside a face: a sparkle when done, z's asleep, a sweat drop, sound, a polite "!".
const SPARKLE = [' * ', '***', ' * '], ZZ = ['ZZ ', ' Z ', 'ZZ ', '   ', 'zz', ' z', 'zz'], SWEAT = [' d', 'dd', 'dd'];
const SOUND = [' l', '  l', '  l', ' l'], BANG = ['t', 't', 't', ' ', 't'];
const SIGNS: Palette = { '*': '#ffc23c', z: '#b9b3d4', Z: '#8f88b0', d: '#6aa8ff', l: '#ff7aa2', t: '#ff5f87', k: '#c2475f', c: '#ff9bb3', e: '#2e2a40' };

// ── Chief, the Gentleman: a round portrait head, 22×23 dots. Big eyes low on the face, brows that act, a walrus
// handlebar that is his mouth (up when pleased, down when not) and a bowler he raises when he needs you, puts a
// monocle in to work, and pulls over his eyes to rest. Every dot is placed by hand. ──
export const CHIEF_PAL: Palette = { ...SIGNS, h: '#3b3552', H: '#6a6190', b: '#ff7aa2', y: '#ffd9a8', n: '#eba277', m: '#7a4b35', s: '#ffffff', T: '#c2475f', g: '#ffc23c' };
/** At night his bowler catches the light, or it would vanish into the dark. */
export const CHIEF_PAL_NIGHT: Palette = { ...CHIEF_PAL, h: '#6a5a9a', H: '#9c8cd0', e: '#1d1929' };
const HEAD = [
  '       yyyyyy', '      yyyyyyyy', '    yyyyyyyyyyyy', '   yyyyyyyyyyyyyy', '  yyyyyyyyyyyyyyyy', '  yyyyyyyyyyyyyyyy',
  ' yyyyyyyyyyyyyyyyyy', ' yyyyyyyyyyyyyyyyyy', ' yyyyyyyyyyyyyyyyyy', ' yyyyyyyyyyyyyyyyyy', ' yyyyyyyyyyyyyyyyyy', ' yyyyyyyyyyyyyyyyyy',
  '  yyyyyyyyyyyyyyyy', '  yyyyyyyyyyyyyyyy', '   yyyyyyyyyyyyyy', '    ssyyyyyyyyss', '   sssttsTTsttsss', '    sstt    ttss',
];
const HAT = ['       hhhhhh', '      hhhhhhhh', '      hHhhhhhh', '      hHhhhhhh', '      bbbbbbbb', '  hhhhhhhhhhhhhhhh'];
// Content is a ∪: ends curled up, the lowest dots in the centre, no lobes — six faces smile through it. Pleased curls
// deeper, across the whole face; the flat bar is worried; the ∩ stays for sad and rest alone.
const MO = {
  idle: ['  m              m', '  mm   mmmmmm   mm', '   mmmmmmmmmmmmmm', '      mmmmmmmm'],
  up: [' m                m', '  mm            mm', '   mmmmmmmmmmmmmm', '     mmmmmmmmmm', '       mmmmmm'],
  flat: ['     mmmmmmmmmm', '  mm  mmmmmmmm  mm'],
  down: ['       mmmmmmmm', '   mmmmmmmmmmmmmm', '  mm            mm', '  m              m'],
};
const CHEEK = '  c      nn      c';
/** One face per mood, from head row 3 down. Column ruler: 01234567890123456789. */
const FACES: Record<Mood, string[]> = {
  idle: ['', '    mmm      mmm', '', '     ee      ee', '     ee      ee', CHEEK, ...MO.idle],
  blink: ['', '    mmm      mmm', '', '', '     ee      ee', CHEEK, ...MO.idle],
  twitch: ['', '    mmm      mmm', '', '     ee      ee', '     ee      ee', CHEEK, '  m    mmmmmm    m', ...MO.idle.slice(1)],
  work: ['', '             mmm', '    mmm      gg', '            geeg', '     ee     geeg', '  c      nn  gg  c', ...MO.idle],
  ask: ['    mmm      mmm', '', '     ee      ee', '     ee      ee', '     ee      ee', CHEEK, ...MO.idle, '         kk'],
  hello: ['    mmm      mmm', '', '', '     ee      ee', '     ee      ee', CHEEK, ...MO.up],
  happy: ['    mmm      mmm', '', '', '    e  e    e  e', '   e    e  e    e', '  cc     nn     cc', ...MO.up, '        kkkk'],
  listen: ['              mmm', '    mmm', '', '      ee      ee', '      ee      ee', CHEEK, ...MO.idle],
  rest: ['', '', '', '    e  e    e  e', '     ee      ee', CHEEK, ...MO.down],
  worried: ['      m      m', '    mm        mm', '', '    eee      eee', '    eee      eee', CHEEK, ...MO.flat],
  error: ['      m      m', '    mm        mm', '', '     ee      ee', '    e          e', CHEEK, ...MO.down, '        kkkk', '        k  k'],
};
export function chief(mood: Mood = 'idle', bob = 0): Bitmap {
  const lift = ({ ask: -2, hello: -2, rest: 2, error: -1 } as Record<string, number>)[mood] ?? 0; // raised to ask, over the eyes to rest, askew on error
  const hat: [number, number, string[]] = [mood === 'error' ? 2 : 1, 2 + bob + lift, HAT];
  const signs: [number, number, string[]][] = ({
    happy: [[0, 3, SPARKLE], [19, 1, SPARKLE], [19, 9, ['*']]], rest: [[18, 0, ZZ]], worried: [[19, 8, SWEAT]], listen: [[19, 10, SOUND]], ask: [[20, 0, BANG]],
  } as Record<string, [number, number, string[]][]>)[mood] ?? [];
  return draw(22, 23, [1, 5 + bob, HEAD], [1, 8 + bob, FACES[mood]], hat, ...signs);
}
/** The 12×13 cut for 48 px and below (the app icon, avatars, the list rows): hat, then eyes and mouth alone. Each mood
 *  gets its own simplified face, readable at thumbnail size where moustache detail is mush; a one-dot sign rides the
 *  edge for the moods a family member must tell at a glance (the "!" for needs-you, a sparkle for pleased). */
export function chiefSmall(mood: Mood = 'idle'): Bitmap {
  const eyes: [number, number, string[]] = ({
    happy: [2, 7, ['e e  e e']], blink: [2, 8, [' ee  ee']], rest: [2, 8, [' ee  ee']], listen: [2, 7, ['  e    e']],
    worried: [2, 7, ['eee  eee', 'eee  eee']], error: [2, 7, [' e    e', 'e      e']],
    work: [2, 7, [' ee  gg', ' ee  gg']],
  } as Record<string, [number, number, string[]]>)[mood] ?? [2, 7, [' ee  ee', ' ee  ee']];
  const mouth: [number, number, string[]] = ({
    happy: [1, 8, ['m........m', 'mmmmmmmmmm', '   k  k']], worried: [1, 9, ['mmmmmmmmmm']],
    error: [1, 9, ['  mmmmmm', 'm........m']], ask: [1, 9, ['  kkkk', '  k  k']],
    rest: [1, 9, [' mmmmmm']],
  } as Record<string, [number, number, string[]]>)[mood] ?? [1, 9, ['m........m', ' mmmmmmmm']];
  const sign: [number, number, string[]] | undefined = ({
    ask: [11, 2, ['t', 't', 't', ' ', 't']], happy: [11, 3, ['*']], worried: [11, 3, ['d', 'd']],
    rest: [11, 2, ['z']], listen: [11, 5, ['l', 'l']],
  } as Record<string, [number, number, string[]]>)[mood];
  const lift = mood === 'ask' || mood === 'hello' ? -1 : mood === 'rest' ? 1 : 0;
  return draw(12, 13, [0, 5, ['  yyyyyyyy', ' yyyyyyyyyy', ' yyyyyyyyyy', ' yyyyyyyyyy', ' yyyyyyyyyy', ' yyyyyyyyyy', '  yyyyyyyy', '    yyyy']],
    eyes, mouth, [mood === 'error' ? 1 : 0, 1 + lift, ['   hhhhhh', '   hhhhhh', '   bbbbbb', ' hhhhhhhhhh']], ...(sign ? [sign] : []));
}
/** The notification glyph: alpha-only, drawn as solid pixels (white on transparent) so it holds at 24 px. */
export const NOTIFY: Bitmap = [
  '...xxxxxx...', '..xxxxxxxx..', '..xxxxxxxx..', '............', 'xxxxxxxxxxxx', '............',
  '..xx....xx..', '..xx....xx..', 'x..........x', 'xx..xxxx..xx', '.xxxxxxxxxx.', '..xxx..xxx..',
];

// ── The pals: round heads that share Chief's face, one colour each and ONE shape that breaks the silhouette
// (film-reel ears, an explorer's helmet, an ink-drop point, a sprout, headphones), 18×17 dots ──
export type Kind = 'reel' | 'scout' | 'scribe' | 'tracer' | 'pip';
export const PALS: Record<Kind, { body: string; dark: string; soft: string }> = {
  reel: { body: '#ffb199', dark: '#e0664a', soft: '#ffe6dd' },
  scout: { body: '#a9cbff', dark: '#4d7fd6', soft: '#e3eeff' },
  scribe: { body: '#b5ecc4', dark: '#3f9d63', soft: '#e3f7e9' },
  tracer: { body: '#d9c2ff', dark: '#8a5fd6', soft: '#f0e8ff' },
  pip: { body: '#ffe38f', dark: '#d9a21c', soft: '#fff5d6' },
};
const PAL_SHAPES: Record<Kind, { ey: number; body: string[]; top: string[] }> = {
  reel: { ey: 10,
    body: ['', '', '', '', '', '       bbbb', '    bbbbbbbbbb', '   bbbbbbbbbbbb', '  bbbbbbbbbbbbbb', ' bbbbbbbbbbbbbbbb', ' bbbbbbbbbbbbbbbb', ' bbbbbbbbbbbbbbbb', ' bbbbbbbbbbbbbbbb', '  bbbbbbbbbbbbbb', '   bbbbbbbbbbbb', '    bbbbbbbbbb', '       bbbb'],
    top: ['', '   DD        DD', ' DDDDDD    DDDDDD', ' DDSSDD    DDSSDD', ' DDDDDD    DDDDDD', ' DSDDSD    DSDDSD', ' DDDDDD    DDDDDD', '  DDDD      DDDD'] },
  scout: { ey: 9,
    body: ['', '', '', '', '', '      bbbbbb', '     bbbbbbbb', '    bbbbbbbbbb', '   bbbbbbbbbbbb', '   bbbbbbbbbbbb', '   bbbbbbbbbbbb', '   bbbbbbbbbbbb', '   bbbbbbbbbbbb', '   bbbbbbbbbbbb', '    bbbbbbbbbb', '     bbbbbbbb', '       bbbb'],
    top: ['', '', '     DDDDDDDD', '    DDDSDDDDDD', '    DDDSDDDDDD', '    DDDDDDDDDD', ' DDDDDDDDDDDDDDDD'] },
  scribe: { ey: 10,
    body: ['', '        bb', '       bbbb', '       bbbb', '      bbbbbb', '     bbbbbbbb', '     bbbbbbbb', '   bbbbbbbbbbbb', '   bbbbbbbbbbbb', '  bbbbbbbbbbbbbb', '  bbbbbbbbbbbbbb', '  bbbbbbbbbbbbbb', '  bbbbbbbbbbbbbb', '   bbbbbbbbbbbb', '   bbbbbbbbbbbb', '     bbbbbbbb', '       bbbb'],
    top: ['', '         D', '         D', '         D'] },
  pip: { ey: 10,
    body: ['', '', '', '', '', '', '', '     bbbbbbbb', '    bbbbbbbbbb', '   bbbbbbbbbbbb', '   bbbbbbbbbbbb', '   bbbbbbbbbbbb', '   bbbbbbbbbbbb', '   bbbbbbbbbbbb', '    bbbbbbbbbb', '     bbbbbbbb', '      D    D'],
    top: ['', '          GG', '      GG GGGG', '     GGGG GG', '      GG G', '         G', '         G'] },
  tracer: { ey: 9,
    body: ['', '', '', '', '', '     bbbbbbbb', '    bbbbbbbbbb', '   bbbbbbbbbbbb', '  bbbbbbbbbbbbbb', '  bbbbbbbbbbbbbb', '  bbbbbbbbbbbbbb', '  bbbbbbbbbbbbbb', '  bbbbbbbbbbbbbb', '   bbbbbbbbbbbb', '    bbbbbbbbbb', '     bbbbbbbb', '        bb'],
    top: ['', '', '     DDDDDDDD', '   DDD      DDD', '  DD          DD', ' DD            DD', ' D              D', ' D              D', 'DDD            DDD', 'DDD            DDD', 'DDD            DDD', 'DDD            DDD'] },
};
const PAL_EYES: Record<Mood, string[]> = {
  idle: ['ee', 'ee'], blink: ['', 'ee'], twitch: ['ee', 'ee'], rest: ['', 'ee'], work: ['', 'ee', 'ee'], ask: ['ee', 'ee', 'ee'],
  hello: [' ee', 'e  e'], happy: [' ee', 'e  e'], listen: [' ee', ' ee'], worried: ['e', 'ee'], error: ['e', 'ee'],
};
const PAL_MOUTH: Partial<Record<Mood, string[]>> = { happy: ['k  k', ' kk'], ask: [' kk', ' kk'], error: [' kk', 'k  k'], listen: ['  e'] };
export function pal(kind: Kind, mood: Mood = 'idle'): Bitmap {
  const { ey, body, top } = PAL_SHAPES[kind];
  const a = 5, b = 11, off = mood === 'happy' || mood === 'hello' ? -1 : 0, y = mood === 'ask' ? ey - 1 : ey;
  const eyes: [number, number, string[]][] = mood === 'rest' ? [[a - 1, ey, ['e  e', ' ee']], [b - 1, ey, ['e  e', ' ee']]] : [[a + off, y, PAL_EYES[mood]], [b + off, y, PAL_EYES[mood]]];
  const signs: [number, number, string[]][] = ({
    happy: [[0, 2, SPARKLE], [15, 4, SPARKLE]], rest: [[15, 0, ZZ.slice(0, 3)]], worried: [[16, 6, SWEAT]], ask: [[17, 0, BANG]], listen: [[15, 8, SOUND]],
  } as Record<string, [number, number, string[]][]>)[mood] ?? [];
  return draw(18, 17, [0, 0, body], [0, mood === 'ask' ? -1 : 0, top], ...eyes, [7, ey + 3, PAL_MOUTH[mood] ?? [' ee']], [a - 2, ey + 2, ['c']], [b + 3, ey + 2, ['c']], ...signs);
}
export const palPalette = (kind: Kind): Palette => ({ ...SIGNS, b: PALS[kind].body, D: PALS[kind].dark, S: PALS[kind].soft, G: '#5fc27e' });

// ── The logo: a dot house with a smile, and the wordmark in the same dots ──
export const HOUSE: Bitmap = [
  '.....rr.....', '....rrrr....', '...rrrrrr...', '..rrrrrrrr..', '.rrrrrrrrrr.', '..pppppppp..',
  '..ppeppepp..', '..ppeppepp..', '..pmppppmp..', '..ppmmmmpp..', '..pppppppp..',
];
export const HOUSE_PAL: Palette = { r: '#ff7aa2', p: '#ffc27a', e: '#3b3552', m: '#3b3552' };

/** The phone's tab bar, 9×9 dots each, one colour (the tab's ink): the same on every phone, unlike a font's glyphs. */
export type Tab = 'chats' | 'crew' | 'things' | 'routines' | 'phone';
export const TABS: Record<Tab, Bitmap> = {
  chats: ['....x....', '...x.x...', '..x...x..', '.x.....x.', 'xxxxxxxxx', '.x.....x.', '.x.xxx.x.', '.x.x.x.x.', '.xxx.xxx.'],
  crew: ['..xxxxx..', '.x.....x.', 'x..x.x..x', 'x..x.x..x', 'x.......x', 'x.x...x.x', 'x..xxx..x', '.x.....x.', '..xxxxx..'],
  things: ['xxxxxxxxx', 'x.......x', 'x.xxxxx.x', 'x.......x', 'x.xxxxx.x', 'x.......x', 'x.xxx...x', 'x.......x', 'xxxxxxxxx'],
  routines: ['..xxxxx.x', '.x.....xx', 'x.....xxx', 'x........', 'x.......x', '........x', 'xxx.....x', 'xx.....x.', 'x.xxxxx..'],
  phone: ['..xxxxx..', '..x...x..', '..x...x..', '..x...x..', '..x...x..', '..x...x..', '..xxxxx..', '..x.x.x..', '..xxxxx..'],
};

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
