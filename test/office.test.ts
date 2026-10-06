// The office's battery and layout rules, measured in a real browser on the ?demo households (web/src/office.tsx): the
// room is flat 2D with no 3D library anywhere, its motion is calm CSS loops that ask for no frame and stop off screen,
// Reduce Motion runs none at all, and at every crew size (?demo=crew1, crew5, crew12, crew30) on a phone and a computer the
// room's two labels (the one Needs you pill and the Tray bubble) sit inside it, clear of each other and of every figure.
// Needs a Chromium on PATH (skipped without one).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { taskBrowser } from './browser.ts';
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

test('one floor: five spots in roster order, whoever waits on you first, everyone else counted', () => {
  const who = (i: number, ring: OfficeMember['ring'], extra: Partial<OfficeMember> = {}): OfficeMember => ({ id: `h${i}`, name: `H${i}`, kind: 'pip', mood: 'idle', ring,
    seat: ring === 'needs' ? 'chat' : ring || 'free', status: '', step: '', steps: [], things: [], ...extra });
  const crew = Array.from({ length: 30 }, (_, i) => who(i, i % 4 === 3 ? 'needs' : i % 4 === 1 ? 'working' : ''));
  const p = floorPlan(crew);
  assert.equal(p.seats.length, 5, 'the floor never grows');
  assert.ok(p.seats.every((c) => c.ring === 'needs'), 'whoever waits on you stands first');
  assert.deepEqual(p.seats.map((c) => c.id), crew.filter((c) => c.ring === 'needs').slice(0, 5).map((c) => c.id), "in the crew's own order");
  assert.equal(p.seats.length + p.more.length, 30, 'everyone is drawn or counted under +N');
  const few = floorPlan([who(0, 'working'), who(1, '', { seat: 'waiting' }), who(2, 'needs'), who(3, '')]);
  assert.deepEqual(few.seats.map((c) => c.id), ['h2', 'h0', 'h1', 'h3'], 'needs you, working, held, free last');
  assert.equal(few.more.length, 0);
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
    tasks: [{ id: 9, bot: 'scout', title: 'Done thing', state: 'done', result: 'Three stories worth telling.', updated_at: now - min, files: [] },
      // A job that ended with nothing to say made nothing: never a thing, never the rail's Done.
      { id: 7, bot: 'scout', title: 'Silent thing', state: 'done', updated_at: now - min, files: [] },
      { id: 8, bot: 'tracer', title: 'Find the email', state: 'failed', updated_at: now - min, files: [] }],
    events: [{ kind: 'task.failed', bot: 'tracer', at: now - min, data: { title: 'Find the email' } }],
  };
  const v = A.office(state);
  const seat = Object.fromEntries(v.crew.map((c) => [c.id, A.seatOf(c)]));
  assert.deepEqual(seat, { scout: 'working', reel: 'needs', scribe: 'chat', tracer: 'failed', pip: 'waiting', h6: 'next', h7: 'free' });
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
  assert.deepEqual(v.done.map((t) => t.id), [9], 'only the job that said something');
  assert.ok(v.crew.find((c) => c.id === 'h6')!.second && v.crew.find((c) => c.id === 'h7')!.second, 'a second of a kind is marked');
  assert.deepEqual(A.roster(v.crew).map((c) => c.id), ['reel', 'scribe', 'scout', 'tracer', 'pip', 'h6', 'h7']);
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
  // The rail says a free helper's latest job landed (Main590 6); a newer seat replaces it.
  assert.deepEqual(A.railWord(done.crew.find((c) => c.id === 'scout')!, done), { word: 'Done: Job 1', seat: 'done' });
  assert.deepEqual(A.railWord(v.crew.find((c) => c.id === 'scout')!, v), { word: 'Working', seat: 'working' }, 'working beats an earlier finish');
  assert.deepEqual(A.railWord(v.crew.find((c) => c.id === 'h7')!, v), { word: 'Free', seat: 'free' }, 'nothing landed: just free');
  const again = A.officeEvent(done, { kind: 'task.working', bot: 'scout', data: { title: 'Job 4' } });
  assert.equal(A.railWord(again.crew.find((c) => c.id === 'scout')!, again).word, 'Working', 'a new job replaces the cue');
  assert.equal(done.counts.working, 0);
  // The hand-off follows the done list, not the helper's things: the demo hears file.delivered and task.done in one
  // commit, and task.done empties the desk, so a things-grew diff saw nothing and no page ever flew (J5 at 4ab7e00).
  const pair = A.officeEvent(A.officeEvent(v, { kind: 'file.delivered', bot: 'scout', data: { task: 1, path: 'files/a.pdf' } }), { kind: 'task.done', bot: 'scout', at: now, data: { task: 1, title: 'Job 1' } });
  assert.ok(pair.crew.find((c) => c.id === 'scout')!.things.length <= v.crew.find((c) => c.id === 'scout')!.things.length, 'the old signal: no growth');
  assert.deepEqual(A.handedIn(v, pair), ['scout'], 'one page, from the helper who finished');
  assert.deepEqual(A.handedIn(pair, A.officeEvent(pair, { kind: 'task.done', bot: 'scout', at: now, data: { task: 1, title: 'Job 1' } })), [], 'the same job again (the refresh) flies nothing');
  // Out of reach: nobody claims to be busy or waiting.
  const away = A.officeAway(v);
  assert.deepEqual(away.counts, { needs: 0, working: 0, done: 1 });
  assert.ok(away.crew.every((c) => A.seatOf(c) === 'waiting'));

  // Truth over time (J6/ch-pm-17): no seat crewd does not hold, and none that drifts.
  const hour = 60 * min, crew = (bots: Json[], tasks: Json[] = []) => A.office({ ...state, asks: [], events: [], bots: [bot('chief'), ...bots], tasks });
  // "Today" and "yesterday" are measured from the clock's midnight, not from now: run at 01:40, "three hours ago"
  // is yesterday, and the job that ended badly today would read as free. (main's fixture, flake found on this branch.)
  const today = new Date().setHours(0, 0, 0, 0);
  const one = (v2: A.OfficeView) => ({ seat: A.seatOf(v2.crew[0]), word: A.railWord(v2.crew[0], v2).word });
  // A job with no news past crewd's limit has gone quiet: never shown, or counted, as working.
  const quiet = crew([bot('scout', { task: task(1, 'scout', 'working'), stuck: true, quietSince: now - 9 * min })]);
  assert.deepEqual([one(quiet), quiet.counts.working], [{ seat: 'quiet', word: 'Gone quiet' }, 0]);
  assert.equal(A.idleLine(quiet), 'Nobody is working right now: 1 gone quiet.', 'the crew is not called free');
  // A job held for a sign-in waits, in crewd's own words, rather than reading free.
  const signin = crew([bot('scout')], [{ id: 2, bot: 'scout', title: 'Flights', state: 'paused', wake_at: null, result: 'Waiting for you to sign in with ChatGPT.' }]);
  assert.deepEqual([one(signin), signin.crew[0].status], [{ seat: 'waiting', word: 'Waiting' }, 'Waiting for you to sign in with ChatGPT']);
  assert.equal(A.idleLine(signin), 'Nobody is working right now: 1 waiting.');
  const share = crew([bot('scout', { pausedUntil: now + hour })], [{ id: 2, bot: 'scout', title: 'Digest', state: 'paused', wake_at: now + hour, result: 'Waiting for tomorrow: the crew has had its share of your AI today.' }]);
  assert.equal(share.crew[0].status, 'Waiting for tomorrow');
  assert.equal(A.officeEvent(crew([bot('scout', { task: task(2, 'scout', 'working') })]), { kind: 'task.paused', bot: 'scout', data: { task: 2, result: 'Waiting for you to sign in with ChatGPT.' } }).crew[0].status,
    'Waiting for you to sign in with ChatGPT', 'the live event says the same, never "free"');
  // A job that ended badly today says so whatever the clock or the chat; yesterday's is just free, like yesterday's finish.
  const failed = crew([bot('scout')], [{ id: 3, bot: 'scout', title: 'Refund', state: 'unsure', updated_at: today + hour }, { id: 1, bot: 'scout', title: 'Older', state: 'done', updated_at: today }]);
  assert.deepEqual([one(failed), failed.crew[0].status], [{ seat: 'failed', word: 'Not sure' }, 'Not sure it worked']);
  const old = crew([bot('scout')], [{ id: 3, bot: 'scout', title: 'Refund', state: 'failed', updated_at: today - hour }, { id: 1, bot: 'scout', title: 'Older', state: 'done', updated_at: today - 2 * hour, files: [] }]);
  assert.deepEqual([one(old), old.counts.done, A.idleLine(old)], [{ seat: 'free', word: 'Free' }, 0, 'Nobody is working right now. The crew is free.']);
  // A new job is only queued until crewd starts it: the event does not claim work.
  assert.equal(A.seatOf(A.officeEvent(crew([bot('scout')]), { kind: 'task.created', bot: 'scout', data: { title: 'Next' } }).crew[0]), 'free');
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
  const profile = mkdtempSync(join(tmpdir(), 'office-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
  let ws: WebSocket;
  after(async () => {
    ws?.close();
    server.close();
    await browser.close();
  });
  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 30_000);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let page: { webSocketDebuggerUrl: string } | undefined;
  await until('a page', async () => (page = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).find((t) => t.type === 'page')), 10_000);
  ws = new WebSocket(page!.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let id = 0;
  const waiting = new Map<number, (m: any) => void>();
  ws.on('message', (d) => { const m = JSON.parse(String(d)); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  const send = (method: string, params: object = {}) => new Promise<any>((r, j) => {
    const n = ++id; waiting.set(n, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: n, method, params }));
  });
  // A page error fails the test where it happens, never as a later timeout (send already rejects on protocol errors).
  const run = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
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
    // a loop that never ends, other than the thread's own loading skeleton (main's, gone once the thread has loaded)
    forever: on.filter((a) => a.effect?.getComputedTiming().iterations === Infinity && !a.effect?.target?.closest?.('.skeleton')).length,
    names: on.map((a) => (a.animationName ?? a.constructor.name) + ' on ' + (a.effect?.target?.getAttribute?.('class') ?? a.effect?.target?.tagName ?? '?') + ' (' + a.effect?.getComputedTiming().iterations + ')'),
    working: [...document.querySelectorAll('.o-cell[data-seat=working] .o-sprite')].length };
})()`);

test('the office keeps the battery budget: calm CSS loops while it shows, none off screen or with Reduce Motion', { skip: !bin && 'no Chromium here' }, async (t) => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const demo of ['calm', 'office']) {
    await b.open(`demo=${demo}&day`);
    // Chat by default: no room, so nothing of the office runs.
    await until('Chief\'s box', () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
    // What plays as Chat opens is the page's own entrances (each finite) and, while Chief's thread loads, main's loading
    // skeleton; once the thread is in, nothing runs, and any other loop that never ends fails here.
    const opening = await loops(b);
    t.diagnostic(`${demo}: Chat at first paint runs ${opening.running}: ${opening.names.join('; ') || 'nothing'}`);
    assert.equal(opening.forever, 0, `${demo}: nothing in Chat loops but the loading skeleton (${opening.names.join('; ')})`);
    await until(`${demo}: Chat to be still once the thread has loaded`, async () => !(await b.run("!!document.querySelector('.skeleton')")) && (await loops(b)).running === 0, 10_000);
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

// Each demo house (web/src/demo.ts) and its crew size. Every house has something waiting on you (?demo keeps Tracer's
// question after a crewN swap), so the room shows its one pill.
const HOUSES: [string, number][] = [['crew1', 1], ['crew5', 5], ['crew12', 12], ['crew30', 30], ['office', 5], ['after', 5], ['b1', 5], ['b1after', 5]];
test('at 1, 5, 12 and 30 crew and in the B1 mock\'s house, on a phone and a computer, nothing covers anything, the one pill is real, and counts agree', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const [width, height, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    for (const [demo, n] of HOUSES) {
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
          const cards = [...document.querySelectorAll('.o-tag')].map(box);
          const sprites = [...document.querySelectorAll('.o-sprite')].map(box);
          const hit = (a, c) => a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5;
          const out = cards.filter((x) => x.left < st.left - 1 || x.right > st.right + 1 || x.top < st.top - 1 || x.bottom > st.bottom + 1).length;
          const els = [...document.querySelectorAll('.o-tag')], sps = [...document.querySelectorAll('.o-sprite')];
          const say = (e, r) => (e.closest('[data-id]')?.dataset.id ?? 'chief') + ' ' + e.getAttribute('class') + ' ' + Math.round(r.top) + '-' + Math.round(r.bottom) + ' x' + Math.round(r.left) + '-' + Math.round(r.right);
          const pairs = [];
          cards.forEach((a, i) => cards.slice(i + 1).forEach((c, j) => { if (hit(a, c)) pairs.push(say(els[i], a) + ' x ' + say(els[i + 1 + j], c)); }));
          cards.forEach((a, i) => sprites.forEach((c, j) => { if (hit(a, c)) pairs.push(say(els[i], a) + ' x ' + say(sps[j], c)); }));
          const over = pairs.length;
          // a strip name or word wider than its cell is clipped
          const clipped = [...document.querySelectorAll('.o-cap b, .o-cap > span')].filter((e) => e.scrollWidth > e.clientWidth + 1).length;
          const pills = [...document.querySelectorAll('.o-pill')].map((a) => a.getAttribute('href'));
          const stat = Number(document.querySelector('.home-meta .m-needs')?.dataset.n), busy = Number(document.querySelector('.home-meta .m-working')?.dataset.n);
          const pinned = parseInt(document.querySelector('.needs-pin .count')?.textContent ?? '0', 10);
          const all = document.querySelector('.needs-pin .section-head .link')?.textContent ?? '';
          const names = (q) => [...document.querySelectorAll(q)].map((e) => e.textContent);
          const onIt = names('.feed .working .on-card .grow > b'), waits = names('.side-row:has(.side-seat.needs, .side-seat.chat) > b');
          // Home has no tab bar (B1): on a computer the rail's Chief count is the badge, on a phone the pinned count is
          const badge = parseInt(document.querySelector('.side-nav[href="#/"] .side-count')?.textContent ?? (innerWidth < 900 ? String(pinned) : '0'), 10);
          const more = Number(document.querySelector('.o-more')?.dataset.more ?? 0);
          // 152/153: the tray box stands on the floor in front of everyone (what is drawn at its middle is the box), the Tray
          // bubble's tail is over it and close above it (a packed row: the caption's pointer close under it, in the floor
          // band), and the label covers no ink: a pen, the z's, a screen.
          const packedRow = document.querySelector('.o-room')?.dataset.tight === 'true';
          const tb = document.querySelector('.o-traybox > path')?.getBoundingClientRect(), tt = document.querySelector('a.o-tray > path, .o-pointer')?.getBoundingClientRect();
          const bub = document.querySelector('a.o-tray rect')?.getBoundingClientRect(), unit = document.querySelector('.o-art').getScreenCTM().a;
          const inked = bub ? [...document.querySelectorAll('.o-pen, .o-zz, .o-mon')].map(box).filter((c) => hit(bub, c)).length : -1;
          // 162: the box covers no part of any figure (their drawn parts, not the soft foot shadow under them), and the whole
          // label, tail too, rests on no furniture: a desk, a note, a screen, a lamp's glow.
          const part = (e) => (e.getAttribute('class') ?? e.tagName) + ' of ' + (e.closest('[data-id]')?.dataset.id ?? 'chief');
          const boxed = tb ? [...document.querySelectorAll('.o-sprite *')].filter((e) => !/^(g|svg|defs|clipPath|mask|linearGradient|radialGradient|stop)$/.test(e.tagName) && !e.closest('defs, clipPath, mask') && !(e.tagName === 'ellipse' && e.getAttribute('filter')))
            .filter((e) => hit(tb, box(e))).map(part) : ['no box'];
          const lab = document.querySelector('a.o-tray')?.getBoundingClientRect();
          const furn = lab ? [...document.querySelectorAll('.o-desk, .o-note, .o-mon, ellipse[fill*="lamp"]')].filter((e) => hit(lab, box(e))).map(part) : ['no label'];
          const tray = tb && tt ? { onTop: !!document.elementFromPoint(tb.left + tb.width / 2, tb.top + tb.height * 0.6)?.closest('.o-traybox'), over: tt.left + tt.width / 2 >= tb.left && tt.left + tt.width / 2 <= tb.right,
            gap: (packedRow ? tt.top - tb.bottom : tb.top - tt.bottom) / unit, below: tt.top >= tb.bottom - 1, inked, boxed, furn } : null;
          return { pairs, seen: st.height > 0 && st.top >= bar - 1 && st.top < innerHeight - 40, out, over, clipped, pills, stat, badge, busy, onIt, waits, pinned, all,
            seated: document.querySelectorAll('.o-cell .o-sprite').length - 1, more: more || 0, caps: document.querySelectorAll('.o-strip .o-cap:not(.o-more)').length,
            tray2: tray, scale: Number(document.querySelector('.o-room')?.dataset.scale), tight: document.querySelector('.o-room')?.dataset.tight === 'true', roster: document.querySelectorAll('.side-row').length, tray: document.querySelector('.o-tray')?.getAttribute('aria-label') ?? null };
        })()`);
        const at = `${demo} ${theme} at ${width}`;
        try {
        assert.ok(m.seen, `${at}: Office opens on its room, below the bar and on screen, not just somewhere on the page`);
        assert.equal(m.out, 0, `${at}: every card inside the room`);
        assert.equal(m.over, 0, `${at}: no card covers another card or a sprite: ${m.pairs.join('; ')}`);
        assert.equal(m.clipped, 0, `${at}: no label in the room is cut off`);
        assert.equal(m.pills.length, m.badge > 0 ? 1 : 0, `${at}: one Needs you pill while anything waits on you, none otherwise`);
        assert.ok(m.pills.every((h: string) => /^#\/(ask|h)\/\w+/.test(h)), `${at}: the pill opens a real question or chat (${m.pills})`);
        assert.equal(m.stat, m.badge, `${at}: the header's count is the Needs-you badge`);
        assert.equal(m.pinned, m.badge, `${at}: the pinned Needs you counts the same rows`);
        if (m.badge > 1) assert.equal(m.all, `See all ${m.badge}`, `${at}: "See all N" is exact`);
        assert.equal(m.seated + m.more, n, `${at}: everyone is in the room or counted under "+N"`);
        assert.ok(m.seated <= 5, `${at}: the room never stands more than five helpers`);
        assert.equal(m.caps, m.seated + 1, `${at}: the strip names everyone standing in the room, Chief too`);
        if (!mobile) {
          assert.equal(m.roster, n, `${at}: the rail names the whole crew`);
          assert.equal(m.busy, m.onIt.length, `${at}: the header's working count is On it now`);
          assert.deepEqual(m.onIt.filter((x: string) => m.waits.includes(x)), [], `${at}: one state per helper: waiting is never also on it now`);
        }
        if (n === 30) assert.ok(m.more > 0, `${at}: a big crew is counted under "+N"`);
        // Mock size (147, 148, 152): a row the stage holds is at scale 1; one it does not first packs its desks and only then
        // scales. Five waiting on you is the tightest ordinary row: all five stand, packed, at the floor's one scale 0.953
        // before and after Reel finishes (172), the box just right of Chief and the Tray caption under it in the floor band.
        assert.ok(m.tight || m.scale === 1, `${at}: a row that is not packed stands at the mock's own scale (${m.scale})`);
        assert.ok(m.scale >= 0.89, `${at}: no row of five shrinks past the packed five-waiting row (${m.scale})`);
        if (demo === 'office' || demo === 'after') assert.deepEqual([m.seated, m.more, m.tight, m.scale], [5, 0, true, 0.953], `${at}: five on the floor, packed at one scale, nobody under "+N"`);
        if (demo === 'b1' || demo === 'b1after') assert.deepEqual([m.seated, m.scale, m.tight], [5, 1, false], `${at}: the B1 house stands all five at the mock's own spacing and scale`);
        assert.ok(m.tray2?.onTop, `${at}: the tray box is on the floor in front of everyone, never behind a desk or a body (${JSON.stringify(m.tray2)})`);
        assert.ok(m.tray2.over && m.tray2.gap >= 0 && m.tray2.gap <= 40, `${at}: the Tray label's pointer is on the box and close to it (${JSON.stringify(m.tray2)})`);
        assert.equal(m.tray2.below, m.tight, `${at}: the caption sits under the box exactly when the row is packed`);
        assert.equal(m.tray2.inked, 0, `${at}: the Tray bubble covers no pen, z or screen`);
        assert.deepEqual(m.tray2.boxed, [], `${at}: the tray box stands on clear floor, in front of no figure`);
        assert.deepEqual(m.tray2.furn, [], `${at}: the Tray label rests on no desk, note, screen or lamp`);
        // The B1 mock's own state, exactly: 1 needs you, 2 working, Tracer's list the one page in the tray.
        if (demo === 'b1') assert.deepEqual([m.stat, m.busy, m.tray], [1, 2, 'Your tray: 1 done today'], `${at}: the mock's counts`);
        } catch (e) {
          // 155: a failed case leaves its evidence, the frame as drawn and every sprite's and label's box, in the job's dir.
          const dir = process.env.OFFICE_SHOTS;
          if (dir) {
            mkdirSync(dir, { recursive: true });
            const name = `grid-fail-${demo}-${theme}-${width}`;
            writeFileSync(join(dir, `${name}.png`), Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
            writeFileSync(join(dir, `${name}.json`), JSON.stringify(await b.run(`[...document.querySelectorAll('.o-room .o-sprite, .o-room .o-tag, .o-room .o-traybox, .o-room .o-pointer, .o-room svg svg')].map((e) => {
              const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
              return { cls: e.getAttribute('class'), tag: e.tagName, box: [r.left, r.top, r.right, r.bottom].map(Math.round), w: cs.width, h: cs.height, attrs: [e.getAttribute('width'), e.getAttribute('height')] };
            })`), null, 1));
          }
          throw e;
        }
      }
    }
    // The furniture is scenery: a tap on a desk lands on its seat and opens that helper.
    await b.open('demo=crew5&day');
    await toOffice(b);
    // A computer commits its wide room asynchronously (a ResizeObserver flips wide after the first narrow layout), so a
    // desk point sampled on the narrow frame misses the desk once the wide frame lands. Wait until the room's committed
    // wide mode matches its measured content width before sampling, then press that frozen point.
    await until('the room\'s wide mode to match its measured width', () => b.run("(() => { const e = document.querySelector('.o-room'), s = getComputedStyle(e); const content = e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); return e.classList.contains('wide') === (content >= 560); })()"), 5000);
    // A real click (SVG has no .click()) at the desk's centre, and the sheet that opens is that desk's helper.
    const desk = await b.run("(() => { const d = document.querySelector('.o-cell[data-seat] .o-desk'); d.scrollIntoView({ block: 'center' }); const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, who: d.closest('.o-cell').getAttribute('aria-label') }; })()");
    for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x: desk.x, y: desk.y, button: 'left', clickCount: 1 });
    await until('the helper\'s panel', () => b.run("!!document.querySelector('.o-sheet')"), 5000);
    const sheet = await b.run("document.querySelector('.o-sheet').getAttribute('aria-label')");
    assert.ok(sheet && desk.who.startsWith(sheet), `a tap on a desk opens that desk's helper: "${sheet}" for "${desk.who}"`);
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
  await b.open(`demo&day#/f/scribe/${encodeURIComponent('files/monthly-budget.xlsx')}`);
  const edges = "(() => { const c = document.querySelector('.composer'), p = document.querySelector('.wb-panel'); return c && p && p.querySelector('.wb-grid') ? { composer: c.getBoundingClientRect().right, panel: p.getBoundingClientRect().left } : null; })()";
  await until('the chat and the open workbook', () => b.run(edges), 30_000);
  const { composer, panel } = await b.run(edges);
  assert.ok(composer <= panel, `the composer ends at ${composer}px, left of the panel at ${panel}px`);
});

test('a routine\'s switch keeps its knob inside the track, clear of its On or Paused words, day and night, phone and computer, text at 1.3x', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  // The knob is a ::after, so its box comes from the computed style; translateX counts too (two switch rules once stacked both).
  const gap = `(() => { const i = document.querySelector('.routine-switch input'); if (!i) return null; const w = i.nextElementSibling;
    const k = getComputedStyle(i, '::after'), t = new DOMMatrix(k.transform === 'none' ? undefined : k.transform), r = i.getBoundingClientRect();
    const knob = r.left + i.clientLeft + parseFloat(k.left) + t.e + parseFloat(k.width);
    return { inTrack: r.right - knob, toWords: w.getBoundingClientRect().left - knob, words: w.textContent }; })()`;
  for (const theme of ['day', 'night']) for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) for (const scale of [1, 1.3]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await b.open(`demo&${theme}#/routines`);
    await until('the routine switch', () => b.run(gap), 30_000);
    await b.run(`document.querySelectorAll('.routine-switch').forEach((s) => { s.style.fontSize = (parseFloat(getComputedStyle(s).fontSize) * ${scale}) + 'px'; }), 0`);
    const g = await b.run(gap), at = `${theme} ${w} text ${scale}x`;
    assert.ok(g.inTrack >= 0, `${at}: the knob ends ${-g.inTrack}px past its track`);
    assert.ok(g.toWords > 0, `${at}: the knob covers "${g.words}" by ${-g.toWords}px`);
  }
});
