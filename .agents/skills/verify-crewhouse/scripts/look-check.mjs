#!/usr/bin/env node
// The look check (SKILL.md "Look check"): each changed screen at a small phone width with the largest text, light and
// dark, measured for the defects a person sees — stretched or squashed pictures, clipped text, overlapping boxes, parts
// off the screen, blank strips at its edges — and put next to its approved mock. Any hit fails, with the element and a crop.
//
//   node look-check.mjs web --out <dir> [--person <person.key>] [--width 360] [--height 780] [--text 1.3] [--then <js>] <slug>=<url>…
//   SERIAL=<emulator> node look-check.mjs android --out <dir> [--text <scale>] [--then '<tap regex>>><tap regex>'] <slug>   (taps reach the screen after each theme switch)
//   node look-check.mjs shot --out <dir> <slug>=<png|jpg>…   (someone's phone shot: the strip check and the mock only)
//
// web: its own headless Chromium (throwaway profile), ?day and ?night per screen (the app's own theme switch), every
// text box's font-size and line-height × --text (Android Chrome's text scaling). android: the emulator at 360 dp
// (`wm density`), the system's largest font_scale and `cmd uimode night`, read back from uiautomator and screencap;
// both are reset afterwards. Mocks: mocks.tsv beside this script (slug → path under $FM_HOME, {theme} = day|night, {look} = light|dark).
// Writes <out>/<slug>-<theme>.png, <slug>-<theme>-vs-mock.png, hits/<slug>-<theme>-<n>-<kind>.png, look-check.json.
// Exit 0 clean, 1 a defect, 2 could not run.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2), mode = argv.shift();
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv.splice(i, 2)[1]; };
const OUT = opt('out'), PERSON = opt('person'), THEN = opt('then'), W = +opt('width', 360), H = +opt('height', 780), TEXT = opt('text');
const ROOT = opt('root', join(import.meta.dirname, '..', '..', '..', '..'));
const DPR = 3, RATIO = 0.03; // a picture more than 3% off its own shape is stretched or squashed
if (!OUT || !['web', 'android', 'shot', 'fonts'].includes(mode) || !argv.length && mode !== 'fonts') { console.error('usage: look-check.mjs web|android|shot|fonts --out <dir> …'); process.exit(2); }
mkdirSync(join(OUT, 'hits'), { recursive: true });
const FM = process.env.FM_HOME ?? `${process.env.HOME}/.treehouse/firstmate`;
const mocks = Object.fromEntries(readFileSync(join(import.meta.dirname, 'mocks.tsv'), 'utf8').split('\n')
  .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')));
// The app's own backgrounds (web/src/tokens.ts, shared with the phone): an edge band of one of these is the app's page.
const { color } = await import(join(import.meta.dirname, '../../../../web/src/tokens.ts'));
// Per theme: night's surfaces are near-black, so by day a black band must not pass as one of them.
// A sheet's page dimmed by the shared .scrim (styles.css, rgba(12,10,16,.32)) is still the app's page.
const dim = (c) => c.map((v, i) => Math.round(v * 0.68 + [12, 10, 16][i] * 0.32));
const BGS = Object.fromEntries(Object.entries(color).map(([k, t]) => { const own = [t.bg, t.surface, t.sunken].map((x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16))); return [k, [...own, ...own.map(dim)]]; }));
const art = await import(join(import.meta.dirname, '../../../../web/src/art.ts'));
const [, cw, ch] = art.helmetSvg(20).match(/<rect [^>]*width="([\d.]+)" height="([\d.]+)"/), CELL = cw / ch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the browser: ours alone, also the decoder for every screenshot (no image library needed) ──
const profile = mkdtempSync(join(tmpdir(), 'look-check-'));
const chrome = spawn(process.env.CHROME ?? 'chromium', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore', env: { PATH: process.env.PATH, HOME: profile } });
const done = (code) => { chrome.kill('SIGTERM'); chrome.once('exit', () => { rmSync(profile, { recursive: true, force: true }); process.exit(code); }); };
for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => done(2)); // a stopped run still closes its browser and profile
let port;
for (let i = 0; i < 300 && !port; i++) { await sleep(100); try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not yet */ } }
if (!port) { console.error('look-check: Chromium never opened its DevTools port'); done(2); await new Promise(() => {}); }
const ws = new WebSocket((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); const p = pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p[1](new Error(d.error.message)) : p[0](d.result); } });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { pending.set(++id, [res, rej]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const page = async () => (await send('Target.attachToTarget', { targetId: (await send('Target.createTarget', { url: 'about:blank' })).targetId, flatten: true })).sessionId;
const run = async (s, fn, ...a) => {
  const r = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(a)})`, awaitPromise: true, returnByValue: true }, s);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const img = await page(); // a blank page whose canvas reads, crops and pairs the screenshots

// ── in the app's page: the DOM checks (a) pictures (b) clipped text (c) overlap (d) off screen ──
async function probe(ratio) {
  // The layout viewport: a phone zooms out to fit a too-wide page, so innerWidth would grow with the defect.
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight, out = [];
  const name = (el) => { const p = []; for (let e = el; e && e !== document.body && p.length < 3; e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + [...e.classList].slice(0, 2).map((c) => `.${c}`).join('')); return p.join(' > '); };
  const box = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  const words = (el) => (el.innerText || el.getAttribute?.('aria-label') || el.alt || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const hit = (kind, el, detail, r = el.getBoundingClientRect()) => out.push({ kind, el: name(el), text: words(el), box: box(r), detail });
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }); };
  const clips = (cs) => /hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY);
  const cut = (a, b) => { const x = Math.max(a.left, b.left), y = Math.max(a.top, b.top), r = Math.min(a.right, b.right), t = Math.min(a.bottom, b.bottom); return { x, y, left: x, top: y, right: r, bottom: t, width: r - x, height: t - y }; };
  /** What of an element can be seen: its box cut by every ancestor that clips. */
  const seen = (el) => { let r = el.getBoundingClientRect(); for (let a = el.parentElement; a && r.width > 0 && r.height > 0; a = a.parentElement) if (clips(getComputedStyle(a))) r = cut(r, a.getBoundingClientRect()); return r; };
  const own = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) || /^(IMG|svg|CANVAS|VIDEO|INPUT|TEXTAREA|BUTTON|SELECT)$/.test(el.tagName);
  const paints = (el) => { const cs = getComputedStyle(el); return !!el.innerText?.trim() || !!el.querySelector?.('img,svg,canvas,video') || own(el) || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0; };
  const content = (el, r, cs) => { const k = el.offsetWidth ? r.width / el.offsetWidth : 1, q = el.offsetHeight ? r.height / el.offsetHeight : 1, n = (p) => parseFloat(cs[p]) || 0;
    return [(el.offsetWidth - n('paddingLeft') - n('paddingRight') - n('borderLeftWidth') - n('borderRightWidth')) * k, (el.offsetHeight - n('paddingTop') - n('paddingBottom') - n('borderTopWidth') - n('borderBottomWidth')) * q]; };
  // What a box shows: its words' own line boxes, its pictures, a field's text area. What it covers: that, plus every
  // box inside it (itself included) that paints a background, border or shadow.
  const ink = (el) => { const rs = [], tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), rg = document.createRange();
    for (let n; (n = tw.nextNode()) && rs.length < 400;) if (n.data.trim() && n.parentElement.checkVisibility({ opacityProperty: true, visibilityProperty: true })) { rg.selectNodeContents(n); rs.push(...rg.getClientRects()); }
    for (const m of [el, ...el.querySelectorAll('img,svg,canvas,video,input,textarea,select')]) if (m.matches('img,canvas,video,svg:not(svg svg)') && shown(m)) rs.push(m.getBoundingClientRect());
      else if (m.matches('input,textarea,select') && shown(m)) { const b = m.getBoundingClientRect(), cs = getComputedStyle(m), n = (p) => parseFloat(cs[p]) || 0;
        rs.push({ left: b.left + n('paddingLeft') + n('borderLeftWidth'), top: b.top + n('paddingTop'), right: b.right - n('paddingRight') - n('borderRightWidth'), bottom: b.bottom - n('paddingBottom') }); }
    return rs; };
  const cover = (el) => [...ink(el), ...[el, ...el.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e);
    return shown(e) && (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none'); }).map((e) => e.getBoundingClientRect())];
  const svgRatio = async (src) => { const t = src.startsWith('data:') ? decodeURIComponent(src.slice(src.indexOf(',') + 1)) : await (await fetch(src)).text();
    // A viewBox fits itself inside the box (meet or slice) unless the root says none: only then can it stretch.
    const root = t.match(/<svg\b[^>]*>/)?.[0] ?? '', v = root.match(/viewBox=["'][\d.\s-]*?([\d.]+)[\s,]+([\d.]+)["']/);
    return v && /preserveAspectRatio=["']none["']/.test(root) ? v[1] / v[2] : undefined; };
  const natural = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth / i.naturalHeight); i.onerror = () => ok(); i.src = src; });
  const els = [...document.body.querySelectorAll('*')].filter(shown);
  for (const el of els) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    // (a) a picture drawn off its own shape: <img>/<video> filled into another box, <canvas> bitmap, an outer <svg> told
    // not to keep its ratio, or a background image sized in two dimensions.
    let nat, drawn;
    const svg = (s) => /^data:image\/svg|\.svg(\?|$)/.test(s);
    if (el instanceof HTMLImageElement && el.naturalWidth && /fill/.test(cs.objectFit)) { nat = svg(el.currentSrc) ? await svgRatio(el.currentSrc) : el.naturalWidth / el.naturalHeight; drawn = content(el, r, cs); }
    if (el instanceof HTMLVideoElement && el.videoWidth && cs.objectFit === 'fill') { nat = el.videoWidth / el.videoHeight; drawn = content(el, r, cs); }
    if (el instanceof HTMLCanvasElement && el.width && el.height) { nat = el.width / el.height; drawn = content(el, r, cs); }
    if (el instanceof SVGSVGElement && !el.parentElement.closest('svg') && el.viewBox.baseVal?.width && el.preserveAspectRatio.baseVal.align === 1) { nat = el.viewBox.baseVal.width / el.viewBox.baseVal.height; drawn = [r.width, r.height]; }
    const bg = cs.backgroundImage.match(/url\("?([^")]+)"?\)/), size = cs.backgroundSize.split(',')[0].trim().split(/\s+/);
    // ponytail: first background layer only; a stacked layer that stretches goes unseen.
    if (bg && size.length === 2 && !size.includes('auto')) { nat = svg(bg[1]) ? await svgRatio(bg[1]) : await natural(bg[1]); const [cw, ch] = content(el, r, cs); drawn = size.map((v, i) => (v.endsWith('%') ? (parseFloat(v) / 100) * [cw, ch][i] : parseFloat(v))); }
    if (nat && drawn?.[0] > 0 && drawn[1] > 0) { const off = drawn[0] / drawn[1] / nat - 1; if (Math.abs(off) > ratio) hit('stretched', el, `${off > 0 ? 'stretched wide' : 'squashed narrow'} ${Math.round(Math.abs(off) * 100)}%: drawn ${drawn.map(Math.round).join('×')}, own shape ${nat.toFixed(3)}:1`); }
    // (b) text cut off: a word's own box running past a box that hides overflow. A designed cut (an ellipsis or a line
    // clamp) passes while it still shows at least half the words; a hard cut always fails. Only what is on the screen
    // counts, and a box of a pixel or less is the screen-reader-only pattern: nothing of it shows, so nothing is cut.
    if (/hidden|clip/.test(cs.overflowX + cs.overflowY) && r.width > 2 && r.height > 2 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      const edge = el.getBoundingClientRect(), tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), rg = document.createRange();
      for (let n; (n = tw.nextNode());) {
        if (!n.data.trim() || !shown(n.parentElement)) continue;
        rg.selectNodeContents(n);
        const past = [...rg.getClientRects()].find((q) => q.right > edge.right + 1 || q.bottom > edge.bottom + 1 || q.left < edge.left - 1 || q.top < edge.top - 1);
        if (!past) continue;
        const on = cut(cut(seen(n.parentElement), edge), { left: 0, top: 0, right: vw, bottom: vh });
        if (on.width <= 1 || on.height <= 1) continue;
        const ell = cs.textOverflow === 'ellipsis', clamp = cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '';
        const shows = ell ? el.clientWidth / el.scrollWidth : clamp ? el.clientHeight / el.scrollHeight : 0;
        if (shows < 0.5) { hit('clipped', n.parentElement, `"${n.data.trim().slice(0, 40)}" cut by ${name(el)} (${ell || clamp ? `${ell ? 'ellipsis' : 'line clamp'} shows ${Math.round(shows * 100)}%` : 'overflow hidden'})`, on); break; }
      }
    }
    // (c) siblings on top of each other, where the one on top covers the other's words or pictures (covering only its
    // padding or background is layout, e.g. a mic button inside its field's reserved padding).
    const kids = [...el.children].filter((k) => shown(k) && paints(k));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const o = cut(cut(seen(kids[i]), seen(kids[j])), { left: 0, top: 0, right: vw, bottom: vh });
      if (o.width <= 1 || o.height <= 1) continue;
      const atop = document.elementsFromPoint(o.left + o.width / 2, o.top + o.height / 2).find((e) => kids[i].contains(e) || kids[j].contains(e));
      if (!atop) continue;
      const [up, low] = kids[i].contains(atop) ? [kids[i], kids[j]] : [kids[j], kids[i]];
      // A sticky or fixed bar over a page that still scrolls is the content passing under it; at the page's end it counts.
      // ponytail: the page's own scroll only; a bar over an inner scroller still fails, add the scroller test when one does.
      if (/fixed|sticky/.test(getComputedStyle(up).position) && document.scrollingElement.scrollHeight - scrollY - innerHeight > 1) continue;
      const meet = cover(up).flatMap((a) => ink(low).map((b) => cut(cut(a, b), o))).find((q) => q.width > 1 && q.height > 1);
      if (meet) hit('overlap', up, `covers ${name(low)} "${words(low).slice(0, 30)}" by ${Math.round(meet.width)}×${Math.round(meet.height)}`, meet);
    }
    // (d) off the screen sideways (or a fixed part below its bottom): what can be seen of it lies past the viewport.
    if (own(el)) { const s = seen(el), fixed = /fixed|sticky/.test(cs.position);
      if (s.width > 0 && s.height > 0 && (s.left < -1 || s.right > vw + 1 || (fixed && (s.top < -1 || s.bottom > vh + 1)))) hit('offscreen', el, `reaches ${Math.round(s.left)}…${Math.round(s.right)} of 0…${vw}`, s); }
  }
  const sw = document.documentElement.scrollWidth;
  if (sw > vw + 1) out.push({ kind: 'offscreen', el: 'html', text: '', box: { x: 0, y: 0, w: sw, h: vh }, detail: `the page scrolls sideways: ${sw} wide on a ${vw} screen` });
  return out;
}

// ── in the blank page: (e) blank strips, then the crops and the pairing with the mock ──
/** Which look a shot is in: the theme whose page colour covers more of it. */
async function lookOf(src, sets) {
  const i = new Image(); i.src = src; await i.decode();
  const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d'); g.drawImage(i, 0, 0);
  const d = g.getImageData(0, 0, i.width, i.height).data, n = { day: 0, night: 0 };
  for (let k = 0; k < d.length; k += 4 * 16) for (const t of ['day', 'night']) if (Math.abs(d[k] - sets[t][0][0]) + Math.abs(d[k + 1] - sets[t][0][1]) + Math.abs(d[k + 2] - sets[t][0][2]) <= 15) n[t]++;
  return n.day >= n.night ? 'day' : 'night';
}
async function strips(src, frac, sets, theme) {
  const i = new Image(); i.src = src; await i.decode();
  const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d'); g.drawImage(i, 0, 0);
  const { data, width: w, height: h } = g.getImageData(0, 0, i.width, i.height);
  const px = (x, y) => { const k = (y * w + x) * 4; return [data[k], data[k + 1], data[k + 2]]; };
  const near = (a, b, t = 10) => Math.abs(a[0] - b[0]) <= t && Math.abs(a[1] - b[1]) <= t && Math.abs(a[2] - b[2]) <= t;
  // A phone shot with no theme given: the look whose page colour is nearer the middle of the screen.
  if (!sets[theme]) { const m = px(w >> 1, h >> 1), d = (k) => Math.abs(sets[k][0][0] - m[0]) + Math.abs(sets[k][0][1] - m[1]) + Math.abs(sets[k][0][2] - m[2]); theme = d('day') <= d('night') ? 'day' : 'night'; }
  const bgs = sets[theme], out = [];
  // Each edge: the run of lines, from the edge inwards, that are one colour end to end (98% of their pixels).
  for (const [edge, n, len, at] of [['left', w, h, (k, t) => px(k, t)], ['right', w, h, (k, t) => px(w - 1 - k, t)], ['top', h, w, (k, t) => px(t, k)], ['bottom', h, w, (k, t) => px(t, h - 1 - k)]]) {
    const ink = at(0, len >> 1);
    let k = 0;
    for (; k < n >> 1; k++) { let same = 0; for (let t = 0; t < len; t += 2) same += near(at(k, t), ink); if (same < 0.98 * Math.ceil(len / 2)) break; }
    if (k >= Math.max(6, frac * n) && !bgs.some((b) => near(ink, b, 10))) out.push({ edge, px: k, colour: ink });
  }
  return { out, w, h, theme };
}
async function crop(src, b, pad) {
  const i = new Image(); i.src = src; await i.decode();
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad), cw = Math.min(i.width, b.x + b.w + pad) - x, ch = Math.min(i.height, b.y + b.h + pad) - y;
  const c = new OffscreenCanvas(Math.max(1, cw), Math.max(1, ch)), g = c.getContext('2d');
  g.drawImage(i, x, y, cw, ch, 0, 0, cw, ch); g.strokeStyle = '#ff2d55'; g.lineWidth = 4; g.strokeRect(b.x - x, b.y - y, b.w, b.h);
  const r = new FileReader(); r.readAsDataURL(await c.convertToBlob()); await new Promise((k) => { r.onload = k; }); return r.result;
}
async function pair(shot, mock, label) {
  const load = async (s) => { const i = new Image(); i.src = s; await i.decode(); return i; };
  const a = await load(shot), b = mock ? await load(mock) : null, hh = 1400, top = 56;
  const aw = (a.width * hh) / a.height, bw = b ? (b.width * hh) / b.height : 0;
  const c = new OffscreenCanvas(Math.round(aw + bw + (b ? 40 : 0)) || 1, hh + top), g = c.getContext('2d');
  g.fillStyle = '#888'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#fff'; g.font = '28px sans-serif';
  g.fillText(label, 8, 38); g.drawImage(a, 0, top, aw, hh);
  if (b) { g.fillText('approved mock', aw + 48, 38); g.drawImage(b, aw + 40, top, bw, hh); }
  const r = new FileReader(); r.readAsDataURL(await c.convertToBlob()); await new Promise((k) => { r.onload = k; }); return r.result;
}
const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const save = (file, url) => writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));

/** The pixel checks, crops and mock pairing for one captured screen; dom hits carry CSS-px boxes (× scale). */
async function finish(slug, theme, shotFile, domHits, scale) {
  const src = dataUrl(shotFile), { out: bands, w, h, theme: look } = await run(img, strips, src, 0.015, BGS, theme);
  theme = look;
  const hits = [...domHits.map((d) => ({ ...d, box: { x: d.box.x * scale, y: d.box.y * scale, w: d.box.w * scale, h: d.box.h * scale } })),
    ...bands.map((b) => ({ kind: 'strip', el: `${b.edge} edge`, text: '', detail: `a ${b.px}px band of rgb(${b.colour}) along the ${b.edge} edge, not one of the app's backgrounds`,
      box: b.edge === 'left' ? { x: 0, y: 0, w: b.px, h } : b.edge === 'right' ? { x: w - b.px, y: 0, w: b.px, h } : b.edge === 'top' ? { x: 0, y: 0, w, h: b.px } : { x: 0, y: h - b.px, w, h: b.px } }))];
  hits.forEach((x, n) => { x.crop = join('hits', `${slug}-${theme}-${n + 1}-${x.kind}.png`); });
  for (const x of hits) save(join(OUT, x.crop), await run(img, crop, src, x.box, 16 * scale));
  const m = mocks[slug]?.replace('{theme}', theme).replace('{look}', theme === 'night' ? 'dark' : 'light'), mock = m && existsSync(join(FM, m)) ? join(FM, m) : null;
  save(join(OUT, `${slug}-${theme}-vs-mock.png`), await run(img, pair, src, mock && dataUrl(mock), `${slug} ${theme}${mock ? '' : ' (no approved mock)'}`));
  return { slug, theme, shot: shotFile, mock, hits };
}

const report = [];
if (mode === 'fonts') { // the Android bold-weight regression (ch-android-bold-weight): every weight the phone asks
  // for must resolve to a bundled static family — Android draws a bare fontWeight on a custom family as regular.
  try {
    const hits = [], mob = (p) => join(ROOT, 'mobile', p);
    const hit = (el, detail) => hits.push({ kind: 'font', el, text: '', detail });
    const files = [], walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue; const p = join(d, e.name);
      e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) && files.push(p); } };
    walk(mob(''));
    const mapFile = mob('src/font.ts');
    const map = existsSync(mapFile) ? Object.fromEntries([...readFileSync(mapFile, 'utf8').matchAll(/'(\d{3})'\s*:\s*'([^']+)'/g)].map((m) => [m[1], m[2]])) : null;
    if (!map || !Object.keys(map).length) hit('mobile/src/font.ts', 'no weight map: every phone weight needs a static family');
    for (const f of files) {
      const rel = f.slice(ROOT.length + 1), src = readFileSync(f, 'utf8');
      if (!rel.endsWith('src/font.ts')) for (const [i, line] of src.split('\n').entries())
        if (/fontWeight\s*:/.test(line)) hit(rel, `bare fontWeight on line ${i + 1}: Android draws it regular — use ...fw()`);
      for (const m of src.matchAll(/fw\(([^)]*)\)/g)) for (const w of m[1].matchAll(/'(\d{3})'/g))
        if (map && !map[w[1]]) hit(rel, `weight ${w[1]} has no static family in src/font.ts`);
    }
    const app = existsSync(mob('App.tsx')) ? readFileSync(mob('App.tsx'), 'utf8') : '';
    const reg = Object.fromEntries([...app.matchAll(/(\w+):\s*require\('([^']*fonts\/[^']+)'\)/g)].map((m) => [m[1], m[2]]));
    for (const fam of Object.values(map ?? {})) {
      if (!reg[fam]) hit('mobile/App.tsx', `family ${fam} not loaded in useFonts`);
      else if (!existsSync(join(ROOT, reg[fam].replace('./', 'mobile/')))) hit('mobile/App.tsx', `bundled file missing: ${reg[fam]}`);
    }
    writeFileSync(join(OUT, 'fonts.json'), JSON.stringify(hits, null, 1));
    console.log(`${hits.length ? 'FAIL' : 'ok  '} fonts  ${OUT}`);
    for (const x of hits) console.log(`  ${x.kind}: ${x.el} — ${x.detail}`);
    done(hits.length ? 1 : 0);
  } catch (e) { console.error(`look-check: could not run: ${e.message}`); done(2); }
  await new Promise(() => {});
}
try {
  if (mode === 'web') {
    const app = await page(), text = +(TEXT ?? 1.3);
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true }, app);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, app);
    const settle = () => run(app, async () => { // fonts in, then the DOM still for 400 ms (bounded at 10 s)
      await document.fonts.ready; let last = Date.now(); const mo = new MutationObserver(() => { last = Date.now(); }); mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      for (const end = Date.now() + 10000; Date.now() - last < 400 && Date.now() < end;) await new Promise((r) => setTimeout(r, 50)); mo.disconnect(); });
    const go = async (u) => { await send('Page.navigate', { url: u }, app); for (let i = 0; i < 100 && (await run(app, () => document.readyState)) !== 'complete'; i++) await sleep(100); await settle(); };
    if (PERSON) await go(`${new URL(argv[0].slice(argv[0].indexOf('=') + 1)).origin}/#person=${readFileSync(PERSON, 'utf8').trim()}`);
    for (const a of argv) {
      const slug = a.slice(0, a.indexOf('=')), url = a.slice(a.indexOf('=') + 1);
      for (const theme of ['day', 'night']) {
        // The theme rides in the query before the route's hash (screens.sh's rule).
        const [base, hash = ''] = url.split('#'), u = `${base}${base.includes('?') ? '&' : '?'}${theme}${hash ? `#${hash}` : ''}`;
        await go(u);
        if (THEN) { await run(app, `async () => (${THEN})`); await settle(); } // a screen behind an in-memory switch (Office)
        // Read every size before writing any: computed styles are live, so em sizes would compound.
        await run(app, (k) => { const all = [...document.querySelectorAll('body, body *')].map((e) => { const cs = getComputedStyle(e); return [e, cs.fontSize, cs.lineHeight]; });
          for (const [e, f, l] of all) { e.style.setProperty('font-size', `${parseFloat(f) * k}px`, 'important'); if (l !== 'normal') e.style.setProperty('line-height', `${parseFloat(l) * k}px`, 'important'); } }, text);
        await settle();
        const dom = await run(app, probe, RATIO), file = join(OUT, `${slug}-${theme}.png`);
        save(file, `,${(await send('Page.captureScreenshot', { format: 'png' }, app)).data}`);
        report.push(await finish(slug, theme, file, dom, DPR));
      }
    }
  } else if (mode === 'shot') { // a phone photo or any capture: the pixel checks alone (strips), beside its mock
    for (const a of argv) { const slug = a.slice(0, a.indexOf('=')), file = a.slice(a.indexOf('=') + 1), theme = /night|dark/.test(file) ? 'night' : /day|light/.test(file) ? 'day' : 'auto';
      report.push(await finish(slug, theme, file, [], 1)); }
  } else {
    const S = process.env.SERIAL, adb = (...a) => execFileSync('adb', ['-s', S, ...a], { encoding: 'utf8', maxBuffer: 1 << 27 });
    if (!S) throw new Error('set SERIAL to your own emulator');
    const [pw] = adb('shell', 'wm', 'size').match(/(\d+)x(\d+)/).slice(1).map(Number);
    const sdk = +adb('shell', 'getprop', 'ro.build.version.sdk').trim(), scale = TEXT ?? (sdk >= 34 ? '2.0' : '1.3'), dens = Math.round((pw / 360) * 160);
    const was = { font: adb('shell', 'settings', 'get', 'system', 'font_scale').trim(), night: adb('shell', 'cmd', 'uimode', 'night').trim() };
    try {
      adb('shell', 'wm', 'density', String(dens)); adb('shell', 'settings', 'put', 'system', 'font_scale', scale);
      let reached;
      for (const theme of ['day', 'night']) {
        adb('shell', 'cmd', 'uimode', 'night', theme === 'night' ? 'yes' : 'no');
        // Settled = the app's own words on screen, its view tree the same in two reads (the status bar's clock left out) and
        // the shot in the asked-for look (bounded at 90 s; a loaded emulator takes seconds a shot): density and theme
        // changes recreate the activity, and a shot taken mid-way is a blank page or still the other look.
        // A recreate can also drop the app back to its first screen: --then names what to tap, in order, to reach the screen,
        // and the taps run again only when the screen's words are not the ones the first look reached.
        const slug = argv[0], file = join(OUT, `${slug}-${theme}.png`), cap = () => execFileSync('adb', ['-s', S, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 27 });
        let xml = '', png = Buffer.alloc(0), why = '';
        // An app now and then misses a theme change it was already told about: after 20 s, flip it away and back once.
        const settle = async () => { let nudge = Date.now() + 20000, was = ''; for (const end = Date.now() + 90000; Date.now() < end;) {
          if (Date.now() > nudge) { nudge = Infinity; adb('shell', 'cmd', 'uimode', 'night', theme === 'night' ? 'no' : 'yes'); await sleep(1500); adb('shell', 'cmd', 'uimode', 'night', theme === 'night' ? 'yes' : 'no'); }
          await sleep(800); png = cap();
          adb('shell', 'uiautomator', 'dump', '/sdcard/look.xml'); xml = adb('shell', 'cat', '/sdcard/look.xml');
          const app = xml.replace(/<node [^>]*package="com\.android\.systemui"[^>]*\/?>/g, '');
          const ready = /package="(?!com\.android\.systemui)[^"]+"[^>]*text="[^"]+"|text="[^"]+"[^>]*package="(?!com\.android\.systemui)/.test(xml);
          const same = app === was, look = await run(img, lookOf, `data:image/png;base64,${png.toString('base64')}`, BGS);
          if (ready && same && look === theme) return; was = app; why = `words ${ready}, still ${same}, look ${look}`;
        } throw new Error(`the phone never settled in the ${theme} look within 90 s (last: ${why})`); };
        await settle();
        const words = () => [...xml.matchAll(/ text="([^"]+)"[^>]*package="(?!com\.android\.systemui)/g)].map((m) => m[1]).join('\n');
        if (THEN && words() !== reached) for (const t of THEN.split('>>')) { await sleep(1000); try { execFileSync(process.execPath, [join(import.meta.dirname, 'phone-ui.mjs'), 'tap', t.trim()], { env: { ...process.env, SERIAL: S }, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { throw new Error(`--then could not tap ${t.trim()}: ${(e.stderr || e.message).trim()}`); } await settle(); }
        reached = words(); writeFileSync(file, png);
        writeFileSync(join(OUT, `${slug}-${theme}.xml`), xml);
        report.push(await finish(slug, theme, file, nativeHits(xml, png.readUInt32BE(16), png.readUInt32BE(20)), 1));
      }
    } finally { adb('shell', 'wm', 'density', 'reset'); adb('shell', 'settings', 'put', 'system', 'font_scale', was.font === 'null' ? '1.0' : was.font); adb('shell', 'cmd', 'uimode', 'night', /yes/.test(was.night) ? 'yes' : 'no'); }
  }
} catch (e) { console.error(`look-check: could not run: ${e.message}`); done(2); await new Promise(() => {}); }

/** The emulator's own view tree (uiautomator): words over words, parts past the screen, words past their parent, dot pictures. */
function nativeHits(xml, sw, sh) {
  const out = [], stack = [{ kids: [] }];
  for (const [tag] of xml.matchAll(/<node [^>]*?\/?>|<\/node>/g)) {
    if (tag === '</node>') { stack.pop(); continue; }
    const a = (k) => (tag.match(new RegExp(` ${k}="([^"]*)"`)) || [])[1] ?? '';
    const [x1, y1, x2, y2] = a('bounds').match(/\d+/g).map(Number);
    const n = { cls: a('class').split('.').pop(), text: a('text') || a('content-desc'), words: a('text'), b: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, kids: [], parent: stack.at(-1) };
    stack.at(-1).kids.push(n); if (!tag.endsWith('/>')) stack.push(n);
  }
  const label = (n) => `${n.cls}${n.text ? ` "${n.text.slice(0, 30)}"` : ''}`;
  const walk = (n) => {
    const kids = n.kids.filter((k) => k.b.w > 0 && k.b.h > 0);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const p = kids[i].b, q = kids[j].b, w = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x), h = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
      if (w > 2 && h > 2 && kids[i].words && kids[j].words) out.push({ kind: 'overlap', el: label(kids[i]), text: kids[i].text, box: { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y), w, h }, detail: `overlaps ${label(kids[j])} by ${w}×${h}` });
    }
    for (const k of kids) {
      if (k.b.x < 0 || k.b.x + k.b.w > sw || k.b.y + k.b.h > sh) out.push({ kind: 'offscreen', el: label(k), text: k.text, box: k.b, detail: `reaches ${k.b.x}…${k.b.x + k.b.w} of 0…${sw}` });
      const pb = n.b;
      if (k.text && pb && (k.b.x < pb.x - 1 || k.b.y < pb.y - 1 || k.b.x + k.b.w > pb.x + pb.w + 1 || k.b.y + k.b.h > pb.y + pb.h + 1)) out.push({ kind: 'clipped', el: label(k), text: k.text, box: k.b, detail: `runs past its parent ${label(n)}` });
      walk(k);
    }
  };
  walk(stack[0]);
  // (a) a picture drawn in dots (the phone's Dots, one view per cell of art.ts's character grid): the cells must keep the
  // art's own cell shape, art.helmetSvg's cw:ch. Dots are the leaf views of one small square size; a cluster is one picture.
  const dots = [], texts = [], all = (n) => n.kids.forEach((k) => { if (k.words) texts.push(k); if (!k.kids.length && !k.text && k.b.w > 1 && k.b.w <= 0.025 * sw && Math.abs(k.b.w - k.b.h) <= 1.5) dots.push(k.b); all(k); });
  all(stack[0]);
  const seenDot = new Set();
  for (const d of dots) {
    if (seenDot.has(d)) continue;
    const pic = [d]; seenDot.add(d);
    for (let i = 0; i < pic.length; i++) for (const e of dots) if (!seenDot.has(e) && Math.abs(e.x - pic[i].x) <= 2.2 * pic[i].w && Math.abs(e.y - pic[i].y) <= 2.2 * pic[i].h) { seenDot.add(e); pic.push(e); }
    // The grid's pitch: distinct columns and rows (merged within 1.5 px of rounding) across the picture's span. A helmet is
    // 14 dots wide or more (20 and 30 on the phone); the icons (art.TABS) are 9×9 square pixels, drawn as they should be.
    const lines = (v) => v.sort((a, b) => a - b).filter((q, i, a) => !i || q - a[i - 1] > 1.5);
    const xs = lines(pic.map((q) => q.x)), ys = lines(pic.map((q) => q.y));
    if (pic.length < 40 || xs.length < 12) continue;
    const px = (xs.at(-1) - xs[0]) / (xs.length - 1), py = (ys.at(-1) - ys[0]) / (ys.length - 1);
    const x = Math.min(...pic.map((q) => q.x)), y = Math.min(...pic.map((q) => q.y)), w = Math.max(...pic.map((q) => q.x + q.w)) - x, h = Math.max(...pic.map((q) => q.y + q.h)) - y;
    const off = px / py / CELL - 1;
    for (const t of texts) { const q = t.b, ow = Math.min(q.x + q.w, x + w) - Math.max(q.x, x), oh = Math.min(q.y + q.h, y + h) - Math.max(q.y, y);
      if (ow > 2 && oh > 2) out.push({ kind: 'overlap', el: `a ${pic.length}-dot picture`, text: '', box: { x: Math.max(q.x, x), y: Math.max(q.y, y), w: ow, h: oh }, detail: `covers ${label(t)} by ${ow}×${oh}` }); }
    if (Math.abs(off) > RATIO) out.push({ kind: 'stretched', el: `a ${pic.length}-dot picture`, text: '', box: { x, y, w, h }, detail: `${off > 0 ? 'stretched wide' : 'squashed narrow'} ${Math.round(Math.abs(off) * 100)}%: cells ${px.toFixed(1)}×${py.toFixed(1)}px, the art's own cell is ${CELL.toFixed(3)}:1 (art.ts helmetSvg)` });
  }
  return out;
}

writeFileSync(join(OUT, 'look-check.json'), JSON.stringify(report, null, 1));
let bad = 0;
for (const r of report) {
  console.log(`${r.hits.length ? 'FAIL' : 'ok  '} ${r.slug} ${r.theme}  ${r.shot}${r.mock ? '' : '  (no approved mock)'}`);
  for (const x of r.hits) { bad++; console.log(`  ${x.kind}: ${x.el}${x.text ? ` "${x.text}"` : ''} — ${x.detail}  [${x.crop}]`); }
}
done(bad ? 1 : 0);
