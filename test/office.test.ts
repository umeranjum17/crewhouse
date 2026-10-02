// The office's battery and layout rules, measured in a real browser on the ?demo households (web/src/office.tsx): the
// room is flat 2D with no 3D library anywhere, its motion is calm CSS loops that ask for no frame and stop off screen,
// Reduce Motion runs none at all, and at every crew size (?demo=crew1, crew5, crew12, crew30) on a phone and a computer every bubble
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
import * as A from '../web/src/adapter.ts';
import { floorPlan, type OfficeMember } from '../web/src/adapter.ts';
import type { Json } from '../web/src/api.ts';

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

test('hot-desking: the room never grows, whoever waits on you always has a desk, everyone else is counted', () => {
  const who = (i: number, ring: OfficeMember['ring'], extra: Partial<OfficeMember> = {}): OfficeMember => ({ id: `h${i}`, name: `H${i}`, kind: 'pip', mood: 'idle', ring, status: '', step: '', steps: [], things: [], ...extra });
  const crew = Array.from({ length: 30 }, (_, i) => who(i, i % 4 === 3 ? 'needs' : i % 4 === 1 ? 'working' : ''));
  const p = floorPlan(crew);
  assert.equal(p.desks.length, 7, 'all seven who wait on you, past the four desks');
  assert.ok(p.desks.every((c) => c.ring === 'needs'));
  assert.deepEqual(p.desks.map((c) => c.id), crew.filter((c) => c.ring === 'needs').map((c) => c.id), "in the crew's own order");
  assert.equal(p.lounge.length, 3);
  assert.ok(p.lounge.every((c) => !c.ring), 'nobody working lounges');
  assert.equal(p.desks.length + p.lounge.length + p.more.length, 30, 'everyone is seated or counted under +N');
  assert.deepEqual(p.more.slice(0, 7).map((c) => c.ring), Array(7).fill('working'), '+N names the working first');
  const few = floorPlan([who(0, 'working'), who(1, ''), who(2, 'needs')]);
  assert.deepEqual(few.desks.map((c) => c.id), ['h0', 'h2']);
  assert.deepEqual(few.lounge.map((c) => c.id), ['h1']);
  assert.equal(few.more.length, 0);
  const busy = floorPlan(Array.from({ length: 6 }, (_, i) => who(i, 'working')));
  assert.equal(busy.desks.length, 4, 'four desks, the room does not grow');
  assert.deepEqual(busy.more.map((c) => c.id), ['h4', 'h5']);
  assert.equal(busy.lounge.length, 0);
});

test('office truth: the room, its counts, the tray, the roster and Needs you read one state', () => {
  const now = Date.now(), min = 60_000;
  const bot = (id: string, extra: Json = {}) => ({ id, display: id[0].toUpperCase() + id.slice(1), template: id, ...extra });
  const task = (id: number, bot: string, state: string) => ({ id, bot, title: `Job ${id}`, state, files: [] });
  const state: Json = {
    person: { id: 1, name: 'Umer' }, resting: {}, templates: [], ideas: [],
    bots: [bot('chief'), bot('scout', { task: task(1, 'scout', 'working') }), bot('reel', { task: task(2, 'reel', 'needs_you') }),
      bot('scribe', { task: task(3, 'scribe', 'needs_you') }), bot('tracer', { unread: 1 }), bot('pip', { pausedUntil: now + 60 * min }),
      bot('h6', { display: 'Bea', template: 'reel', queued: 1 }), bot('h7', { display: 'Kit', template: 'scout' })],
    asks: [
      { id: 10, bot: 'reel', task_id: 2, kind: 'question', at: now - min, detail: { question: 'Which song?' } },
      // a suggestion lives in Scribe's chat: no Review in the room, no count, never in Needs you
      { id: 11, bot: 'scribe', task_id: 3, kind: 'propose', at: now - min, detail: { words: 'Keep this?' } },
      { id: 12, bot: 'chief', kind: 'question', at: now - 2 * min, detail: { question: 'Which day?' } },
    ],
    tasks: [{ id: 9, bot: 'scout', title: 'Done thing', state: 'done', updated_at: now - min, files: [] }],
    events: [{ kind: 'task.failed', bot: 'tracer', at: now - min, data: { title: 'Find the email' } }],
  };
  const v = A.office(state);
  const seat = Object.fromEntries(v.crew.map((c) => [c.id, A.seatOf(c)]));
  assert.deepEqual(seat, { scout: 'working', reel: 'needs', scribe: 'chat', tracer: 'failed', pip: 'resting', h6: 'next', h7: 'free' });
  assert.deepEqual(v.needs.map((c) => c.id), A.needsYou(state).map((c) => c.id), 'Needs you is the office\'s own list');
  assert.equal(v.counts.needs, 2, 'Reel\'s question and Chief\'s; the suggestion is not counted');
  assert.equal(v.crew.find((c) => c.id === 'scribe')!.ask, undefined, 'no Review for a suggestion');
  assert.deepEqual(A.chiefAsks(v).map((c) => c.id), [12], 'Chief carries his own row');
  // every Needs-you row has exactly one Review holder in the room
  const holders = v.needs.map((c) => (v.crew.find((m) => m.ask?.id === c.id) ? 1 : 0) + (A.chiefAsks(v).includes(c) ? 1 : 0));
  assert.deepEqual(holders, [1, 1]);
  assert.equal(v.counts.working, A.homeCounts(state).working, 'Home\'s working count');
  assert.equal(v.counts.working, 1);
  assert.equal(v.counts.done, 1, 'the tray holds today\'s');
  assert.ok(v.crew.find((c) => c.id === 'h6')!.second && v.crew.find((c) => c.id === 'h7')!.second, 'a second of a kind is marked');
  assert.deepEqual(A.roster(v.crew).map((c) => c.id), ['reel', 'scribe', 'scout', 'tracer', 'h6', 'h7', 'pip']);
  const chats = new Map(A.chats(state).map((c) => [c.id, c.line]));
  assert.equal(chats.get('reel'), 'Needs you');
  assert.equal(chats.get('scribe'), A.SEAT_WORDS.chat, 'the chat list says what the rail says');
  // Live events move every count together.
  const answered = A.officeEvent(v, { kind: 'ask.answered', bot: 'reel', data: { ask: 10 } });
  assert.equal(answered.counts.needs, 1);
  assert.equal(answered.needs.length, 1);
  assert.equal(A.seatOf(answered.crew.find((c) => c.id === 'reel')!), 'free', 'back to what the refresh knew');
  const opened = A.officeEvent(v, { kind: 'ask.opened', bot: 'scout', data: { ask: 13 } });
  assert.equal(opened.crew.find((c) => c.id === 'scout')!.ask, undefined, 'Review waits for the refresh to bring the row');
  assert.equal(opened.counts.needs, 2);
  const done = A.officeEvent(v, { kind: 'task.done', bot: 'scout', at: now, data: { task: 1, title: 'Job 1' } });
  assert.equal(done.counts.done, 2);
  assert.equal(done.counts.working, 0);
  // Out of reach: nobody claims to be busy or waiting.
  const away = A.officeAway(v);
  assert.deepEqual(away.counts, { needs: 0, working: 0, done: 1 });
  assert.ok(away.crew.every((c) => A.seatOf(c) === 'resting'));
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
const room = "!!document.querySelector('.o-room .o-cell')";
/** Home opens on Chat; the room is the Office view, one tap away. */
const toOffice = async (b: Awaited<ReturnType<typeof browse>>) => {
  await until('the Chat | Office switch', () => b.run("!!document.querySelector('.home-mode [data-mode=office]')"), 30_000);
  await b.run("document.querySelector('.home-mode [data-mode=office]').click()");
  await until('the room', () => b.run(room), 30_000);
};

// What runs: CSS loops only (never a frame callback), each inside the room, and how many are playing.
const loops = (b: Awaited<ReturnType<typeof browse>>) => b.run(`(() => {
  const on = document.getAnimations().filter((a) => a.playState === 'running');
  return { raf: __o.raf, running: on.length, css: on.filter((a) => a.constructor.name === 'CSSAnimation').length,
    outside: on.filter((a) => !a.effect?.target?.closest?.('.o-room')).length,
    working: [...document.querySelectorAll('.o-cell[data-seat=working] .o-sprite')].length };
})()`);

test('the office keeps the battery budget: calm CSS loops while it shows, none off screen or with Reduce Motion', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const demo of ['calm', 'office']) {
    await b.open(`demo=${demo}&day`);
    // Chat by default: no room, so nothing of the office runs.
    await until('Chief\'s box', () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
    // Once the page's own entrances have played, nothing runs: a loop that never ends fails here at the bound.
    await until(`${demo}: Chat to be still`, async () => (await loops(b)).running === 0, 10_000);
    await toOffice(b);
    await until('the room to settle', () => b.run('window.__o.pending.size === 0'), 15_000);
    const q0 = await loops(b);
    await new Promise((r) => setTimeout(r, WINDOW_MS));
    const q1 = await loops(b);
    assert.equal(q1.raf, q0.raf, `${demo}: no frame asked for`);
    assert.equal(q1.running, q1.css, `${demo}: every move is a CSS loop`);
    assert.equal(q1.outside, 0, `${demo}: and every loop is in the room`);
    if (q1.working) assert.ok(q1.running > 0, `${demo}: someone working is seen working`);
    // Scrolled out of view, the room's loops hold still.
    await b.run("document.querySelector('.o-room').classList.add('off')");
    assert.equal((await loops(b)).running, 0, `${demo}: off screen, nothing plays`);
  }
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await b.open('demo=office&day');
  await toOffice(b);
  assert.equal((await loops(b)).running, 0, 'Reduce Motion: nothing animates, every pose and count is the end state');
  await b.send('Emulation.setEmulatedMedia', { features: [] });
});

// Each demo house (web/src/demo.ts): its crew size, and how many Reviews the room shows — one per helper with a row in
// Needs you, plus Chief's for rows no helper in the room holds (?demo keeps Tracer's question after a crewN swap).
const HOUSES: [string, number, number][] = [['crew1', 1, 2], ['crew5', 5, 5], ['crew12', 12, 6], ['crew30', 30, 8], ['office', 5, 5]];
test('at 1, 5, 12 and 30 crew, on a phone and a computer, nothing covers anything, every Review is real, and counts agree', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const [width, height, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    for (const [demo, n, reviews] of HOUSES) {
      for (const theme of ['day', 'night']) {
        await b.open(`demo=${demo}&${theme}`);
        // Each launch opens on Chat: no room drawn, and the pinned Needs you and Chief's box are on the first screen.
        await until('Chief\'s box', () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
        const first = await b.run(`(() => {
          const seen = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; };
          return { room: !!document.querySelector('.o-room'), pin: seen(document.querySelector('.needs-pin .needs-row')), box: seen(document.querySelector('.home-chat .composer')),
            all: document.querySelector('.needs-pin .section-head .link')?.textContent ?? '', rows: document.querySelectorAll('.needs-pin .needs-row').length };
        })()`);
        const lead = `${demo} ${theme} at ${width}, first open`;
        assert.equal(first.room, false, `${lead}: Chat by default, the room is not drawn`);
        assert.ok(first.pin && first.box, `${lead}: one pinned Needs you row and Chief's box on the first screen`);
        assert.equal(first.rows, 1, `${lead}: one pinned row`);
        // A long thread leaves the page scrolled to its end; Office must still open on its room.
        await b.run('scrollTo(0, document.documentElement.scrollHeight)');
        await toOffice(b);
        const m = await b.run(`(() => {
          const box = (e) => e.getBoundingClientRect(), st = box(document.querySelector('.o-room'));
          const bar = box(document.querySelector('.home-top')).bottom;
          const cards = [...document.querySelectorAll('.o-bub, .o-chip b, .o-more, .o-tray, .o-thing')].map(box);
          const sprites = [...document.querySelectorAll('.o-sprite')].map(box);
          const hit = (a, c) => a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5;
          const out = cards.filter((x) => x.left < st.left - 1 || x.right > st.right + 1 || x.top < st.top - 1 || x.bottom > st.bottom + 1).length;
          let over = 0;
          cards.forEach((a, i) => cards.slice(i + 1).forEach((c) => { if (hit(a, c)) over++; }));
          cards.forEach((a) => sprites.forEach((c) => { if (hit(a, c)) over++; }));
          // a label wider than its box is clipped
          const clipped = [...document.querySelectorAll('.o-bub b, .o-st > span, .o-chip b')].filter((e) => e.scrollWidth > e.clientWidth + 1).length;
          const asks = [...document.querySelectorAll('.o-bub.needs a[href^="#/ask/"]')].map((a) => a.getAttribute('href'));
          const office = document.querySelector('.office:not([hidden])');
          const [stat, busy] = [...document.querySelectorAll('.home-bar .stat')].map((e) => parseInt(e.textContent, 10));
          const pinned = parseInt(document.querySelector('.needs-pin .count')?.textContent ?? '0', 10);
          const all = document.querySelector('.needs-pin .section-head .link')?.textContent ?? '';
          const names = (q) => [...document.querySelectorAll(q)].map((e) => e.textContent);
          const onIt = names('.feed .working .list-row .grow > b'), waits = names('.side-row:has(.side-seat.needs, .side-seat.chat) .grow > b');
          const badge = parseInt(document.querySelector('.tabbar a .badge, .side-nav .badge')?.textContent ?? '0', 10);
          const more = Number(document.querySelector('.o-more')?.dataset.more ?? 0);
          return { seen: st.height > 0 && st.top >= bar - 1 && st.top < innerHeight - 40, out, over, clipped, asks, unique: new Set(asks).size, stat, badge, busy, onIt, waits, pinned, all,
            seated: document.querySelectorAll('.o-cell .o-sprite').length - 1, more: more || 0,
            roster: document.querySelectorAll('.side-row').length };
        })()`);
        const at = `${demo} ${theme} at ${width}`;
        assert.ok(m.seen, `${at}: Office opens on its room, below the bar and on screen, not just somewhere on the page`);
        assert.equal(m.out, 0, `${at}: every card inside the room`);
        assert.equal(m.over, 0, `${at}: no card covers another card or a sprite`);
        assert.equal(m.clipped, 0, `${at}: no label in the room is cut off`);
        assert.equal(m.asks.length, reviews, `${at}: one Review per helper with a row in Needs you`);
        assert.equal(m.unique, m.asks.length, `${at}: no row has two Reviews`);
        assert.equal(m.stat, m.badge, `${at}: the header's count is the Needs-you badge`);
        assert.equal(m.pinned, m.badge, `${at}: the pinned Needs you counts the same rows`);
        if (m.badge > 1) assert.equal(m.all, `See all ${m.badge}`, `${at}: "See all N" is exact`);
        assert.equal(m.seated + m.more, n, `${at}: everyone is in the room or counted under "+N"`);
        assert.ok(m.seated <= Math.max(4, reviews) + 3, `${at}: the room never grows past its desks and lounge`);
        if (!mobile) {
          assert.equal(m.roster, n + (n > 1 ? 2 : 1), `${at}: the rail names the whole crew`);
          assert.equal(m.busy, m.onIt.length, `${at}: the header's working count is On it now`);
          assert.deepEqual(m.onIt.filter((x: string) => m.waits.includes(x)), [], `${at}: one state per helper: waiting is never also on it now`);
        }
        if (n === 30) assert.ok(m.more > 0, `${at}: a big crew is counted under "+N"`);
      }
    }
    // The furniture is scenery: a tap on a desk front lands on its seat and opens that helper.
    await b.open('demo=crew5&day');
    await toOffice(b);
    await b.run("(() => { const d = document.querySelector('.o-cell[data-seat] .o-deskf'); d.scrollIntoView({ block: 'center' }); const r = d.getBoundingClientRect(); document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).click(); })()");
    await until('the helper\'s panel', () => b.run("!!document.querySelector('.o-sheet')"), 5000);
    // "+N" leads to the whole crew.
    await b.open('demo=crew30&day');
    await toOffice(b);
    await b.run("document.querySelector('.o-more').click()");
    await until('the crew page', () => b.run("location.hash === '#/crew'"), 5000);
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
