// Draws the phone office's still room, the Studio, into mobile/assets/office/: the room itself (walls, windows,
// floor, bookshelf, Chief's nook) and the pieces that stand between the characters — a desk, each helper's
// partition, a floor pool of shadow (or lamplight at night), the sofa, the tray table and the armchair's near arm.
// Day and night each get their own set. The floor plan is mobile/src/studio.ts; each piece's box on the stage goes
// to pieces.json beside the PNGs, drawn at slot 0 so the app moves it to any desk. The phone draws no SVG and moves
// nothing per frame, so the room is pictures and the crew stand in it (mobile/src/office.tsx).
// Run after changing the plan or a pal's colours: `node scripts/office.mjs` (needs ImageMagick's `magick`). The
// outputs are committed.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { HOUSE, HOUSE_PAL, PALS } from '../web/src/art.ts';
import { GX, GY, HH, HW, OX, OY, P, SLOTS, STAGE, TRAY, WALL } from '../mobile/src/studio.ts';

const out = new URL('../mobile/assets/office/', import.meta.url).pathname;
const SCALE = 1.25; // pixels per stage point: sharp at the phone's size on a 3x screen
const THEMES = {
  day: {
    back: '#F3F1EE', warm: '#FFF1DC', floor: '#EBCDA5', plank: '#C99E70', wallR: '#F7EFE4', wallL: '#EFE3D3', cap: '#FFFDF9', skirt: '#E0CDB5',
    wood: '#DDB07D', wood2: '#C38F5A', wood3: '#A8774A', desk: '#F4E6D2', desk2: '#E2CDB0', desk3: '#CDB393',
    rug: '#F6DCD3', rugEdge: '#EBB9AB', nook: '#D5EBD8', nookEdge: '#A9D2B1', green: '#57A874', green2: '#468F60', green3: '#357450',
    sky1: '#BFDDFF', sky2: '#FFF1D6', frame: '#FFFFFF', beam: ['#FFCE8C', 0.34], lamp: null, metal: '#57525F', metal2: '#413D48',
    shadow: ['#54341A', 0.16], sofa: '#F4B7B0', sofa2: '#E59C95', sofa3: '#CF857E', leaves: ['#57A874', '#6CBE88', '#468F60'], pot: ['#E9DCCB', '#D9C6AE', '#C4AE92'], books: 1,
  },
  night: {
    back: '#151418', warm: '#2B2319', floor: '#4A3A2E', plank: '#33281F', wallR: '#2C2936', wallL: '#25222F', cap: '#3A3745', skirt: '#1B1922',
    wood: '#6A503A', wood2: '#54402F', wood3: '#433326', desk: '#4A4250', desk2: '#3C3542', desk3: '#312B37',
    rug: '#4A3440', rugEdge: '#634A56', nook: '#2A3A30', nookEdge: '#3A5242', green: '#3F7D57', green2: '#336A48', green3: '#28553A',
    sky1: '#0E1836', sky2: '#243562', frame: '#3A3746', beam: ['#96AFFF', 0.07], lamp: ['#FFBA68', 0.34], metal: '#6C6776', metal2: '#55505E',
    shadow: ['#000000', 0.34], sofa: '#7A4C57', sofa2: '#663F49', sofa3: '#54343C', leaves: ['#2F6B46', '#3E8458', '#28553A'], pot: ['#6E6558', '#5E5649', '#4D463B'], books: 0.7,
  },
};

// ---------- drawing ----------
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
/** a blended toward b by f (0 = a, 1 = b), like CSS color-mix. */
const mix = (a, b, f) => '#' + hex(a).map((v, i) => Math.round(v * (1 - f) + hex(b)[i] * f).toString(16).padStart(2, '0')).join('');
const shade = (c, k) => mix(c, '#000000', k / 100);
let pts = [];
const pt = (gx, gy, z) => { const p = P(gx, gy, z); pts.push(p); return p; };
const poly = (fill, ...ps) => `<polygon points="${ps.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' ')}" fill="${fill}"/>`;
function box(x0, x1, y0, y1, z0, z1, top, left = shade(top, 10), right = shade(top, 20)) {
  return poly(left, pt(x0, y1, z0), pt(x1, y1, z0), pt(x1, y1, z1), pt(x0, y1, z1))
    + poly(right, pt(x1, y0, z0), pt(x1, y1, z0), pt(x1, y1, z1), pt(x1, y0, z1))
    + poly(top, pt(x0, y0, z1), pt(x1, y0, z1), pt(x1, y1, z1), pt(x0, y1, z1));
}
// flat drawing on a wall-like plane: gy = const faces down-left, gx = const faces down-right
const onGY = (gy, inner) => `<g transform="matrix(1 .5 0 1 ${OX - gy * HW} ${OY + gy * HH})">${inner}</g>`;
const onGX = (gx, inner) => `<g transform="matrix(-1 .5 0 1 ${OX + gx * HW} ${OY + gx * HH})">${inner}</g>`;
const reg = (gx0, gx1, gy0, gy1, z0, z1) => { pt(gx0, gy0, z0); pt(gx1, gy1, z1); pt(gx0, gy1, z1); pt(gx1, gy0, z0); pt(gx0, gy0, z1); pt(gx1, gy1, z0); };
const defs = (c) => `<defs>
  <radialGradient id="soft"><stop offset="0" stop-color="${c.shadow[0]}" stop-opacity="${c.shadow[1]}"/><stop offset="1" stop-color="${c.shadow[0]}" stop-opacity="0"/></radialGradient>
  ${c.lamp ? `<radialGradient id="glow"><stop offset="0" stop-color="${c.lamp[0]}" stop-opacity="${c.lamp[1]}"/><stop offset="1" stop-color="${c.lamp[0]}" stop-opacity="0"/></radialGradient>` : ''}
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.sky1}"/><stop offset="1" stop-color="${c.sky2}"/></linearGradient>
  <linearGradient id="beam" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.beam[0]}" stop-opacity="${c.beam[1]}"/><stop offset="1" stop-color="${c.beam[0]}" stop-opacity="0"/></linearGradient>
  <radialGradient id="warm" cx=".3" cy=".1" r=".8"><stop offset="0" stop-color="${c.warm}"/><stop offset=".7" stop-color="${c.back}"/></radialGradient>
</defs>`;
const plant = (c, gx, gy, h, big) => {
  let g = box(gx - 0.22, gx + 0.22, gy - 0.22, gy + 0.22, 0, big ? 30 : 22, ...c.pot);
  const [x, y] = pt(gx, gy, big ? 30 : 22);
  for (let k = 0; k < (big ? 9 : 6); k++) {
    const a = -Math.PI / 2 + (k - (big ? 4 : 2.5)) * 0.34, L = h * (0.6 + (k % 3) * 0.18), ex = x + Math.cos(a) * L * 0.5, ey = y + Math.sin(a) * L * 0.5;
    g += `<ellipse cx="${ex.toFixed(2)}" cy="${ey.toFixed(2)}" rx="${big ? 9 : 7}" ry="${(L * 0.5).toFixed(2)}" transform="rotate(${(a * 180 / Math.PI + 90).toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)})" fill="${c.leaves[k % 3]}"/>`;
  }
  pts.push([x, y - h * 1.1], [x - h * 0.6, y], [x + h * 0.6, y]);
  return g;
};

// ---------- the room: everything that is always behind the crew ----------
function room(c, night) {
  let f = `<rect width="${STAGE.w}" height="${STAGE.h}" fill="url(#warm)"/>`;
  f += poly(c.wallL, P(0, 0, 0), P(0, GY, 0), P(0, GY, WALL), P(0, 0, WALL));
  f += poly(c.wallR, P(0, 0, 0), P(GX, 0, 0), P(GX, 0, WALL), P(0, 0, WALL));
  f += poly(c.skirt, P(0, 0, 0), P(0, GY, 0), P(0, GY, 9), P(0, 0, 9));
  f += poly(c.skirt, P(0, 0, 0), P(GX, 0, 0), P(GX, 0, 9), P(0, 0, 9));
  f += poly(c.cap, P(0, 0, WALL), P(0, GY, WALL), P(-0.2, GY, WALL), P(-0.2, -0.2, WALL), P(GX, -0.2, WALL), P(GX, 0, WALL));
  f += poly(shade(c.wallL, 12), P(-0.2, GY, WALL), P(0, GY, WALL), P(0, GY, 0), P(-0.2, GY, 0));
  f += poly(shade(c.wallR, 18), P(GX, -0.2, WALL), P(GX, 0, WALL), P(GX, 0, 0), P(GX, -0.2, 0));
  // windows along the back wall: sky with clouds by day, stars and a moon by night
  const wins = [[1.7, 3.5], [4.5, 6.3], [7.3, 9.1], [10.1, 11.9]];
  wins.forEach(([a, b], i) => {
    const u0 = a * HW, w = (b - a) * HW;
    let sky = '';
    if (night) {
      for (let k = 0; k < 7; k++) sky += `<circle cx="${u0 + 8 + ((k * 37 + i * 13) % (w - 16))}" cy="${-150 + ((k * 23 + i * 7) % 46)}" r="${k % 3 ? 1 : 1.6}" fill="#fff" fill-opacity="${k % 2 ? 0.5 : 0.85}"/>`;
      if (i === 1) sky += `<circle cx="${u0 + w * 0.7}" cy="-138" r="9" fill="#FFF3D6"/><circle cx="${u0 + w * 0.7 + 4}" cy="-141" r="8" fill="${c.sky1}"/>`;
    } else sky += `<ellipse cx="${u0 + w * 0.35}" cy="-126" rx="16" ry="5" fill="#fff" fill-opacity=".85"/><ellipse cx="${u0 + w * 0.45}" cy="-130" rx="10" ry="5" fill="#fff" fill-opacity=".85"/>`;
    f += onGY(0, `<rect x="${u0 - 4}" y="-164" width="${w + 8}" height="72" rx="3" fill="${c.frame}"/>
      <rect x="${u0}" y="-160" width="${w}" height="64" rx="2" fill="url(#sky)"/>${sky}
      <rect x="${u0 + w / 2 - 1.5}" y="-160" width="3" height="64" fill="${c.frame}"/>
      <rect x="${u0}" y="-129" width="${w}" height="2.5" fill="${c.frame}"/>
      <rect x="${u0 - 6}" y="-94" width="${w + 12}" height="4" rx="1" fill="${shade(c.frame, 8)}"/>`);
  });
  // a clock between the windows, the door by Chief's nook, and the dot-house picture on the left wall
  f += onGY(0, `<circle cx="${4 * HW}" cy="-130" r="12" fill="${c.frame}" stroke="${shade(c.wallR, 22)}" stroke-width="2"/>
    <line x1="${4 * HW}" y1="-130" x2="${4 * HW}" y2="-138" stroke="#56525D" stroke-width="2" stroke-linecap="round"/>
    <line x1="${4 * HW}" y1="-130" x2="${4 * HW + 6}" y2="-128" stroke="#56525D" stroke-width="2" stroke-linecap="round"/>`);
  f += onGX(0, `<rect x="${4.7 * HW}" y="-122" width="${1.2 * HW}" height="122" rx="3" fill="${c.wood2}"/>
    <rect x="${4.7 * HW + 6}" y="-114" width="${1.2 * HW - 12}" height="48" rx="3" fill="${c.wood}"/>
    <rect x="${4.7 * HW + 6}" y="-60" width="${1.2 * HW - 12}" height="52" rx="3" fill="${c.wood}"/>
    <circle cx="${4.7 * HW + 9}" cy="-58" r="3" fill="#E8C35A"/>`);
  let house = '';
  HOUSE.forEach((r, y) => [...r].forEach((ch, x) => { if (HOUSE_PAL[ch]) house += `<circle cx="${(3.2 * HW + 10 + x * 4.2).toFixed(2)}" cy="${(-150 + y * 4.2).toFixed(2)}" r="1.7" fill="${HOUSE_PAL[ch]}"/>`; }));
  f += onGX(0, `<rect x="${3.2 * HW}" y="-160" width="${12 * 4.2 + 20}" height="${11 * 4.2 + 20}" rx="3" fill="${c.frame}" stroke="${shade(c.wallL, 20)}" stroke-width="3"/>${house}`);
  // the floor, its planks, and the light from the windows
  f += poly(c.floor, P(0, 0, 0), P(GX, 0, 0), P(GX, GY, 0), P(0, GY, 0));
  for (let y = 0.5; y < GY; y += 0.5) {
    const [a, b] = [P(0, y), P(GX, y)];
    f += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${c.plank}" stroke-width="1" stroke-opacity=".45"/>`;
    for (let k = 0; k < 3; k++) { const x = ((y * 7.3 + k * 4.1) % (GX - 1)) + 0.5, [p, q] = [P(x, y - 0.5), P(x, y)]; f += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${c.plank}" stroke-opacity=".35"/>`; }
  }
  wins.forEach(([a, b]) => { f += poly('url(#beam)', P(a + 0.4, 0.05), P(b + 0.4, 0.05), P(b + 1.6, 2.8), P(a + 1.6, 2.8)); });
  f += poly(c.rugEdge, P(4.1, 3.3), P(9.5, 3.3), P(9.5, 6.7), P(4.1, 6.7));
  f += poly(c.rug, P(4.3, 3.5), P(9.3, 3.5), P(9.3, 6.5), P(4.3, 6.5));
  for (let x = 4.8; x < 9; x += 0.55) for (const y of [3.8, 6.2]) { const p = P(x, y); f += `<circle cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="2" fill="${c.rugEdge}"/>`; }
  if (night) { const p = P(1.2, 7.0); f += `<ellipse cx="${p[0]}" cy="${p[1]}" rx="170" ry="80" fill="url(#glow)"/>`; }
  // the bookshelf on the left wall
  f += box(0, 0.45, 1.0, 3.0, 0, 96, c.wood, shade(c.wood, 8), shade(c.wood, 18));
  const cols = ['#ff7aa2', '#a9cbff', '#ffc27a', '#b5ecc4', '#d9c2ff', '#ffe38f'];
  let books = '';
  [18, 50].forEach((z0, row) => {
    let g = 1.12;
    for (let k = 0; g < 2.85; k++) {
      const w = 0.14 + ((k * 7 + row) % 3) * 0.05, h = 22 + ((k * 5 + row) % 3) * 4;
      books += `<rect x="${(g * HW).toFixed(2)}" y="${-(z0 + h)}" width="${(w * HW - 1.5).toFixed(2)}" height="${h}" rx="1" fill="${cols[(k + row * 2) % cols.length]}" fill-opacity="${c.books}"/>`;
      g += w + 0.02;
    }
    books += `<rect x="${1.02 * HW}" y="${-z0}" width="${1.96 * HW}" height="3" fill="${c.wood3}"/>`;
  });
  f += onGX(0.45, books);
  f += plant(c, 0.55, 0.55, 70, true) + plant(c, 12.4, 5.4, 56, true);
  // Chief's nook: a raised platform, the standing lamp, the armchair's back, far arm and seat, and a side table
  f += box(0, 2.9, 6.1, GY, 0, 12, c.wood, c.wood2, c.wood3);
  f += poly(c.nookEdge, P(0.2, 6.3, 12), P(2.7, 6.3, 12), P(2.7, 8.8, 12), P(0.2, 8.8, 12));
  f += poly(c.nook, P(0.3, 6.4, 12), P(2.6, 6.4, 12), P(2.6, 8.7, 12), P(0.3, 8.7, 12));
  const [lx, ly] = P(0.45, 6.5, 12), top = ly - 118;
  f += `<ellipse cx="${lx}" cy="${ly}" rx="10" ry="4" fill="${c.metal2}"/><rect x="${lx - 1.5}" y="${top}" width="3" height="118" fill="${c.metal}"/>`;
  if (night) f += `<circle cx="${lx}" cy="${top + 6}" r="60" fill="url(#glow)"/>`;
  f += `<path d="M${lx - 17} ${top + 14} L${lx - 10} ${top - 12} L${lx + 10} ${top - 12} L${lx + 17} ${top + 14} Z" fill="${night ? '#FFD9A0' : '#FFF4E2'}" stroke="${night ? '#E8B46A' : '#E9D8BE'}" stroke-width="1.5"/>`;
  f += box(0.72, 1.78, 6.75, 7.0, 12, 58, c.green, c.green2, c.green3);
  f += box(0.72, 0.94, 7.0, 8.05, 12, 44, c.green, c.green2, c.green3);
  f += box(0.94, 1.56, 7.0, 8.05, 12, 30, c.green, c.green2, c.green3);
  const [tx0, ty0] = P(2.35, 6.75, 12), [tx, ty] = P(2.35, 6.75, 42);
  f += `<ellipse cx="${tx0}" cy="${ty0}" rx="12" ry="5" fill="${c.wood3}"/><rect x="${tx - 2}" y="${ty}" width="4" height="30" fill="${c.wood3}"/>`;
  f += `<ellipse cx="${tx}" cy="${ty + 2}" rx="26" ry="12" fill="${c.wood2}"/><ellipse cx="${tx}" cy="${ty}" rx="26" ry="12" fill="${c.wood}"/>`;
  f += `<rect x="${tx - 6}" y="${ty - 11}" width="11" height="10" rx="2" fill="#fff"/><path d="M${tx + 5} ${ty - 9} q5 1 0 6" stroke="#fff" stroke-width="2" fill="none"/><ellipse cx="${tx - 0.5}" cy="${ty - 11}" rx="5.5" ry="1.6" fill="#B07A4E"/>`;
  return f;
}

// ---------- the pieces, each drawn at slot 0 (the app moves them to their desk) ----------
const [cx, cy] = SLOTS[0];
const pieces = {
  // a pool under a desk: its contact shadow, and the desk lamp's light at night
  pool: (c, night) => {
    const s = P(cx, cy), l = P(cx + 0.9, cy + 0.4);
    pts.push([s[0] - 96, s[1] - 34], [s[0] + 96, s[1] + 34]);
    if (night) pts.push([l[0] - 120, l[1] - 52], [l[0] + 120, l[1] + 52]);
    return `<ellipse cx="${s[0]}" cy="${s[1]}" rx="96" ry="34" fill="url(#soft)"/>${night ? `<ellipse cx="${l[0]}" cy="${l[1]}" rx="120" ry="52" fill="url(#glow)"/>` : ''}`;
  },
  desk: (c) => {
    let g = box(cx - 1.0, cx + 1.0, cy - 0.5, cy + 0.5, 0, 28, c.desk, c.desk2, c.desk3);
    g += poly(shade(c.desk, 5), pt(cx - 1.0, cy + 0.5, 28), pt(cx + 1.0, cy + 0.5, 28), pt(cx + 1.0, cy + 0.5, 25), pt(cx - 1.0, cy + 0.5, 25));
    const [sx, sy] = pt(cx + 0.6, cy - 0.25, 28);
    g += `<ellipse cx="${sx}" cy="${sy}" rx="10" ry="4" fill="${c.metal2}"/><rect x="${sx - 2}" y="${sy - 12}" width="4" height="12" fill="${c.metal}"/>`;
    return g + box(cx + 0.2, cx + 0.98, cy - 0.3, cy - 0.24, 38, 76, c.metal2, c.metal2, c.metal);
  },
  sofa: (c) => box(2.6, 4.4, 4.6, 4.85, 0, 44, c.sofa, c.sofa2, c.sofa3)
    + box(2.6, 4.4, 4.85, 5.7, 0, 20, c.sofa, c.sofa2, c.sofa3)
    + box(2.6, 2.85, 4.85, 5.7, 0, 32, c.sofa, c.sofa2, c.sofa3)
    + box(4.15, 4.4, 4.85, 5.7, 0, 32, c.sofa, c.sofa2, c.sofa3)
    + box(3.2, 3.7, 4.95, 5.25, 20, 32, '#FFE38F', '#EFCB63', '#D9B24A'),
  // the armchair's near arm, in front of Chief
  arm: (c) => box(1.56, 1.78, 7.0, 8.05, 12, 44, c.green, c.green2, c.green3),
  // the tray table at the front, with the small plant beside it
  tray: (c) => {
    const [x, y] = TRAY;
    let g = box(x - 1.6, x + 1.6, y - 0.5, y + 0.5, 0, 34, c.wood, c.wood2, c.wood3);
    g += poly(shade(c.wood, 6), pt(x - 1.48, y - 0.4, 34), pt(x + 1.48, y - 0.4, 34), pt(x + 1.48, y + 0.4, 34), pt(x - 1.48, y + 0.4, 34));
    g += poly(c.wood, pt(x - 1.42, y - 0.34, 34), pt(x + 1.42, y - 0.34, 34), pt(x + 1.42, y + 0.34, 34), pt(x - 1.42, y + 0.34, 34));
    return g + plant(c, 12.5, 8.3, 40, false);
  },
};
// a partition behind a back-row desk, in its helper's colour (dimmed at night)
for (const [kind, p] of Object.entries(PALS)) {
  pieces[`wall-${kind}`] = (c, night) => {
    const fabric = night ? mix(p.soft, '#1A1720', 0.72) : p.soft;
    return box(cx - 1.05, cx + 1.05, cy - 1.6, cy - 1.5, 0, 94, fabric, shade(fabric, 6), shade(fabric, 16))
      + poly(shade(fabric, 22), pt(cx - 1.05, cy - 1.5, 94), pt(cx + 1.05, cy - 1.5, 94), pt(cx + 1.05, cy - 1.5, 90), pt(cx - 1.05, cy - 1.5, 90));
  };
}

// ---------- write ----------
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const boxes = {};
const png = (name, [x0, y0, w, h], body, c) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * SCALE)}" height="${Math.round(h * SCALE)}" viewBox="${x0} ${y0} ${w} ${h}">${defs(c)}${body}</svg>\n`;
  writeFileSync(`${out}${name}.svg`, svg);
  execFileSync('magick', ['-background', 'none', `${out}${name}.svg`, '-depth', '8', '-strip', `PNG32:${out}${name}.png`]);
  rmSync(`${out}${name}.svg`);
  boxes[name] = [x0, y0, w, h];
};
for (const [theme, c] of Object.entries(THEMES)) {
  const night = theme === 'night';
  png(`room-${theme}`, [0, 0, STAGE.w, STAGE.h], room(c, night), c);
  for (const [name, draw] of Object.entries(pieces)) {
    pts = [];
    const body = draw(c, night);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.floor(Math.min(...xs) - 6), y0 = Math.floor(Math.min(...ys) - 6);
    png(`${name}-${theme}`, [x0, y0, Math.ceil(Math.max(...xs) + 6) - x0, Math.ceil(Math.max(...ys) + 6) - y0], body, c);
  }
}
writeFileSync(`${out}pieces.json`, `{\n${Object.entries(boxes).map(([k, v]) => ` "${k}": ${JSON.stringify(v)}`).join(',\n')}\n}\n`);
console.log(`office room written into ${out}`);
