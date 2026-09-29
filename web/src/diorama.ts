// The office as a tabletop diorama in real 3D: Chief and every helper as voxel figurines built from their own dot
// bitmaps (art.ts), each dot a rounded cube three layers deep, at a desk in one cut-away room. Loaded only by
// office.tsx's import(), so three.js is its own chunk and never delays Home's first paint.
//
// Battery rules (the office report, §7): render on demand, never a standing requestAnimationFrame loop. A frame is drawn
// when something changed; frames run back to back only while a tween or a drag is live. The one ambient motion — a
// stop-motion bob while a helper of yours works or needs you — is a 4-a-second timer that draws directly, and stops
// when the tab is hidden, the room is scrolled away, or nobody of yours is busy. An idle room draws nothing at all.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as art from './art.ts';
import type { FileView, OfficeMember } from './adapter.ts';
import type { Mood } from './art.ts';

/** What the room draws: the adapter's office rows (A.office), plus how many things landed in the tray today. */
export type Room = { chief: { mood: Mood }; crew: OfficeMember[]; doneToday: number };
export type Look = { night: boolean; phone: boolean };
export type Diorama = {
  /** Draw this room. A new cast, theme or frame rebuilds the scene; anything else animates from the last room. */
  show(room: Room, look: Look): void;
  /** Glide to one character (or back home with null), keeping them centred in what a side panel leaves uncovered. */
  focus(id: string | null, cover?: { right: number; bottom: number }): void;
  /** Re-place the overlay cards: call after they change size or move in the page. */
  wake(): void;
  dispose(): void;
};
/** Overlay cards pinned to 3D points: `<id>:head` above a character, `<id>:desk` on its desk, `<id>:feet` in front of it. */
export type Anchors = Map<string, HTMLElement>;

type Theme = Record<'floor' | 'slab' | 'wallB' | 'wallL' | 'trim' | 'rug' | 'desk' | 'leg' | 'mon' | 'stool' | 'arm' | 'armDark' | 'door' | 'wood' | 'pot' | 'leaf' | 'frame' | 'calm' | 'ringOk' | 'ringPink' | 'ringAway', string>
  & { hemi: [string, string, number]; key: [string, number] };
const PAL: { day: Theme; night: Theme } = {
  day: { floor: '#EAD9C4', slab: '#D8C0A2', wallB: '#FFF1DC', wallL: '#FBE3DA', trim: '#EBD3B8', rug: '#FFD3E0', desk: '#FFFFFF', leg: '#D9D2C8', mon: '#3B3552', stool: '#A9CBFF', arm: '#FF9BB3', armDark: '#E97B98', door: '#FF7AA2', wood: '#E7C9A3', pot: '#FFB199', leaf: '#5FC27E', frame: '#FFFFFF', calm: '#2E2A40',
    hemi: ['#FFF7EC', '#D9C4AA', 1.35], key: ['#FFF4E4', 2.1], ringOk: '#1E9A58', ringPink: '#D23369', ringAway: '#8B8792' },
  night: { floor: '#655A74', slab: '#2A2432', wallB: '#4A4268', wallL: '#41395E', trim: '#27222F', rug: '#5A3346', desk: '#4A4454', leg: '#2D2934', mon: '#15131A', stool: '#4D7FD6', arm: '#C2475F', armDark: '#9E3A50', door: '#C2475F', wood: '#5A4636', pot: '#B8664F', leaf: '#3F9D63', frame: '#524A64', calm: '#1C1924',
    hemi: ['#B4BCF2', '#3F3656', 1.7], key: ['#B8C2FF', 0.8], ringOk: '#4BD08A', ringPink: '#FF6B9A', ringAway: '#78747E' },
};
const VOX = 0.092;
/** Face features keep their colour only on the front layer; signs (!, sparkle, ZZ) stand a little proud, one layer. */
const FEAT = new Set([...'eckgnm']), SIGN = new Set([...'*zZdlt']);
const AMBIENT_MS = 250; // stop-motion at 4 frames a second
const CHEER_MS = 3800;

type Char = {
  id: string; kind: art.Kind | 'chief'; g: THREE.Group; fig: THREE.Group; mesh: THREE.InstancedMesh; baseY: number; height: number;
  shown: Mood | null; hit: THREE.Mesh; head: THREE.Object3D; feet: THREE.Object3D; desk: THREE.Object3D; phase: number; blinkAt: number; blinkEnd: number;
  ring?: THREE.Mesh; screen?: THREE.Mesh; screenKey?: string; things?: THREE.Group; c?: OfficeMember; cheerUntil: number; hop: boolean;
};
type Tween = { t0: number; dur: number; fn: (p: number) => void; done?: () => void };
type Cam = { yaw: number; pitch: number; dist: number; target: THREE.Vector3 };

const easeOut = (p: number) => 1 - Math.pow(1 - p, 4);
const bounce = (p: number) => { const n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375; return n * (p -= 2.625 / d) * p + 0.984375; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const busy = (c: OfficeMember) => c.ring === 'working' || c.ring === 'needs';

/** A dot bitmap as a canvas, round dots like the app's own `.dots`. */
function dotsCanvas(rows: art.Bitmap, pal: art.Palette, d: number) {
  const c = document.createElement('canvas');
  c.width = rows[0].length * d; c.height = rows.length * d;
  const g = c.getContext('2d')!;
  rows.forEach((r, y) => [...r].forEach((k, x) => { if (!pal[k]) return; g.fillStyle = pal[k]; g.beginPath(); g.arc(x * d + d / 2, y * d + d / 2, d * 0.44, 0, 7); g.fill(); }));
  return c;
}

/** Null when this screen has no WebGL: office.tsx then shows the still row instead. */
export function diorama(host: HTMLElement, anchors: Anchors, onPick: (id: string) => void, onLost: () => void): Diorama | null {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' }); } catch { return null; }
  if (!renderer.getContext()) return null;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  host.prepend(canvas);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  const v3 = new THREE.Vector3(), m4 = new THREE.Matrix4(), col = new THREE.Color();
  const cube = new RoundedBoxGeometry(VOX * 0.88, VOX * 0.88, VOX * 0.88, 1, VOX * 0.2);
  const ray = new THREE.Raycaster();

  let scene: THREE.Scene | null = null, T: Theme = PAL.day, look: Look = { night: false, phone: false };
  let room: Room | null = null, cast = '';
  let chars = new Map<string, Char>();
  let stack: THREE.Group | null = null, stackCount = 0, cabHit: THREE.Mesh | null = null;
  let size = { w: 1, h: 1 }, home: Cam | null = null, cam: Cam | null = null, off = { x: 0, y: 0 }, homeOff = { x: 0, y: 0 };
  const tweens = new Set<Tween>();
  let raf = 0, dragging = false, hidden = document.hidden, offscreen = false, ambT = 0, dead = false;

  // ---------- frames: on demand only ----------
  function wake() { if (scene && !raf && !hidden && !offscreen && !dead) raf = requestAnimationFrame(loop); }
  function loop(now: number) {
    raf = 0;
    for (const t of [...tweens]) { const p = Math.min(1, (now - t.t0) / t.dur); t.fn(p); if (p >= 1) { tweens.delete(t); t.done?.(); } }
    draw();
    if (tweens.size || dragging) raf = requestAnimationFrame(loop);
  }
  function tween(dur: number, fn: (p: number) => void, done?: () => void) { const t = { t0: performance.now(), dur, fn, done }; tweens.add(t); wake(); return t; }
  function draw() {
    if (!scene || !cam || hidden) return;
    clampCam();
    if (off.x || off.y) camera.setViewOffset(size.w, size.h, off.x, off.y, size.w, size.h); else camera.clearViewOffset();
    place(camera, cam);
    renderer.render(scene, camera);
    for (const [key, el] of anchors) {
      const [id, at] = key.split(':'), ch = chars.get(id);
      const obj = at === 'head' ? ch?.head : at === 'desk' ? ch?.desk : ch?.feet;
      if (!obj) continue;
      obj.getWorldPosition(v3).project(camera);
      el.style.transform = `translate3d(${((v3.x * 0.5 + 0.5) * size.w).toFixed(1)}px,${((-v3.y * 0.5 + 0.5) * size.h).toFixed(1)}px,0)`;
      el.style.zIndex = String(Math.round(ch!.g.position.z * 10) + (at === 'feet' ? 400 : at === 'desk' ? 300 : 200));
    }
    // Cards never wider than the gap between two desks, so neighbours never cover each other's words or buttons.
    if (!look.phone && room && room.crew.length > 1) {
      const xs = room.crew.map((c) => { chars.get(c.id)!.feet.getWorldPosition(v3).project(camera); return (v3.x * 0.5 + 0.5) * size.w; });
      const gap = Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
      const w = `${Math.round(clamp(gap - 8, 96, 164))}px`;
      if (w !== cardW) { cardW = w; host.style.setProperty('--card-w', w); }
    }
  }
  let cardW = '';

  // Ambient life: the working bob, the asking hop, and now and then a blink — only while someone of yours is busy.
  function ambient() {
    clearTimeout(ambT);
    if (!scene || hidden || offscreen || dead || !room) return;
    const alive = room.crew.some(busy) || room.chief.mood === 'ask' || room.chief.mood === 'work';
    if (alive) ambT = window.setTimeout(ambTick, AMBIENT_MS);
  }
  function ambTick() {
    const now = performance.now(), t = now / 1000;
    for (const ch of chars.values()) {
      const mood = moodOf(ch);
      let y = ch.baseY, rz = 0;
      if (mood === 'ask') { const k = (t + ch.phase) % 2.6; y += k < 0.5 ? Math.sin((k / 0.5) * Math.PI) * 0.12 : 0; }
      else if (mood === 'work') { y += Math.abs(Math.sin(t * 4 + ch.phase)) * 0.035; rz = Math.sin(t * 2 + ch.phase) * 0.03; }
      if (!ch.hop) { ch.fig.position.y = y; ch.fig.rotation.z = rz; }
      if (ch.ring && ch.c?.ring === 'needs') (ch.ring.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(t * 3));
      if (mood === 'idle' || mood === 'work') {
        if (ch.shown !== 'blink' && now > ch.blinkAt) { setFigure(ch, 'blink'); ch.blinkEnd = now + 200; }
        else if (ch.shown === 'blink' && now > ch.blinkEnd) { setFigure(ch, mood); ch.blinkAt = now + 2500 + ((ch.phase * 997) % 4000); }
      }
    }
    if (!raf) draw();
    ambient();
  }

  // ---------- building ----------
  const mat = (color: string, o: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...o });
  function rbox(w: number, h: number, d: number, r: number, color: string, seg = 2) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), mat(color));
    m.castShadow = true; m.receiveShadow = true; return m;
  }
  function canvasTex(cw: number, chh: number, paint: (g: CanvasRenderingContext2D, W: number, H: number) => void) {
    const c = document.createElement('canvas'); c.width = cw; c.height = chh; paint(c.getContext('2d')!, cw, chh);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function layout(n: number) {
    if (look.phone) {
      const rows = Math.max(1, Math.ceil((n + 1) / 2)), D = rows * 5.6 - 2, z = (r: number) => -D / 2 + 2 + r * 5.6;
      const cell = (i: number) => ({ x: i % 2 ? 1.9 : -1.9, z: z(Math.floor(i / 2)), ry: 0.05 });
      return { W: 7.6, D, H: 2.2, chief: { ...cell(0), ry: 0.2 }, crew: Array.from({ length: n }, (_, i) => cell(i + 1)),
        shelf: { x: 3.1, z: -D / 2 + 0.5 }, door: Math.min(-D / 2 + 4.8, D / 2 - 0.7), win: 1.9, pic: -1.1, yaw: 0.06, pitch: 1.02, lift: 0.1 };
    }
    const s = n > 1 ? clamp(10.2 / (n - 1), 2.4, 3.4) : 0, x0 = n > 1 ? -3 : 1;
    const W = Math.max(18, 2 * (x0 + (n - 1) * s + 1.7));
    return { W, D: 5.8, H: 3.3, chief: { x: -6.4, z: 0.9, ry: 0.5 }, crew: Array.from({ length: n }, (_, i) => ({ x: x0 + i * s, z: -0.5, ry: 0.1 })),
      shelf: { x: -W / 2 + 1.1, z: -2.3 }, door: -0.9, win: 2.2, pic: -3.6, yaw: 0.26, pitch: 0.6, lift: 0.3 };
  }

  /** Static furniture merged into one mesh per colour: ~120 meshes become a dozen draw calls. */
  function bake(g: THREE.Group, into: THREE.Object3D) {
    g.updateMatrixWorld(true);
    const buckets = new Map<string, { m: THREE.MeshLambertMaterial; parts: THREE.BufferGeometry[] }>();
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshLambertMaterial;
      const key = `${m.color.getHexString()}|${m.emissive.getHexString()}|${m.flatShading}|${m.side}`;
      const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      const b = buckets.get(key) ?? { m, parts: [] };
      b.parts.push(geo); buckets.set(key, b);
      mesh.geometry.dispose();
    });
    for (const { m, parts } of buckets.values()) {
      const merged = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m); mesh.castShadow = true; mesh.receiveShadow = true;
      into.add(mesh);
    }
  }

  function makeChar(id: string, kind: Char['kind'], g: THREE.Group, baseY: number, z: number, extra: Partial<Char> = {}): Char {
    const fig = new THREE.Group(); fig.position.set(0, baseY, z); if (look.phone) fig.rotation.x = -0.22; g.add(fig);
    const max = (kind === 'chief' ? 23 * 22 : 17 * 18) * 3;
    const mesh = new THREE.InstancedMesh(cube, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }), max);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; fig.add(mesh);
    const phase = [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 7;
    const ch: Char = { id, kind, g, fig, mesh, baseY, height: 1.6, shown: null, phase, blinkAt: performance.now() + 1500 + phase * 600, blinkEnd: 0,
      hit: new THREE.Mesh(), head: new THREE.Object3D(), feet: new THREE.Object3D(), desk: new THREE.Object3D(), cheerUntil: 0, hop: false, ...extra };
    setFigure(ch, moodOf(ch));
    ch.hit = new THREE.Mesh(new THREE.BoxGeometry(kind === 'chief' ? 1.8 : 2.0, 2.2, 1.6), new THREE.MeshBasicMaterial());
    ch.hit.visible = false; ch.hit.position.set(0, 1.1, 0); ch.hit.userData.id = id; g.add(ch.hit);
    fig.add(ch.head); ch.head.position.y = ch.height + 0.06;
    g.add(ch.feet); ch.feet.position.set(0, 0, kind === 'chief' ? 0.9 : 0.85);
    g.add(ch.desk); ch.desk.position.set(-0.35, 0.78, 0.5);
    chars.set(id, ch);
    return ch;
  }
  function moodOf(ch: Char): Mood {
    if (ch.cheerUntil > performance.now()) return 'happy';
    return ch.id === 'chief' ? room?.chief.mood ?? 'idle' : ch.c?.mood ?? 'idle';
  }
  function setFigure(ch: Char, mood: Mood) {
    if (ch.shown === mood) return;
    ch.shown = mood;
    const rows = ch.kind === 'chief' ? art.chief(mood) : art.pal(ch.kind, mood);
    const pal = ch.kind === 'chief' ? (look.night ? art.CHIEF_PAL_NIGHT : art.CHIEF_PAL) : art.palPalette(ch.kind);
    const h = rows.length, w = rows[0].length, freq: Record<string, number> = {};
    rows.forEach((r) => [...r].forEach((k) => { if (pal[k] && !FEAT.has(k) && !SIGN.has(k)) freq[k] = (freq[k] || 0) + 1; }));
    const base = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
    let n = 0;
    rows.forEach((r, y) => [...r].forEach((k, x) => {
      if (!pal[k]) return;
      const sign = SIGN.has(k);
      for (let l = 0; l < (sign ? 1 : 3); l++) {
        ch.mesh.setMatrixAt(n, m4.makeTranslation((x - (w - 1) / 2) * VOX, (h - 1 - y) * VOX, sign ? VOX * 0.6 : -l * VOX));
        ch.mesh.setColorAt(n, col.set(l && FEAT.has(k) ? pal[base] : pal[k]));
        n++;
      }
    }));
    ch.mesh.count = n;
    ch.mesh.instanceMatrix.needsUpdate = true;
    if (ch.mesh.instanceColor) ch.mesh.instanceColor.needsUpdate = true;
    ch.height = h * VOX;
  }

  /** What a monitor shows: the newest thing in progress, a letter waiting on you, a closed screen, or a calm one. */
  function screenArt(c: OfficeMember) {
    const w = c.things.at(-1), soft = art.PALS[c.kind];
    return canvasTex(256, 160, (g, W, H) => {
      const bg = (f: string | CanvasGradient) => { g.fillStyle = f; g.fillRect(0, 0, W, H); };
      const lines = (x: number, y: number, n: number, f: string) => { g.fillStyle = f; for (let i = 0; i < n; i++) { g.beginPath(); g.roundRect(x, y + i * 18, (W - 2 * x) * [0.8, 0.6, 0.9, 0.5, 0.7][i % 5], 8, 4); g.fill(); } };
      if (c.busyElsewhere) { bg('#2A2733'); g.fillStyle = '#6A6190'; [-28, 0, 28].forEach((dx, i) => { g.beginPath(); g.arc(W / 2 + dx, H / 2, i === 1 ? 7 : 5, 0, 7); g.fill(); }); return; }
      if (c.ask) {
        bg('#FFE3EC'); g.fillStyle = '#fff'; g.beginPath(); g.roundRect(48, 28, 160, 104, 12); g.fill();
        if (c.ask.kind === 'spend') { g.fillStyle = '#D23369'; g.font = '700 54px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', W / 2, H / 2 + 2); }
        else { g.strokeStyle = '#D23369'; g.lineWidth = 6; g.beginPath(); g.moveTo(60, 40); g.lineTo(128, 88); g.lineTo(196, 40); g.stroke(); }
        return;
      }
      if (w && (w.kind === 'image' || w.kind === 'video')) {
        const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, soft.body); gr.addColorStop(1, '#ff7aa2'); bg(gr);
        g.fillStyle = '#fff'; g.beginPath();
        if (w.kind === 'video') { g.moveTo(W / 2 - 16, H / 2 - 22); g.lineTo(W / 2 + 22, H / 2); g.lineTo(W / 2 - 16, H / 2 + 22); }
        else { g.moveTo(40, H - 30); g.lineTo(100, 70); g.lineTo(150, H - 30); g.moveTo(130, H - 30); g.lineTo(175, 90); g.lineTo(220, H - 30); g.arc(190, 46, 14, 0, 7); }
        g.fill(); return;
      }
      if (w && w.kind === 'sheet') {
        bg('#FFFFFF'); g.fillStyle = '#DFF3E6'; g.fillRect(0, 0, W, 30); g.strokeStyle = '#E7E4DF'; g.lineWidth = 2;
        for (let y = 30; y < H; y += 26) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
        for (let x = 64; x < W; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
        g.fillStyle = '#1E9A58'; for (let x = 10; x < W; x += 64) { g.beginPath(); g.roundRect(x, 11, 40, 8, 4); g.fill(); }
        g.fillStyle = '#B9B3C4'; for (let y = 40; y < H; y += 26) for (let x = 10; x < W; x += 64) { g.beginPath(); g.roundRect(x, y, 26 + ((x * 7 + y) % 18), 7, 3.5); g.fill(); }
        return;
      }
      if (w) { bg('#F3F1EE'); g.fillStyle = '#fff'; g.fillRect(56, 12, 144, 148); lines(70, 28, 6, '#C9C3D2'); return; }
      if (c.ring === 'working') { bg('#FFF6E8'); lines(22, 26, 6, soft.body); return; }
      bg(T.calm); g.globalAlpha = 0.55; g.drawImage(dotsCanvas(art.HOUSE, art.HOUSE_PAL, 5), W / 2 - 30, H / 2 - 28); g.globalAlpha = 1;
    });
  }
  function setScreen(ch: Char) {
    if (!ch.screen || !ch.c) return;
    const c = ch.c, key = `${c.busyElsewhere}|${c.ask?.kind ?? ''}|${c.things.at(-1)?.kind ?? ''}|${c.ring}`;
    if (key === ch.screenKey) return; // repaint only when what the monitor shows has changed
    ch.screenKey = key;
    const m = ch.screen.material as THREE.MeshBasicMaterial, old = m.map;
    m.map = screenArt(ch.c); m.needsUpdate = true; old?.dispose();
  }
  function thingMesh(w: FileView, kind: art.Kind) {
    const g = new THREE.Group();
    if (w.kind === 'image' || w.kind === 'video') { // a little standing picture frame
      const fr = rbox(0.36, 0.28, 0.04, 0.02, T.frame);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), new THREE.MeshBasicMaterial({ toneMapped: false, map: canvasTex(64, 48, (x, W, H) => {
        const gr = x.createLinearGradient(0, 0, W, H); gr.addColorStop(0, art.PALS[kind].body); gr.addColorStop(1, '#ff7aa2'); x.fillStyle = gr; x.fillRect(0, 0, W, H); }) }));
      face.position.z = 0.021; fr.add(face); fr.position.y = 0.14; fr.rotation.x = -0.18; g.add(fr);
    } else { // a paper, green-headed for a sheet
      const p = rbox(0.3, 0.02, 0.38, 0.008, w.kind === 'sheet' ? '#DFF3E6' : '#FFFFFF', 1); p.position.y = 0.012; g.add(p);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.04), mat(w.kind === 'sheet' ? '#1E9A58' : '#C9C3D2'));
      stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, 0.024, -0.12); g.add(stripe);
    }
    return g;
  }
  function placeThing(ch: Char, w: FileView, j: number, drop: boolean) {
    const m = thingMesh(w, ch.kind as art.Kind);
    m.position.set(j * 0.2 - (w.kind === 'image' || w.kind === 'video' ? 0 : 0.06), 0, j * -0.05);
    m.rotation.y = 0.25 - j * 0.18;
    ch.things!.add(m);
    if (!drop) return;
    m.position.y = 1.3;
    tween(700, (p) => { m.position.y = 1.3 * (1 - bounce(p)); m.rotation.z = (1 - p) * 0.5; });
  }
  function addPaper() {
    const i = stackCount++, cols = ['#FFFFFF', '#FFF1DC', '#DFF3E6', '#FFE3EC', '#E3EEFF'];
    const p = rbox(0.5, 0.025, 0.38, 0.01, cols[i % cols.length], 1);
    p.position.set(i % 2 ? 0.02 : -0.02, i * 0.032, 0); p.rotation.y = (((i * 37) % 11) - 5) * 0.03;
    stack!.add(p);
  }
  function paintRing(ch: Char) {
    if (!ch.ring || !ch.c) return;
    const c = ch.c, color = c.ring === 'needs' ? T.ringPink : c.ring === 'working' ? T.ringOk : c.busyElsewhere ? T.ringAway : null;
    const m = ch.ring.material as THREE.MeshBasicMaterial;
    ch.ring.visible = !!color; if (color) m.color.set(color);
    m.opacity = c.ring === 'needs' ? 0.22 : c.ring === 'working' ? 0.16 : 0.1;
  }

  function dispose3(o: THREE.Object3D) {
    o.traverse((n) => {
      // A light frees its shadow map, an instanced mesh its instance buffers: neither goes with the geometry.
      if ((n as THREE.DirectionalLight).isLight || (n as THREE.InstancedMesh).isInstancedMesh) (n as THREE.InstancedMesh).dispose();
      const mesh = n as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== cube) mesh.geometry.dispose();
      const ms = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      ms.forEach((x) => { (x as THREE.MeshBasicMaterial).map?.dispose(); x.dispose(); });
    });
  }

  function build(r: Room) {
    if (scene) dispose3(scene);
    T = look.night ? PAL.night : PAL.day;
    const L = layout(r.crew.length), s = new THREE.Scene();
    scene = s; chars = new Map(); room = r;
    const fixed = new THREE.Group(); // everything that never changes: baked into a few meshes below

    s.add(new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2]));
    const key = new THREE.DirectionalLight(T.key[0], T.key[1]);
    key.position.set(L.W * 0.35, 12, L.D * 0.7); key.castShadow = true; key.shadow.mapSize.setScalar(look.phone ? 1024 : 2048);
    const sc = key.shadow.camera, span = Math.max(L.W, L.D) * 0.75;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = 40;
    key.shadow.radius = 6; key.shadow.bias = -0.0008; key.shadow.normalBias = 0.02;
    s.add(key, key.target);

    // The box: a floor slab and two walls, cut away on the near sides.
    const slab = rbox(L.W, 0.4, L.D, 0.08, T.slab); slab.position.y = -0.2; fixed.add(slab);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L.W - 0.12, L.D - 0.12), mat('#ffffff'));
    const boards = canvasTex(512, 512, (g, W, H) => { g.fillStyle = T.floor; g.fillRect(0, 0, W, H); g.fillStyle = look.night ? '#5b516a' : '#dfcdb6'; for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 2, H); });
    boards.wrapS = boards.wrapT = THREE.RepeatWrapping; boards.repeat.set(L.W / 6, L.D / 6);
    (floor.material as THREE.MeshLambertMaterial).map = boards;
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.002; floor.receiveShadow = true; s.add(floor);
    const wall = (w: number, h: number, d: number, color: string, x: number, y: number, z: number) => { const m = rbox(w, h, d, 0.05, color); m.position.set(x, y, z); fixed.add(m); };
    wall(L.W, L.H, 0.22, T.wallB, 0, L.H / 2, -L.D / 2 + 0.11);
    wall(0.22, L.H, L.D, T.wallL, -L.W / 2 + 0.11, L.H / 2, 0);
    wall(L.W - 0.2, 0.16, 0.06, T.trim, 0.1, 0.08, -L.D / 2 + 0.25);
    wall(0.06, 0.16, L.D - 0.2, T.trim, -L.W / 2 + 0.25, 0.08, 0.1);

    // A window on the back wall: sky by day, stars by night.
    wall(2.2, 1.5, 0.08, T.frame, L.win, 2.1 - (look.phone ? 0.4 : 0), -L.D / 2 + 0.25);
    const wy = 2.1 - (look.phone ? 0.4 : 0);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.3), new THREE.MeshBasicMaterial({ toneMapped: false, map: canvasTex(200, 130, (g, W, H) => {
      const gr = g.createLinearGradient(0, 0, 0, H);
      if (look.night) { gr.addColorStop(0, '#141a3d'); gr.addColorStop(1, '#2a2f66'); } else { gr.addColorStop(0, '#bfe0ff'); gr.addColorStop(1, '#fff1dc'); }
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      if (look.night) { g.fillStyle = '#fff7d6'; [[30, 24], [80, 16], [150, 30], [120, 60], [60, 70], [176, 90]].forEach(([x, y], i) => { g.globalAlpha = 0.5 + (i % 3) * 0.2; g.beginPath(); g.arc(x, y, 1.6 + (i % 2), 0, 7); g.fill(); }); g.globalAlpha = 1; g.beginPath(); g.arc(160, 34, 12, 0, 7); g.fill(); }
      else { g.fillStyle = '#ffffff'; [[50, 40, 18], [70, 36, 14], [140, 70, 16], [158, 66, 12]].forEach(([x, y, rr]) => { g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill(); }); }
    }) }));
    sky.position.set(L.win, wy, -L.D / 2 + 0.3); s.add(sky);
    wall(0.06, 1.3, 0.04, T.frame, L.win, wy, -L.D / 2 + 0.31);

    // The house picture: the app's own mark, from the same dot bitmap.
    const houseTex = new THREE.CanvasTexture(dotsCanvas(art.HOUSE, art.HOUSE_PAL, 12)); houseTex.colorSpace = THREE.SRGBColorSpace;
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.66), new THREE.MeshLambertMaterial({ transparent: true, map: houseTex }));
    wall(0.92, 0.86, 0.05, T.frame, L.pic, 2.2 - (look.phone ? 0.4 : 0), -L.D / 2 + 0.25);
    pic.position.set(L.pic, 2.2 - (look.phone ? 0.4 : 0), -L.D / 2 + 0.28); s.add(pic);

    // The door, and two plants.
    wall(0.08, 2.1, 1.1, T.door, -L.W / 2 + 0.25, 1.05, L.door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), mat('#FFC23C')); knob.position.set(-L.W / 2 + 0.32, 1.0, L.door + 0.38); fixed.add(knob);
    const plant = (x: number, z: number, k: number) => {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * k, 0.16 * k, 0.34 * k, 16), mat(T.pot)); pot.position.set(x, 0.17 * k, z); fixed.add(pot);
      [[0, 0.55, 0, 0.26], [0.14, 0.72, 0.05, 0.2], [-0.12, 0.8, -0.04, 0.18], [0.02, 0.95, 0.02, 0.15]].forEach(([a, b, c, rr]) => {
        const l = new THREE.Mesh(new THREE.IcosahedronGeometry(rr * k, 1), mat(T.leaf, { flatShading: true })); l.position.set(x + a * k, b * k, z + c * k); fixed.add(l); });
    };
    plant(L.W / 2 - 0.55, -L.D / 2 + 0.55, 1.2); plant(-L.W / 2 + 0.6, L.D / 2 - 0.6, 1);

    // Done today: a little cabinet whose paper stack grows with the day's finished jobs.
    const cab = new THREE.Group(); cab.position.set(L.shelf.x, 0, L.shelf.z); s.add(cab);
    const cabFixed = new THREE.Group(); cabFixed.position.copy(cab.position); fixed.add(cabFixed);
    const body = rbox(0.9, 0.9, 0.6, 0.05, T.wood); body.position.y = 0.45; cabFixed.add(body);
    const tray = rbox(0.62, 0.08, 0.46, 0.03, T.frame); tray.position.y = 0.94; cabFixed.add(tray);
    stack = new THREE.Group(); stack.position.y = 0.98; cab.add(stack); stackCount = 0;
    for (let i = 0; i < Math.min(r.doneToday, 12); i++) addPaper();
    cabHit = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 0.8), new THREE.MeshBasicMaterial()); cabHit.visible = false; cabHit.position.y = 0.7; cabHit.userData.id = 'done'; cab.add(cabHit);

    // Chief: his armchair, rug and tea, by the door.
    const ck = L.chief, chiefG = new THREE.Group(); chiefG.position.set(ck.x, 0, ck.z); chiefG.rotation.y = ck.ry; s.add(chiefG);
    const chiefFixed = new THREE.Group(); chiefFixed.position.copy(chiefG.position); chiefFixed.rotation.copy(chiefG.rotation); fixed.add(chiefFixed);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.35, 48), mat(T.rug)); rug.rotation.x = -Math.PI / 2; rug.position.y = 0.006; rug.receiveShadow = true; chiefG.add(rug);
    const seat = rbox(1.5, 0.42, 1.0, 0.14, T.arm); seat.position.set(0, 0.34, 0); chiefFixed.add(seat);
    const back = rbox(1.5, 1.1, 0.3, 0.14, T.armDark); back.position.set(0, 0.8, -0.42); chiefFixed.add(back);
    [-0.72, 0.72].forEach((x) => { const a = rbox(0.26, 0.62, 1.0, 0.12, T.armDark); a.position.set(x, 0.5, 0.02); chiefFixed.add(a); });
    const side = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 24), mat(T.wood)); side.position.set(1.15, 0.62, 0.3); chiefFixed.add(side);
    const sleg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 8), mat(T.leg)); sleg.position.set(1.15, 0.3, 0.3); chiefFixed.add(sleg);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.1, 16), mat('#FFFFFF')); cup.position.set(1.15, 0.7, 0.3); chiefFixed.add(cup);
    makeChar('chief', 'chief', chiefG, 0.44, 0.02);

    // The helpers, each at a desk with a stool, a lamp and a monitor.
    r.crew.forEach((c, i) => {
      const at = L.crew[i], g = new THREE.Group(); g.position.set(at.x, 0, at.z); g.rotation.y = at.ry; s.add(g);
      const df = new THREE.Group(); df.position.copy(g.position); df.rotation.copy(g.rotation); fixed.add(df);
      const ring = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.008, 0.05); g.add(ring);
      const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.46, 20), mat(art.PALS[c.kind].dark)); stool.position.set(0, 0.23, -0.4); df.add(stool);
      const top = rbox(1.9, 0.08, 0.82, 0.03, T.desk); top.position.set(0, 0.7, 0.28); df.add(top);
      [[-0.86, -0.06], [0.86, -0.06], [-0.86, 0.62], [0.86, 0.62]].forEach(([x, z]) => { const l = rbox(0.06, 0.66, 0.06, 0.02, T.leg, 1); l.position.set(x, 0.33, z); df.add(l); });
      const mon = new THREE.Group(); mon.position.set(0.58, 0.74, 0.26); mon.rotation.y = -0.55;
      const monFixed = mon.clone(); df.add(monFixed); g.add(mon);
      const stand = rbox(0.06, 0.2, 0.06, 0.02, T.mon, 1); stand.position.y = 0.1; monFixed.add(stand);
      const foot = rbox(0.26, 0.03, 0.18, 0.012, T.mon, 1); foot.position.y = 0.015; monFixed.add(foot);
      const bez = rbox(0.74, 0.48, 0.05, 0.03, T.mon); bez.position.y = 0.44; monFixed.add(bez);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.4), new THREE.MeshBasicMaterial({ toneMapped: false })); screen.position.set(0, 0.44, 0.027); mon.add(screen);
      const lamp = new THREE.Group(); lamp.position.set(-0.76, 0.74, 0.05); df.add(lamp);
      const lb = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.03, 12), mat(T.mon)); lamp.add(lb);
      const la = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), mat(T.mon)); la.position.y = 0.18; lamp.add(la);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.14, 16, 1, true), mat('#FFC27A', { side: THREE.DoubleSide, emissive: look.night ? '#FFB45E' : '#000000', emissiveIntensity: 0.6 }));
      shade.position.set(0, 0.36, 0.02); lamp.add(shade);
      if (look.night) { const pl = new THREE.PointLight('#FFC27A', 2.2, 3.2, 1.6); pl.position.set(-0.6, 1.25, 0.35); g.add(pl); }
      const things = new THREE.Group(); things.position.set(-0.5, 0.74, 0.34); g.add(things);
      const ch = makeChar(c.id, c.kind, g, 0.5, -0.4, { ring, screen, things, c });
      setFigure(ch, moodOf(ch));
      c.things.forEach((w, j) => placeThing(ch, w, j, false));
      setScreen(ch); paintRing(ch);
    });
    const baked = new THREE.Group(); bake(fixed, baked); s.add(baked);
    fit();
  }

  /** Animate from the last room to this one: new things drop onto desks, a finished job hops and flies to the tray. */
  function update(r: Room) {
    const was = room!; room = r;
    const now = performance.now();
    r.crew.forEach((c) => {
      const ch = chars.get(c.id); if (!ch) return;
      const before = was.crew.find((x) => x.id === c.id);
      ch.c = c;
      const finished = before && busy(before) && !busy(c) && r.doneToday > was.doneToday;
      if (finished) cheer(ch, now);
      else if (ch.things && before && c.things.length > before.things.length && c.things.length > ch.things.children.length) {
        c.things.slice(ch.things.children.length).forEach((w, k) => placeThing(ch, w, ch.things!.children.length + k, true));
      } else if (ch.things && c.things.length < ch.things.children.length) {
        [...ch.things.children].forEach((m) => { m.removeFromParent(); dispose3(m); });
        c.things.forEach((w, j) => placeThing(ch, w, j, false));
      }
      setFigure(ch, moodOf(ch)); setScreen(ch); paintRing(ch);
    });
    for (let i = stackCount; i < Math.min(r.doneToday, 12); i++) addPaper();
    const chief = chars.get('chief'); if (chief) setFigure(chief, moodOf(chief));
    wake(); ambient();
  }
  function cheer(ch: Char, now: number) {
    ch.cheerUntil = now + CHEER_MS;
    setFigure(ch, 'happy');
    ch.hop = true;
    tween(900, (p) => { ch.fig.position.y = ch.baseY + Math.abs(Math.sin(p * Math.PI * 2)) * 0.28; }, () => { ch.hop = false; ch.fig.position.y = ch.baseY; });
    // The finished things fly across the room into the Done today tray.
    const dest = new THREE.Vector3(); stack!.getWorldPosition(dest); dest.y += stackCount * 0.032 + 0.1;
    [...(ch.things?.children ?? [])].forEach((m, k) => {
      const from = new THREE.Vector3(); m.getWorldPosition(from); scene!.attach(m);
      tween(1100 + k * 150, (p) => { const e = easeOut(p); m.position.lerpVectors(from, dest, e); m.position.y += Math.sin(p * Math.PI) * 1.4; m.rotation.y += 0.08; m.scale.setScalar(1 - 0.4 * e); },
        () => { m.removeFromParent(); dispose3(m); });
    });
    // Back to the room's own mood once the cheer is over: one timer, one frame.
    window.setTimeout(() => { if (dead) return; setFigure(ch, moodOf(ch)); wake(); }, CHEER_MS + 20);
  }

  // ---------- camera ----------
  function place(c: THREE.PerspectiveCamera, s: Cam) {
    const cp = Math.cos(s.pitch);
    c.position.set(s.target.x + s.dist * cp * Math.sin(s.yaw), s.target.y + s.dist * Math.sin(s.pitch), s.target.z + s.dist * cp * Math.cos(s.yaw));
    c.lookAt(s.target);
  }
  function fit() {
    if (!scene || !room) return;
    const L = layout(room.crew.length);
    camera.aspect = size.w / size.h; camera.fov = look.phone ? 26 : 30; camera.clearViewOffset(); camera.updateProjectionMatrix();
    const pts: [number, number, number][] = [];
    for (const x of [-L.W / 2, L.W / 2]) pts.push([x, -0.4, L.D / 2], [x, L.H, -L.D / 2]);
    pts.push([-L.W / 2, L.H, L.D / 2]);
    for (const ch of chars.values()) { const p = ch.g.position; pts.push([p.x, 2 + L.lift, p.z], [p.x, 0, p.z + 1.3]); }
    const h: Cam = { yaw: L.yaw, pitch: L.pitch, target: new THREE.Vector3(0, look.phone ? 0.2 : 0.6, look.phone ? 0.2 : 0.3), dist: 20 };
    // The nearest camera that keeps the room and the cards above every head in frame, then the room centred in it.
    const span = (d: number) => {
      place(camera, { ...h, dist: d }); camera.updateMatrixWorld();
      let lo = Infinity, hi2 = -Infinity, wide = 0;
      for (const [x, y, z] of pts) { v3.set(x, y, z).project(camera); lo = Math.min(lo, v3.y); hi2 = Math.max(hi2, v3.y); wide = Math.max(wide, Math.abs(v3.x)); }
      return { lo, hi: hi2, wide };
    };
    // The cards above each head (office.tsx) need their height in pixels, whatever the distance.
    const headroom = ((look.phone ? 64 : 100) * 2) / size.h;
    const fits = (d: number) => { const s = span(d); return s.wide < 0.95 && s.hi - s.lo + headroom < 1.88; };
    let lo = 4, hi = 120;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    h.dist = hi; home = h;
    const s = span(hi);
    homeOff = { x: 0, y: (-(s.hi + headroom + s.lo) / 2) * size.h / 2 };
    cam = { ...h, target: h.target.clone() }; off = { ...homeOff };
  }
  function clampCam() {
    if (!home || !cam) return;
    const d25 = (25 * Math.PI) / 180, d10 = (10 * Math.PI) / 180;
    cam.yaw = clamp(cam.yaw, home.yaw - d25, home.yaw + d25);
    cam.pitch = clamp(cam.pitch, home.pitch - d10, home.pitch + d10);
    cam.dist = clamp(cam.dist, home.dist * 0.4, home.dist * 1.18);
  }
  let camTween: Tween | null = null;
  function glide(goal: Cam, to: { x: number; y: number }) {
    if (!cam) return;
    const a = { ...cam, target: cam.target.clone() }, o = { ...off };
    if (camTween) tweens.delete(camTween);
    camTween = tween(900, (p) => {
      const e = easeOut(p);
      cam!.yaw = a.yaw + (goal.yaw - a.yaw) * e; cam!.pitch = a.pitch + (goal.pitch - a.pitch) * e; cam!.dist = a.dist + (goal.dist - a.dist) * e;
      cam!.target.lerpVectors(a.target, goal.target, e);
      off.x = o.x + (to.x - o.x) * e; off.y = o.y + (to.y - o.y) * e;
    });
  }

  // ---------- input: drag to look around, tap to visit ----------
  const pts = new Map<number, { x: number; y: number }>();
  let down: { x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) down = { x: e.clientX, y: e.clientY, moved: false };
    dragging = true; canvas.classList.add('drag'); wake();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p || !cam) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    cam.yaw -= dx * 0.004; if (e.pointerType === 'mouse') cam.pitch += dy * 0.003; // a finger's up and down scrolls the page
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.moved = true;
  });
  const up = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (pts.size) return;
    dragging = false; canvas.classList.remove('drag');
    if (down && !down.moved && e.type === 'pointerup') pick(e);
    down = null; wake();
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  // A trackpad pinch (or ctrl + wheel) zooms; a plain wheel keeps scrolling Home.
  canvas.addEventListener('wheel', (e) => { if (!e.ctrlKey || !cam) return; e.preventDefault(); cam.dist *= 1 + clamp(e.deltaY, -60, 60) * 0.0025; wake(); }, { passive: false });
  function pick(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects([...[...chars.values()].map((c) => c.hit), ...(cabHit ? [cabHit] : [])], false)[0];
    if (hit) onPick(String(hit.object.userData.id));
  }

  // ---------- the page around it ----------
  const resize = new ResizeObserver(([en]) => {
    const { width, height } = en.contentRect;
    if (!width || !height) return;
    size = { w: width, h: height }; renderer.setSize(width, height, false);
    if (scene) { fit(); draw(); }
  });
  resize.observe(host);
  const seen = new IntersectionObserver(([en]) => { offscreen = !en.isIntersecting; if (offscreen) clearTimeout(ambT); else { wake(); ambient(); } });
  seen.observe(host);
  const onVis = () => { hidden = document.hidden; if (hidden) { cancelAnimationFrame(raf); raf = 0; clearTimeout(ambT); } else { wake(); ambient(); } };
  document.addEventListener('visibilitychange', onVis);
  // A lost context (a GPU reset, a phone reclaiming it) hands over to the still row; the next visit to Home tries 3D again.
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); clearTimeout(ambT); onLost(); });

  return {
    show(r, l) {
      const next = `${l.night}|${l.phone}|${r.crew.map((c) => `${c.id}.${c.kind}`).join(',')}`;
      if (!scene || next !== cast || r.doneToday < (room?.doneToday ?? 0)) { look = l; cast = next; tweens.clear(); build(r); draw(); ambient(); return; }
      update(r);
    },
    focus(id, cover = { right: 0, bottom: 0 }) {
      if (!home) return;
      if (!id) { glide(home, homeOff); return; }
      const ch = chars.get(id); if (!ch) return;
      const p = new THREE.Vector3(); ch.fig.getWorldPosition(p); p.y += ch.height * 0.55;
      glide({ yaw: home.yaw, pitch: home.pitch, dist: home.dist * (look.phone ? 0.78 : 0.6), target: p }, { x: cover.right / 2, y: cover.bottom / 2 });
    },
    wake,
    dispose() {
      dead = true; cancelAnimationFrame(raf); clearTimeout(ambT); tweens.clear();
      resize.disconnect(); seen.disconnect(); document.removeEventListener('visibilitychange', onVis);
      if (scene) dispose3(scene);
      cube.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
