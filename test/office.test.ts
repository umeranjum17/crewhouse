// The office's battery and layout rules, measured in a real browser on the ?demo households (web/src/office.tsx): the
// panels are flat with no 3D library anywhere, their only motion is the working helmet's scan line (still otherwise,
// none under Reduce Motion), and at every crew size (?demo=crew1, crew5, crew12, crew30) on a phone and a computer
// every panel sits clear of the others, nothing clips, counts agree with A.office, and the grid scrolls past six.
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
import type { OfficeMember } from '../web/src/adapter.ts';
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

test('office truth: the panels, their counts, the tray, the roster and Needs you read one state', () => {
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
  // every Needs-you row has exactly one Review holder in the office
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
const WINDOW_MS = 600;
/** Home opens on Chat; Office is one tap away on the Chat | Office switch (found by its word, not its mode). */
const toOffice = async (b: Awaited<ReturnType<typeof browse>>) => {
  await until('the Chat | Office switch', () => b.run("[...document.querySelectorAll('.home-mode [role=tab]')].some((e) => /office/i.test(e.textContent))"), 30_000);
  await b.run("[...document.querySelectorAll('.home-mode [role=tab]')].find((e) => /office/i.test(e.textContent)).click()");
  await until('the office rows', () => b.run("!!document.querySelector('.office .panel, .office .grow-row')"), 30_000);
};

// What moves: the working helmets' scan lines only (a 140 ms re-render, never a frame callback or a CSS loop).
const helmets = (b: Awaited<ReturnType<typeof browse>>) => b.run(`(() => {
  const on = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity);
  const panels = [...document.querySelectorAll('.office .panel')];
  return { loops: on.length, panels: panels.length,
    think: panels.filter((p) => p.querySelector('.helmet')?.dataset.mode === 'think').length,
    art: panels.map((p) => p.querySelector('.helmet')?.textContent ?? '') };
})()`);

test('the office keeps the battery budget: a scan line while working, still otherwise, none with Reduce Motion', { skip: !bin && 'no Chromium here' }, async (t) => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const demo of ['calm', 'office']) {
    await b.open(`demo=${demo}&day`);
    await until("Chief's box", () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
    await toOffice(b);
    const q0 = await helmets(b);
    t.diagnostic(`${demo}: ${q0.panels} panels, ${q0.think} thinking`);
    assert.equal(q0.loops, 0, `${demo}: no looping animation in the office`);
    await new Promise((r) => setTimeout(r, WINDOW_MS));
    const q1 = await helmets(b);
    const moved = q0.art.filter((a: string, i: number) => a !== q1.art[i]).length;
    assert.equal(moved, q1.think, `${demo}: exactly the thinking helmets move (${moved} of ${q1.panels})`);
    if (demo === 'calm') assert.equal(q1.think, 0, 'calm: nobody works, every helmet still');
    else assert.ok(q1.think > 0, 'office: someone working is seen working');
  }
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await b.open('demo=office&day');
  await toOffice(b);
  const r0 = await helmets(b);
  await new Promise((r) => setTimeout(r, WINDOW_MS));
  assert.deepEqual((await helmets(b)).art, r0.art, 'Reduce Motion: every helmet still, even at work');
  await b.send('Emulation.setEmulatedMedia', { features: [] });
});

// Each demo house and its crew size.
const HOUSES: [string, number][] = [['crew1', 1], ['crew5', 5], ['crew12', 12], ['crew30', 30], ['office', 5], ['calm', 5], ['finished', 5]];
test('at 1, 5, 12 and 30 crew, on a phone and a computer, every row and panel is clear and whole, and counts agree', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const [width, height, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    for (const [demo, n] of HOUSES) {
      for (const theme of ['day', 'night']) {
        await b.open(`demo=${demo}&${theme}`);
        await until("Chief's box", () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
        // Each launch opens on Chat: no room drawn, no pinned card in the conversation, and the thread with Chief's box on the first screen.
        await until('a thread line', () => b.run("document.querySelectorAll('.home-chat .lines .line').length > 0"), 30_000);
        const first = await b.run(`(() => {
          const seen = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; };
          const lines = [...document.querySelectorAll('.home-chat .lines .line')];
          const asks = [...document.querySelectorAll('.home-chat .lines .ask')].map((e) => ({ text: e.innerText ?? '', on: (() => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < innerHeight && r.bottom > 0; })() }));
          return { room: !!document.querySelector('.o-room'), pin: seen(document.querySelector('.home-chat .needs-pin .needs-row')), thread: lines.length > 0 && seen(lines.at(-1)), box: seen(document.querySelector('.home-chat .composer')), asks };
        })()`);
        const lead = `${demo} ${theme} at ${width}, first open`;
        assert.equal(first.room, false, `${lead}: Chat by default, the room is not drawn`);
        assert.equal(first.pin, false, `${lead}: no pinned card in the conversation (the ask sits inline)`);
        assert.ok(first.thread && first.box, `${lead}: the conversation and Chief's box on the first screen`);
        // Where the demo has an ask, the pinned row's replacement is the inline ask itself: its words in the thread, on screen.
        if (first.asks.length) assert.ok(first.asks.some((a: { text: string; on: boolean }) => a.on && a.text.length > 40), `${lead}: the inline ask carries its words on the first screen (${first.asks.map((a: { text: string }) => JSON.stringify(a.text.slice(0, 60))).join(' | ')})`);
        // A long thread leaves the page scrolled to its end; Office must still open on its room.
        await b.run('scrollTo(0, document.documentElement.scrollHeight)');
        await toOffice(b);
        // Phone width renders the grouped list, a desk the panels; the slim header's count line reads on both.
        const m = await b.run(`(() => {
          const narrow = innerWidth < 900;
          const units = [...document.querySelectorAll(narrow ? '.office .grow-row' : '.office .panel')];
          const box = (e) => e.getBoundingClientRect(), st = box(document.querySelector('.office'));
          const hit = (a, c) => a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5;
          const rects = units.map(box);
          const pairs = [];
          rects.forEach((a, i) => rects.slice(i + 1).forEach((c, j) => { if (hit(a, c)) pairs.push(i + ' x ' + (i + 1 + j)); }));
          const out = rects.filter((r) => r.left < st.left - 1 || r.right > st.right + 1).length;
          const clipped = units.flatMap((p) => [...p.querySelectorAll('b, .p-line, .p-meta, .p-steps span, .btn')])
            .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent?.slice(0, 40));
          const names = units.map((p) => p.getAttribute('aria-label'));
          const line = document.querySelector('.office-counts')?.textContent ?? '';
          const nums = [...line.matchAll(/(\\d+) (?:needs? you|at work|done|resting)/g)].map((x) => Number(x[1]));
          const pinned = Number(document.querySelector('.office-main .needs-pin .count')?.textContent ?? 0);
          const onCards = document.querySelectorAll('.office-main .on-card').length;
          const memberNeeds = units.filter((p) => !/^Chief:/.test(p.getAttribute('aria-label') ?? '') && p.querySelector('.p-state.needs')).length;
          const chiefGlows = units.some((p) => /^Chief:/.test(p.getAttribute('aria-label') ?? '') && p.querySelector('.p-state.needs'));
          const chiefRests = units.some((p) => /^Chief:/.test(p.getAttribute('aria-label') ?? '') && p.querySelector('.p-state.rest'));
          const chiefWorks = units.some((p) => /^Chief:/.test(p.getAttribute('aria-label') ?? '') && p.querySelector('.p-state.work'));
          const work = units.filter((p) => p.querySelector('.p-state.work')).length;
          const done = units.filter((p) => p.querySelector('.p-state.done')).length;
          const rest = units.filter((p) => p.querySelector('.p-state.rest')).length;
          const modes = [...new Set(units.map((p) => p.querySelector('.helmet')?.dataset.mode))];
          const words = units.map((p) => p.querySelector('.p-state')?.textContent?.trim());
          const acts = units.flatMap((p) => [...p.querySelectorAll('.btn')]).map((e) => e.textContent);
          const groups = [...document.querySelectorAll('.office .grp')].map((g) => g.getAttribute('aria-label'));
          const office = document.querySelector('.office-main > .office');
          return { narrow, units: units.length, pairs, out, clipped, names, nums, pinned, onCards, memberNeeds, chiefGlows, chiefRests, chiefWorks, work, done, rest, modes, words, acts, groups,
            scroll: document.documentElement.scrollHeight > innerHeight + 1 || (office && office.scrollHeight > office.clientHeight + 1),
            cols: narrow ? 1 : getComputedStyle(document.querySelector('.panels')).gridTemplateColumns.split(' ').length };
        })()`);
        const at = `${demo} ${theme} at ${width}`;
        try {
          assert.deepEqual(m.nums.length, 4, `${at}: the header counts needs, work, done and resting (${m.nums})`);
          assert.deepEqual([...new Set(m.names)].length, m.units, `${at}: nobody twice, nobody missing`);
          assert.equal(m.out, 0, `${at}: every row inside the office column`);
          assert.equal(m.pairs.length, 0, `${at}: no row covers another: ${m.pairs.join('; ')}`);
          assert.deepEqual(m.clipped, [], `${at}: no word cut off`);
          assert.equal(m.nums[0], m.pinned, `${at}: the header's needs count is the pinned Needs you`);
          assert.equal(m.nums[1], m.onCards, `${at}: the header's working count is On it now`);
          assert.equal(m.nums[1], m.work - (m.chiefWorks ? 1 : 0), `${at}: the at-work count is the working rows`);
          assert.equal(m.nums[2], m.done, `${at}: the done count is the done rows`);
          // Chief's own resting panel is not a crew row.
          assert.equal(m.nums[3], m.rest - (m.chiefRests ? 1 : 0), `${at}: the resting count is the resting rows`);
          // Needs-you rows no crew row holds ride on Chief's: his panel glows exactly when rows are left over.
          // Phone width has no Chief row; the leftover rows live in the pinned Needs you, counted above.
          if (width < 900) assert.ok(m.memberNeeds <= m.nums[0], `${at}: no crew row holds a row twice (${m.memberNeeds} held, ${m.nums[0]} rows)`);
          else assert.equal(m.chiefGlows, m.nums[0] > m.memberNeeds, `${at}: Chief carries the leftover needs rows (${m.nums[0]} rows, ${m.memberNeeds} on crew panels)`);
          assert.ok(m.acts.every((a: string) => a !== 'Review…'), `${at}: every action wears its ask's own label (${m.acts.join(' | ')})`);
          if (width < 900) {
            assert.equal(m.units, n, `${at}: every helper has exactly one grouped row`);
            const order = ['Needs you', 'At work', 'Done today', 'Resting'];
            assert.ok(m.groups.every((g: string) => order.includes(g)) && m.groups.length === new Set(m.groups).size, `${at}: only the board's groups (${m.groups})`);
            assert.deepEqual([...m.groups].sort((a: string, b: string) => order.indexOf(a) - order.indexOf(b)), m.groups, `${at}: groups in the board's order`);
          } else {
            assert.equal(m.units, n + 1, `${at}: Chief plus every helper has a panel`);
            assert.equal(m.cols, 3, `${at}: three columns on a desk`);
          }
          if (n === 30) assert.ok(m.scroll, `${at}: thirty rows scroll past six, on the page or in the column`);
          assert.ok(m.modes.every((x: string) => ['here', 'needs', 'think', 'rest'].includes(x)), `${at}: helmets wear only their four moods (${m.modes})`);
          assert.ok(m.words.every((w: string) => !/session|terminal|console|pane|live|split|shell|tmux|command|prompt|cursor/i.test(w)), `${at}: no terminal words in the state words (${m.words.join(' | ')})`);
        } catch (e) {
          const dir = process.env.OFFICE_SHOTS;
          if (dir) {
            mkdirSync(dir, { recursive: true });
            const name = `grid-fail-${demo}-${theme}-${width}`;
            writeFileSync(join(dir, `${name}.png`), Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
            writeFileSync(join(dir, `${name}.json`), JSON.stringify(m, null, 1));
          }
          throw e;
        }
      }
    }
    // Day draws day art and night draws night art: the same helmets differ between the two.
    const art: string[] = [];
    for (const theme of ['day', 'night']) {
      await b.open(`demo=crew5&${theme}`);
      await toOffice(b);
      art.push(await b.run("[...document.querySelectorAll('.office .helmet')].map((h) => h.textContent).join('\\n')"));
    }
    assert.notEqual(art[0], art[1], `day and night draw different helmets at ${width}`);
  }
});


test('your crew reads whole: every face is the drawn helmet, and no row overlaps or clips, phone and computer, day and night', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const rows = `(() => [...document.querySelectorAll('.crew-row')].map((row) => {
    const r = row.getBoundingClientRect(), kids = [...row.children].map((e) => e.getBoundingClientRect());
    const overlap = kids.some((a, i) => kids.some((c, j) => j > i && a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1));
    const clip = kids.some((k) => k.left < r.left - 1 || k.right > r.right + 1);
    return { faces: row.querySelectorAll('.face img.ink').length + (row.querySelector('.face.add') ? 1 : 0), kids: kids.length, overlap, clip };
  }))()`;
  for (const theme of ['day', 'night']) for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await b.open(`demo=crew5&${theme}#/crew`);
    await until('the crew rows', () => b.run("document.querySelectorAll('.crew-row').length > 3"), 30_000);
    const found = await b.run(rows), at = `${theme} ${w}`;
    assert.ok(found.length > 3, `${at}: the crew lists every helper (${found.length} rows)`);
    for (const [i, f] of found.entries()) {
      assert.equal(f.faces, 1, `${at} row ${i}: one drawn helmet face`);
      assert.ok(!f.overlap, `${at} row ${i}: name, role and status never overlap`);
      assert.ok(!f.clip, `${at} row ${i}: nothing spills past the row`);
    }
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
