// The office's battery and layout rules, measured in a real browser on the ?demo households (web/src/office.tsx): the
// room is flat 2D with no 3D library anywhere, a quiet room asks for no frame and runs no animation, Reduce Motion
// runs none at all, and at every crew size (?demo=crew1, crew5, crew12, crew30) on a phone and a computer every bubble
// sits inside the room, clear of the others and of every sprite, with each helper who needs her showing Review.
// Needs a Chromium on PATH (skipped without one).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import WebSocket from 'ws';
import { browserBin } from '../src/desktop.ts';
import { temp } from './tmp.ts';
import { until } from './lab.ts';
import { floorPlan, type OfficeMember } from '../web/src/adapter.ts';

const repo = join(import.meta.dirname, '..');
const bin = browserBin();

// Build a copy of the web tree, so the checkout's own dist stays as its last real build (as test/cache.test.ts does).
const parent = temp('office-web');
cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
symlinkSync(join(repo, 'src'), join(parent, 'src'), 'dir');
const dist = join(parent, 'web', 'dist');
const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });
const js = () => readdirSync(dist).filter((f) => f.endsWith('.js'));

test('the office is flat 2D: no 3D library in any bundle or in the dependencies', () => {
  assert.equal(built.status, 0, built.stderr);
  for (const f of js()) assert.doesNotMatch(readFileSync(join(dist, f), 'utf8'), /WebGLRenderer|RoundedBoxGeometry/, f);
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.equal({ ...pkg.dependencies, ...pkg.devDependencies }.three, undefined);
});

test('floorPlan: needs-you always keeps a desk, seats keep the crew order, and the rest fold behind "+N more"', () => {
  const who = (i: number, ring: OfficeMember['ring']): OfficeMember => ({ id: `h${i}`, name: `H${i}`, kind: 'pip', mood: 'idle', ring, status: '', step: '', steps: [], things: [], busyElsewhere: false });
  const crew = Array.from({ length: 30 }, (_, i) => who(i, i % 4 === 3 ? 'needs' : i % 4 === 1 ? 'working' : ''));
  const p = floorPlan(crew, 320); // a phone: three desks and four lounge seats across
  assert.equal(p.cols, 3);
  assert.equal(p.desks.length, 7, 'all seven who need her, past the two-row fold');
  assert.ok(p.desks.every((c) => c.ring === 'needs'));
  assert.deepEqual(p.desks.map((c) => c.id), crew.filter((c) => c.ring === 'needs').map((c) => c.id), 'in the crew\'s own order');
  assert.equal(p.lounge.length, 7, 'two lounge rows, the last seat kept for "+N more"');
  assert.equal(p.desks.length + p.lounge.length + p.more, 30);
  assert.equal((p.desks.length + 1 + p.spare) % p.cols, 0, 'spare desks finish the row');
  const open = floorPlan(crew, 320, true);
  assert.equal(open.more, 0);
  assert.equal(open.desks.length + open.lounge.length, 30);
  const small = floorPlan(crew.slice(0, 3), 1000);
  assert.equal(small.more, 0);
  assert.deepEqual(small.lounge.map((c) => c.id), ['h0', 'h2']);
});

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
async function browse() {
  const server = createServer((q, s) => {
    const p = decodeURIComponent(new URL(q.url ?? '/', 'http://x').pathname).replace(/\.\.+/g, '');
    let f = join(dist, p === '/' ? 'index.html' : p);
    if (!existsSync(f) || !statSync(f).isFile()) f = join(dist, 'index.html');
    s.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); s.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = temp(`office-browser-${Date.now()}`);
  const chrome = spawn(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore', detached: true });
  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 30_000);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let page: { webSocketDebuggerUrl: string } | undefined;
  await until('a page', async () => (page = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).find((t) => t.type === 'page')), 10_000);
  const ws = new WebSocket(page!.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  after(async () => {
    // Chrome's helper processes keep writing the profile after the main one exits (see test/teach.test.ts):
    // end the whole group and wait for it, so the scratch cleanup never unlinks a live profile.
    ws.close();
    server.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
      try { process.kill(-chrome.pid!, 'SIGKILL'); } catch { /* already gone */ }
      await until('the browser to exit', () => chrome.exitCode !== null || chrome.signalCode !== null, 10_000);
    }
  });
  let id = 0;
  const waiting = new Map<number, (m: any) => void>();
  ws.on('message', (d) => { const m = JSON.parse(String(d)); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  const send = (method: string, params: object = {}) => new Promise<any>((r, j) => {
    const n = ++id; waiting.set(n, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const run = async (expression: string) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  // Count animation frames asked for, and those still pending.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const n = window.__o = { raf: 0, pending: new Set() };
    const ask = window.requestAnimationFrame.bind(window), drop = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => { n.raf++; const id = ask((t) => { n.pending.delete(id); f(t); }); n.pending.add(id); return id; };
    window.cancelAnimationFrame = (id) => { n.pending.delete(id); drop(id); };
  })()` });
  const open = async (query: string) => { await send('Page.navigate', { url: `${base}/?${query}` }); };
  return { send, run, open };
}


/** Measuring that nothing happens needs a window, so this one is a measurement, not a wait. */
const WINDOW_MS = 2000;
const quiet = (b: Awaited<ReturnType<typeof browse>>) => b.run("({ raf: __o.raf, running: document.getAnimations().filter((a) => a.playState === 'running').length })");
const room = "!!document.querySelector('.o-room .o-cell')";

test('the office keeps the battery budget: nothing moves while quiet, Reduce Motion moves nothing', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const demo of ['calm', 'office']) {
    await b.open(`demo=${demo}&day`);
    await until('the room', () => b.run(room), 30_000);
    // What is on the desks when the room opens is simply there: no hop, no drop on the first paint.
    await until('the room to settle', () => b.run("window.__o.pending.size === 0 && document.getAnimations().every((a) => a.playState !== 'running')"), 15_000);
    const q0 = await quiet(b);
    await new Promise((r) => setTimeout(r, WINDOW_MS));
    assert.deepEqual(await quiet(b), { ...q0, running: 0 }, `${demo}: no frame asked for and no animation running`);
  }
  // Someone of hers gets news: they hop once, and the room is still again after.
  await b.run("document.querySelector('.o-sprite.at-desk').animate([{ translate: '0 -10px' }, { translate: '0 0' }], 300).finished.then(() => true)");
  assert.equal((await quiet(b)).running, 0);
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await b.open('demo=office&day');
  await until('the room', () => b.run(room), 30_000);
  assert.equal((await quiet(b)).running, 0, 'Reduce Motion: nothing animates');
  await b.send('Emulation.setEmulatedMedia', { features: [] });
});

// Helpers who need her in each household (web/src/demo.ts): Scribe, Reel, Scout and Pip, then every eighth made-up one.
// ?demo=office has four helpers: Reel, Scout and Scribe need her, with first looks on their desks; Pip is busy elsewhere.
const HOUSES: [string, number, number][] = [['crew1', 1, 1], ['crew5', 5, 4], ['crew12', 12, 5], ['crew30', 30, 7], ['office', 4, 3]];
test('at 1, 5, 12 and 30 crew, on a phone and a computer, no bubble or desk thing covers another or a sprite, and every Review shows', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const [width, height, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    for (const [demo, n, needs] of HOUSES) {
      for (const theme of ['day', 'night']) {
        await b.open(`demo=${demo}&${theme}`);
        await until('the room', () => b.run(room), 30_000);
        const m = await b.run(`(() => {
          const box = (e) => e.getBoundingClientRect(), st = box(document.querySelector('.o-room'));
          const cards = [...document.querySelectorAll('.o-bub, .o-chip b, .o-more, .o-tray, .o-thing')].map(box);
          const sprites = [...document.querySelectorAll('.o-sprite')].map(box);
          const hit = (a, c) => a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5;
          const out = cards.filter((x) => x.left < st.left - 1 || x.right > st.right + 1 || x.top < st.top - 1 || x.bottom > st.bottom + 1).length;
          let over = 0;
          cards.forEach((a, i) => cards.slice(i + 1).forEach((c) => { if (hit(a, c)) over++; }));
          cards.forEach((a) => sprites.forEach((c) => { if (hit(a, c)) over++; }));
          const more = parseInt((document.querySelector('.o-more')?.textContent ?? '').replace('+', ''), 10);
          return { out, over, reviews: document.querySelectorAll('.o-bub.needs a[href^="#/ask/"]').length,
            seated: document.querySelectorAll('.o-cell .o-sprite').length - 1, more: more || 0 };
        })()`);
        const at = `${demo} ${theme} at ${width}`;
        assert.equal(m.out, 0, `${at}: every card inside the room`);
        assert.equal(m.over, 0, `${at}: no card covers another card or a sprite`);
        assert.equal(m.reviews, needs, `${at}: every helper who needs her shows Review`);
        assert.equal(m.seated + m.more, n, `${at}: everyone is in the room or behind "+N more"`);
        if (n === 30) assert.ok(m.more > 0, `${at}: a big crew folds behind "+N more"`);
      }
    }
    // The furniture is scenery: a tap on a desk front lands on its seat and opens that helper.
    await b.open('demo=crew5&day');
    await until('the room', () => b.run(room), 30_000);
    await b.run("(() => { const r = document.querySelector('.o-deskf').getBoundingClientRect(); document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).click(); })()");
    await until('the helper\'s panel', () => b.run("!!document.querySelector('.o-sheet')"), 5000);
    // "+N more" opens the whole crew, and "Show fewer" folds it again.
    await b.open('demo=crew30&day');
    await until('the room', () => b.run(room), 30_000);
    await b.run("document.querySelector('.o-more').click()");
    await until('the whole crew', () => b.run("document.querySelectorAll('.o-cell .o-sprite').length === 31"), 5000);
    await b.run("document.querySelector('.o-more').click()");
    await until('the room folded again', () => b.run("document.querySelectorAll('.o-cell .o-sprite').length < 31"), 5000);
  }
});

test('a finished file opens beside its chat: the composer stays clear of the panel', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.open(`demo&day#/f/scribe/${encodeURIComponent('files/hotel-guest-reception.xlsx')}`);
  const edges = "(() => { const c = document.querySelector('.composer'), p = document.querySelector('.wb-panel'); return c && p && p.querySelector('.wb-grid') ? { composer: c.getBoundingClientRect().right, panel: p.getBoundingClientRect().left } : null; })()";
  await until('the chat and the open workbook', () => b.run(edges), 30_000);
  const { composer, panel } = await b.run(edges);
  assert.ok(composer <= panel, `the composer ends at ${composer}px, left of the panel at ${panel}px`);
});
