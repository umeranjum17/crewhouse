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
import { until, setup, settled, release, holding } from './lab.ts';
import { startServer } from '../src/server.ts';

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

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
async function browse(external?: string) {
  const server = createServer((q, s) => {
    const p = decodeURIComponent(new URL(q.url ?? '/', 'http://x').pathname).replace(/\.\.+/g, '');
    let f = join(dist, p === '/' ? 'index.html' : p);
    if (!existsSync(f) || !statSync(f).isFile()) f = join(dist, 'index.html');
    s.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); s.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = external ?? `http://127.0.0.1:${(server.address() as { port: number }).port}`;
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
  const open = async (query: string, path = '/') => { await send('Page.navigate', { url: `${base}${path}?${query}` }); };
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
          return { room: !!document.querySelector('.o-room'), pin: seen(document.querySelector('.home-chat .needs-pin .needs-row')), chatPin: Number(document.querySelector('.home-chat .needs-pin .count')?.textContent ?? 0), thread: lines.length > 0 && seen(lines.at(-1)), box: seen(document.querySelector('.home-chat .composer')), asks };
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
          const nums = [...line.matchAll(/(\\d+) (?:waiting|at work|done|free)/g)].map((x) => Number(x[1]));
          const officePins = document.querySelectorAll('.needs-pin').length;
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
          const memberWords = units.filter((p) => !/^Chief:/.test(p.getAttribute('aria-label') ?? '')).map((p) => p.querySelector('.p-state')?.textContent?.trim());
          const chiefWord = units.filter((p) => /^Chief:/.test(p.getAttribute('aria-label') ?? '')).map((p) => p.querySelector('.p-state')?.textContent?.trim())[0];
          const crewUnits = units.filter((p) => !/^Chief:/.test(p.getAttribute('aria-label') ?? ''));
          const crewActs = crewUnits.flatMap((p) => [...p.querySelectorAll('button, .btn')]).map((e) => e.textContent);
          const crewText = crewUnits.map((p) => p.innerText);
          const waitRows = crewUnits.filter((p) => p.querySelector('.p-state.needs')).map((p) => [p.querySelector('.p-line')?.textContent, p.querySelector('.p-meta')?.textContent]);
          const doneText = crewUnits.filter((p) => p.querySelector('.p-state.done')).map((p) => p.innerText);
          const pinnedTop = document.querySelector('.home-office .home-top');
          const topH = pinnedTop ? pinnedTop.getBoundingClientRect().height : 0, topNotes = pinnedTop ? pinnedTop.querySelectorAll('.card, .nudge').length : 0;
          const toChief = [...document.querySelectorAll('.office a.btn')].filter((e) => !crewUnits.some((p) => p.contains(e))).map((e) => [e.textContent, e.getAttribute('href')]);
          const idle = document.querySelector('[aria-label="On it now"] .frame-empty')?.textContent ?? '';
          // The chat list beside the Office (phone): each crew row by name, with its line and whether it has a dot.
          const chatRows = [...document.querySelectorAll('[aria-label="Chats"] .list-row')].map((r) => [r.querySelector('b')?.textContent, r.querySelector('.small')?.textContent, !!r.querySelector('.badge'), r.querySelector('.p-state')?.textContent?.trim()]);
          const grouped = [...document.querySelectorAll('.office .grp')].flatMap((g) => [...g.querySelectorAll('.grow-row')].map((r) => [(r.getAttribute('aria-label') ?? '').split(':')[0], g.getAttribute('aria-label')]));
          const officeText = document.querySelector('.office')?.innerText ?? '';
          const groups = [...document.querySelectorAll('.office .grp')].map((g) => g.getAttribute('aria-label'));
          const office = document.querySelector('.office-main > .office');
          return { narrow, units: units.length, pairs, out, clipped, names, nums, officePins, onCards, memberNeeds, chiefGlows, chiefRests, chiefWorks, work, done, rest, modes, words, memberWords, chiefWord, crewActs, crewText, waitRows, doneText, topH, topNotes, toChief, idle, officeText, chatRows, grouped, groups,
            scroll: document.documentElement.scrollHeight > innerHeight + 1 || (office && office.scrollHeight > office.clientHeight + 1),
            cols: narrow ? 1 : getComputedStyle(document.querySelector('.panels')).gridTemplateColumns.split(' ').length };
        })()`);
        const at = `${demo} ${theme} at ${width}`;
        m.pinned = first.chatPin;
        try {
          // Needs you is pinned over Chief's thread only: the Office reaches the asks through Chief's one action.
          assert.equal(m.officePins, 0, `${at}: Office renders no Needs you pin`);
          assert.deepEqual(m.nums.length, 4, `${at}: the header counts waiting, at work, done and free (${m.nums})`);
          assert.deepEqual([...new Set(m.names)].length, m.units, `${at}: nobody twice, nobody missing`);
          assert.equal(m.out, 0, `${at}: every row inside the office column`);
          assert.equal(m.pairs.length, 0, `${at}: no row covers another: ${m.pairs.join('; ')}`);
          assert.deepEqual(m.clipped, [], `${at}: no word cut off`);
          // One status per member: the header counts every member once by the word its row shows, Chief too (his
          // "Needs you" counts as waiting).
          const groupOf = (w: string) => /^Done/.test(w) ? 2 : w === 'Waiting' || w === 'Up next' || w === 'Needs you' ? 0 : w === 'At work' ? 1 : 3;
          const seen = [0, 0, 0, 0];
          for (const w of m.words as string[]) seen[groupOf(w)]++;
          const extra = m.nums.map((x: number, i: number) => x - seen[i]);
          assert.deepEqual(m.nums, seen, `${at}: the header counts the rows' own words, Chief's too (${extra}: ${m.words.join(' | ')})`);
          assert.equal(m.onCards, m.work - (m.chiefWorks ? 1 : 0), `${at}: On it now shows the crew at work`);
          // Needs-you rows no crew row holds ride on Chief's: his panel glows exactly when rows are left over.
          // Phone width has no Chief row; the leftover rows live in the pinned Needs you, counted above.
          if (width < 900) assert.ok(m.memberNeeds <= m.pinned, `${at}: no crew row holds a row twice (${m.memberNeeds} held, ${m.pinned} rows)`);
          else assert.equal(m.chiefGlows, m.pinned > m.memberNeeds, `${at}: Chief carries the leftover needs rows (${m.pinned} rows, ${m.memberNeeds} on crew panels)`);
          // Only Chief says "Needs you": no crew panel or grouped row does, in the Office too.
          assert.ok(m.memberWords.every((w: string) => w !== 'Needs you'), `${at}: no crew panel says "Needs you" (${m.memberWords.join(' | ')})`);
          if (m.chiefGlows) assert.equal(m.chiefWord, 'Needs you', `${at}: Chief still says "Needs you"`);
          // Crew never ask the person: no crew panel or row answers or approves, or leads with the ask's head; a waiting one
          // waits for Chief, and Chief's one action carries every ask (Needs you's count) to his thread.
          assert.deepEqual(m.crewActs, [], `${at}: no crew panel or row has an answer or approve button`);
          assert.ok(m.crewText.every((x: string) => !/has a question|needs your OK|Review .*order|Answer |Place order/i.test(x)), `${at}: no crew panel or row carries the ask (${m.crewText.join(' | ')})`);
          // Every waiting row reads its job (or plainly no job) over "Waiting for Chief"; the status is never promoted to its title.
          assert.ok(m.waitRows.every(([l, meta]: string[]) => l && l !== 'Waiting for Chief' && l !== 'No job right now' && meta === 'Waiting for Chief'), `${at}: a waiting row is its job, then "Waiting for Chief"; one with no job rests (${JSON.stringify(m.waitRows)})`);
          assert.ok(m.doneText.every((x: string) => !/waiting/i.test(x)), `${at}: a done row never says waiting (${m.doneText.join(' | ')})`);
          // Nobody in the Office is said to need the person or ask them for an OK: crew wait for Chief, Chief carries the asks.
          assert.doesNotMatch(m.officeText, /\w needs you|your OK/, `${at}: no crew member asks the person in the Office`);
          // On it now's idle line uses the rows' words and the header's waiting count.
          assert.ok(!/on you/.test(m.idle) && (!/^No helper is at work:/.test(m.idle) || m.idle === `No helper is at work: ${m.memberNeeds} waiting for Chief.`), `${at}: On it now says the ${m.memberNeeds} waiting rows wait for Chief (${m.idle})`);
          // One status per crew member: the chat list says what the Office group does, and an ask dots only Chief's row.
          const chat = new Map<string, { line: string; dot: boolean; word: string }>(m.chatRows.map(([name, line, dot, word]: [string, string, boolean, string]) => [name, { line, dot, word }]));
          for (const [name, g] of m.grouped as [string, string][]) {
            const row = chat.get(name);
            if (!row || name === 'Chief') continue;
            // A chats row reads its thread's last line (or the helper's role before it ever spoke), never the
            // status word: the word lives in the row's end column, the same word the Office group shows.
            if (g === 'Waiting') assert.equal(row.word, 'Waiting', `${at}: ${name} shows the same status in Chats`);
            if (g === 'Done today') assert.equal(row.word, 'Done', `${at}: ${name} shows the same status in Chats`);
            if (g === 'Waiting') assert.notEqual(row.line, 'Waiting', `${at}: ${name} waits in the Office but its row reads its last line`);
            if (g === 'Done today') assert.doesNotMatch(row.line, /^Done: /, `${at}: ${name} is done in the Office but its row reads its last line`);
            if (g === 'Waiting' || g === 'Done today') assert.equal(row.dot, false, `${at}: ${name}'s chat row has no dot for an ask Chief carries`);
          }
          // Only the bar stays put over the Office; the banner and nudges scroll with the rows, so none hides half a row.
          assert.equal(m.topNotes, 0, `${at}: no card or nudge pinned over the Office`);
          assert.ok(m.topH < 0.4 * height, `${at}: the pinned bar stays short (${m.topH}px of ${height})`);
          assert.deepEqual(m.toChief, m.pinned ? [[`Chief has ${m.pinned} thing${m.pinned === 1 ? '' : 's'} for you`, '#/chief']] : [], `${at}: one Chief action, with the count, opening Chief`);
          if (width < 900) {
            assert.equal(m.units, n + (m.chiefWord ? 1 : 0), `${at}: every helper has exactly one grouped row, and Chief one in his group`);
            const order = ['Waiting', 'At work', 'Done today', 'Free'];
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


test('your crew reads whole: every face is the drawn helmet in its own shape, and no row overlaps or clips, phone and computer, day and night', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const rows = `(() => [...document.querySelectorAll('.crew-row')].map((row) => {
    const r = row.getBoundingClientRect(), kids = [...row.children].map((e) => e.getBoundingClientRect());
    const overlap = kids.some((a, i) => kids.some((c, j) => j > i && a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1));
    const clip = kids.some((k) => k.left < r.left - 1 || k.right > r.right + 1);
    // The helmet's box follows the drawing (its viewBox): a box forced to another shape squashes or shrinks the head.
    const squashed = [...row.querySelectorAll('.face img.ink')].filter((i) => !i.naturalHeight
      || Math.abs(i.width / i.height - i.naturalWidth / i.naturalHeight) > 0.05).length;
    return { faces: row.querySelectorAll('.face img.ink').length + (row.querySelector('.face.add') ? 1 : 0), kids: kids.length, overlap, clip, squashed };
  }))()`;
  for (const theme of ['day', 'night']) for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await b.open(`demo=crew5&${theme}#/crew`);
    await until('the crew rows', () => b.run("document.querySelectorAll('.crew-row').length > 3 && [...document.querySelectorAll('.face img.ink')].every((i) => i.complete)"), 30_000);
    const found = await b.run(rows), at = `${theme} ${w}`;
    assert.ok(found.length > 3, `${at}: the crew lists every helper (${found.length} rows)`);
    for (const [i, f] of found.entries()) {
      assert.equal(f.faces, 1, `${at} row ${i}: one drawn helmet face`);
      assert.equal(f.squashed, 0, `${at} row ${i}: the helmet keeps its own shape`);
      assert.ok(!f.overlap, `${at} row ${i}: name, role and status never overlap`);
      assert.ok(!f.clip, `${at} row ${i}: nothing spills past the row`);
    }
  }
  // Only Chief says "Needs you" (Main: one person, one Chief): a crew member waiting on the person reads "Waiting", on the
  // crew page and on the desk rail beside Chief. `?demo` is the mixed crew whose Tracer waits on the person.
  for (const theme of ['day', 'night']) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.open(`demo&${theme}#/crew`);
    await until('the crew rows', () => b.run("document.querySelectorAll('.crew-row').length > 3"), 30_000);
    const page = await b.run("[...document.querySelectorAll('.crew-row .status-word')].map((e) => e.textContent)"), at = `${theme} crew page`;
    assert.ok(!page.includes('Needs you'), `${at}: no crew row says "Needs you" (${page.join(' | ')})`);
    assert.ok(page.includes('Waiting'), `${at}: a waiting crew member says "Waiting" (${page.join(' | ')})`);
    await b.open(`demo&${theme}`);
    await until('the desk rail', () => b.run("document.querySelectorAll('.side-row').length > 3"), 30_000);
    const rail = await b.run("[...document.querySelectorAll('.side-row .side-seat')].map((e) => e.textContent)"), atRail = `${theme} rail`;
    assert.ok(!rail.includes('Needs you'), `${atRail}: no crew rail row says "Needs you" (${rail.join(' | ')})`);
    assert.equal(await b.run("document.querySelector('.side-status')?.textContent"), 'Needs you', `${atRail}: Chief still says "Needs you"`);
  }
});

test('the desk rail summary under Chief counts the same status its rows show', { skip: !bin && 'no Chromium here' }, async () => {
  // The rail's count line is the Office's own summary (summaryOf, from A.groupOf); so it must equal the rail rows'
  // own status. The old ad-hoc line counted every non-working, non-ask member as "resting" (the reported bug: the
  // summary said "1 resting" while the member's row said "Waiting"). This fails on that line.
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // The rail's own words, mapped to the four Office groups the summary counts.
  const group = (w: string) => w.startsWith('Done') ? 'done'
    : w === 'Waiting' || w === 'Up next' || w === 'Needs you' ? 'waiting'
    : w === 'At work' ? 'at work'
    : 'free';
  for (const demo of ['maya', 'b1', 'crew5', 'crew12', 'calm', 'finished']) {
    await b.open(`demo=${demo}&day#/crew`);
    await until('the desk rail', () => b.run("document.querySelectorAll('.side-row').length > 0"), 30_000);
    const r = await b.run(`(() => {
      const words = [...document.querySelectorAll('.side-row .side-seat')].map((e) => e.textContent.trim());
      const chief = document.querySelector('.side-status')?.textContent.trim() ?? '';
      words.push(chief);
      const sub = document.querySelector('.side-sub')?.textContent ?? '';
      const nums = Object.fromEntries([...sub.matchAll(/(\\d+) (waiting|at work|done|free)/g)].map((x) => [x[2], Number(x[1])]));
      return { words, nums };
    })()`);
    const counted: Record<string, number> = { waiting: 0, 'at work': 0, done: 0, free: 0 };
    for (const w of r.words as string[]) counted[group(w)]++;
    assert.deepEqual(r.nums, counted, `${demo}: the rail summary is the rows' own status (${JSON.stringify(r)})`);
  }
});

test('your crew page reads the rail status: every row matches its rail row', { skip: !bin && 'no Chromium here' }, async () => {
  // The Your crew page's status word and dot are the rail's own (A.statusOf). This fails on a
  // second status rule (the reported bug: Reel and Scout showed their job with a green dot while the rail said
  // Waiting, and Scribe said "Waiting for Chief" while the rail said Done).
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const demo of ['maya', 'b1', 'crew5', 'crew12', 'calm', 'finished']) {
    await b.open(`demo=${demo}&day#/crew`);
    await until('the crew rows', () => b.run("document.querySelectorAll('.crew-row').length > 3"), 30_000);
    const r = await b.run(`(() => {
      const page = Object.fromEntries([...document.querySelectorAll('.crew-row')].filter((row) => row.querySelector('.status-word')).map((row) => [
        row.querySelector('.grow b')?.textContent.trim(),
        [row.querySelector('.status-word')?.textContent.trim(), !!row.querySelector('.status-word i.working')],
      ]));
      const rail = Object.fromEntries([...document.querySelectorAll('.side-row')].map((row) => [
        row.querySelector('b')?.textContent.trim(),
        [row.querySelector('.side-seat')?.textContent.trim(), !!row.querySelector('.side-seat.seat-working, .side-seat.seat-done')],
      ]));
      return { page, rail };
    })()`);
    const page = r.page as Record<string, [string, boolean]>, rail = r.rail as Record<string, [string, boolean]>;
    assert.ok(Object.keys(rail).length > 2, `${demo}: the rail lists the crew (${JSON.stringify(rail)})`);
    for (const [name, status] of Object.entries(rail)) {
      assert.deepEqual(page[name], status, `${demo}: the crew page reads ${name} as the rail does (${JSON.stringify(status)})`);
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

test('a stepper\'s step labels split only between words, never mid-word, at the narrowest phones and text at 1.3x', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  // A word that spans two line boxes is a mid-word break: find every word whose own Range reports more than one rect.
  const broken = `(() => { const out = []; for (const li of document.querySelectorAll('.progress li')) {
    const tn = [...li.childNodes].find((n) => n.nodeType === 3); if (!tn) continue;
    const re = /\\S+/g; let m; while ((m = re.exec(tn.textContent))) {
      const r = document.createRange(); r.setStart(tn, m.index); r.setEnd(tn, m.index + m[0].length);
      if (r.getClientRects().length > 1) out.push(m[0]);
    }
  } return out; })()`;
  for (const [w, h] of [[320, 800], [360, 800], [390, 844]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await b.open('demo&sheet=signin&phase=waiting&night#/settings');
    await until('the three steps', () => b.run("document.querySelectorAll('.progress li').length === 3"), 30_000);
    await b.run("document.querySelectorAll('.progress li').forEach((li) => { li.style.fontSize = (parseFloat(getComputedStyle(li).fontSize) * 1.3) + 'px'; }), 0");
    const split = await b.run(broken), at = `${w}px text 1.3x`;
    assert.deepEqual(split, [], `${at}: no step word breaks mid-word (${split.join(', ')})`);
    const over = await b.run('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    assert.equal(over, 0, `${at}: the page never scrolls sideways`);
  }
});

test('things, routines and helper details read Term: shared tiles, one blue primary, names in full, nothing overlaps', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  // Old-style markers: the pastel file chip and the coral result link. Their Term replacements carry the rows.
  const markers = `(() => ({ chips: document.querySelectorAll('.file-chip').length,
    coral: document.querySelectorAll('.link.pink').length,
    tiles: [...document.querySelectorAll('.thing-list .o-ic, .detail .o-ic')].map((e) => e.textContent),
    primary: [...document.querySelectorAll('.routine .btn.go, .wb-panel .btn.go')].map((e) => e.textContent),
    rows: [...document.querySelectorAll('.thing-list .row-item, .routine, .detail .list-row')].map((row) => {
      const r = row.getBoundingClientRect(), kids = [...row.children].map((e) => e.getBoundingClientRect());
      const overlap = kids.some((a, i) => kids.some((c, j) => j > i && a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1));
      const clip = kids.some((k) => k.left < r.left - 1 || k.right > r.right + 1);
      const cut = [...row.querySelectorAll('b')].some((e) => e.scrollWidth > e.clientWidth + 1);
      return { overlap, clip, cut };
    }) }))()`;
  for (const theme of ['day', 'night']) for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    const at = `${theme} ${w}`;
    await b.open(`demo&${theme}#/things`);
    await until('the things rows', () => b.run("document.querySelectorAll('.thing-list .row-item').length > 0"), 30_000);
    let m = await b.run(markers);
    assert.equal(m.chips, 0, `${at} things: no old file chips`);
    assert.ok((m.tiles as string[]).length > 0 && (m.tiles as string[]).every((t) => t.trim().length > 0), `${at} things: every file row wears its extension tile`);
    await b.open(`demo&${theme}#/routines`);
    await until('the routine rows', () => b.run("document.querySelectorAll('.routine').length > 0"), 30_000);
    m = await b.run(markers);
    assert.equal(m.coral, 0, `${at} routines: no coral result link`);
    assert.ok(((m.primary as string[]).some((t) => /Do it now|Download/.test(t ?? ''))), `${at} routines: one filled-blue primary per row`);
    await b.open(`demo&${theme}#/h/scribe/details`);
    await until("scribe's files", () => b.run("document.querySelectorAll('.detail .list-row').length > 0"), 30_000);
    m = await b.run(markers);
    assert.equal(m.chips, 0, `${at} helper details: no old file chips`);
    assert.ok(m.tiles.length > 0, `${at} helper details: finished work wears the shared tile`);
    for (const [i, r] of m.rows.entries()) {
      assert.ok(!r.overlap, `${at} row ${i}: never overlaps`);
      assert.ok(!r.clip, `${at} row ${i}: nothing spills past the row`);
      assert.ok(!r.cut, `${at} row ${i}: names read in full`);
    }
  }
});

test('first run and the Share sheet read Term: helmet faces, shared tiles, no bubble, one blue primary, words in full', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const look = `(() => { const W = innerWidth, sp = document.querySelector('.speech'), st = sp && getComputedStyle(sp);
    const boxes = (sel) => [...document.querySelectorAll(sel)].map((row) => {
      const r = row.getBoundingClientRect(), kids = [...row.children].map((e) => e.getBoundingClientRect());
      return { overlap: kids.some((a, i) => kids.some((c, j) => j > i && a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1)),
        clip: r.left < -1 || r.right > W + 1 || kids.some((k) => k.left < r.left - 1 || k.right > r.right + 1) }; });
    return { ideas: document.querySelectorAll('.idea').length, tiles: document.querySelectorAll('.idea > .o-ic').length,
      bubble: !!st && (parseFloat(st.borderTopWidth) > 0 || st.backgroundColor !== 'rgba(0, 0, 0, 0)'),
      chips: document.querySelectorAll('.share .chip').length, primary: document.querySelectorAll('.share .btn.go').length,
      faces: document.querySelectorAll('.share .line-by .face img.ink').length,
      cut: [...document.querySelectorAll('.share .said, .idea b')].some((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1),
      rows: boxes('.idea, .share .line, .share-acts') }; })()`;
  const shared = new URLSearchParams({ title: 'Dentist appointment', text: 'Dr Patel, Thursday 14 November at 10:30, Harley Street Dental Practice, please arrive 10 minutes early' });
  for (const theme of ['day', 'night']) for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    const at = `${theme} ${w}`;
    await b.open(`demo=hello&${theme}`);
    await until('the first-run ideas', () => b.run("document.querySelectorAll('.idea').length > 0"), 30_000);
    let m = await b.run(look);
    assert.equal(m.tiles, m.ideas, `${at} hello: every idea wears the shared tile`);
    assert.ok(!m.bubble, `${at} hello: Chief's greeting is plain words, not a speech bubble`);
    await b.open(`demo&${theme}&${shared}`, '/share');
    await until('the share sheet', () => b.run("document.querySelectorAll('.share-acts .btn').length > 0"), 30_000);
    m = await b.run(look);
    assert.equal(m.chips, 0, `${at} share: no old chips`);
    assert.equal(m.primary, 1, `${at} share: one filled-blue primary`);
    assert.equal(m.faces, 1, `${at} share: Chief speaks with his drawn helmet`);
    assert.ok(!m.cut, `${at}: what was shared and every idea read in full`);
    for (const [i, r] of m.rows.entries()) assert.ok(!r.overlap && !r.clip, `${at} row ${i}: nothing overlaps or spills`);
  }
});

test('a phone card is one primary and ⋯: the sheet names the card and its rows read at 15px; a desk keeps its buttons', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const shown = (sel: string) => `[...document.querySelectorAll('${sel}')].filter((e) => e.getClientRects().length)`;
  for (const theme of ['day', 'night']) for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    const at = `${theme} ${w}`;
    await b.open(`demo&${theme}`);
    await until('a card in Chief\'s thread', () => b.run("!!document.querySelector('.chat .lines .card.ask .btns')"), 30_000);
    const m = await b.run(`({ dots: ${shown('.chat .lines .more-dots')}.length, acts: ${shown('.chat .lines .more-act')}.length })`);
    if (!mobile) { assert.equal(m.dots, 0, `${at}: a desk shows no ⋯`); assert.ok(m.acts > 0, `${at}: a desk keeps every choice inline`); continue; }
    assert.ok(m.dots > 0 && m.acts === 0, `${at}: the other choices sit behind ⋯`);
    await b.run(`${shown('.chat .lines .more-dots')}[0].click()`);
    await until('the ⋯ sheet, settled', () => b.run("!!document.querySelector('.more-sheet .more-row') && !document.querySelector('.more-sheet').getAnimations().length"), 10_000);
    const s = await b.run(`(() => { const head = document.querySelector('.more-head b'), rows = [...document.querySelectorAll('.more-row')];
      return { head: head?.textContent ?? '', rows: rows.map((r) => { const q = r.getBoundingClientRect();
        return { font: parseFloat(getComputedStyle(r).fontSize), h: q.height, inside: q.left >= -1 && q.right <= innerWidth + 1 && q.bottom <= innerHeight + 1 }; }) }; })()`);
    assert.ok(s.head.trim(), `${at}: the sheet names its card`);
    for (const [i, r] of s.rows.entries()) assert.ok(r.font >= 15 && r.h >= 48 && r.inside, `${at} row ${i}: 15px, a full tap height, on screen`);
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until('the sheet to close', () => b.run("!document.querySelector('.more-sheet')"), 10_000);
  }
});

// Cut 10: with no phone paired, Chief's chat offers Add your phone with the code in place (the same card as
// Settings › Phones › Add a phone) plus a plain way to skip; with phones paired the offer stays away.
test('after sign-in with no phone paired, the chat offers Add your phone with its code; paired, it stays away', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.open('demo=nophone&day');
  await until("Chief's box", () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
  await until('the pairing offer', () => b.run("!!document.querySelector('[aria-label=\"Add your phone\"] .qr svg')"), 30_000);
  const card = await b.run(`(() => { const c = document.querySelector('[aria-label="Add your phone"]');
    return { qr: !!c.querySelector('.qr svg'), code: /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){2}$/.test(c.querySelector('.pair-typed')?.textContent ?? ''),
      skip: [...c.querySelectorAll('button')].some((x) => x.innerText === 'Not now') }; })()`);
  assert.deepEqual(card, { qr: true, code: true, skip: true }, 'nophone: the QR, the code and Not now are in place');
  await b.open('demo=maya&day');
  await until("Chief's box", () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
  assert.equal(await b.run("!!document.querySelector('[aria-label=\"Add your phone\"]')"), false, 'paired phones: no offer in the chat');
});

test('live Chats keep the last reply separate from status and the opening NEW divider after read', { skip: !bin && 'no Chromium here' }, async () => {
  const lab = setup();
  lab.crew.onboard('Umer');
  lab.cfg.port = 0; lab.cfg.linkPort = 0;
  cpSync(join(repo, 'package.json'), join(parent, 'package.json'));
  const server = await startServer({ ...lab.cfg, repoDir: parent }, lab.db, lab.crew);
  after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const person = readFileSync(join(lab.cfg.stateDir, 'person.key'), 'utf8');
  const api = async (path: string, body?: object) => {
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-crewhouse': '1', authorization: `Bearer ${person}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(r.status, 200); return r.json();
  };
  await api('/api/recruit', { template: 'scout', name: 'Scout' });
  const job = (await api('/api/bots/scout/messages', { text: 'Check my Friday flights; ask permission' })).task;
  await holding(lab.crew, 'scout');
  const b = await browse(base);
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await b.open(`day#person=${person}`);
  await until('Chief chat', () => b.run("!!document.querySelector('.home-mode')"), 30_000);
  await toOffice(b);
  const row = () => b.run(`(() => { const r = document.querySelector('[aria-label="Chats"] a[href="#/h/scout"]'); return r && { line: r.querySelector('.small').textContent, word: r.querySelector('.p-state').textContent, badge: !!r.querySelector('.badge'), working: r.parentElement.querySelector('.chat-working')?.textContent, time: r.querySelector('time').textContent }; })()`);
  const live = await row();
  assert.equal(live.word, 'At work'); assert.match(live.working, /Scout is working/);
  assert.match(live.line, /^You: Check my Friday flights/); assert.ok(live.time); assert.equal(live.badge, false);
  // Scout goes quiet past the limit: still one status on its row, no ask card under it; the ask is Chief's alone.
  lab.db.run('UPDATE tasks SET updated_at = updated_at - 300000 WHERE id = ?', job);
  // Chief's row carries the ask as his blue count, never the words "Needs you".
  const chief = () => b.run(`(() => { const r = document.querySelector('[aria-label="Chats"] a[href="#/chief"]'); return [r.querySelector('.badge')?.textContent, r.querySelector('.p-state')?.textContent ?? null]; })()`);
  await until('Chief asks about Scout', async () => (await chief())[0] === '1', 30_000);
  assert.deepEqual(await chief(), ['1', null], 'Chief\'s row: the count, no status words');
  assert.deepEqual([(await row()).word, await b.run(`!!document.querySelector('[aria-label="Chats"] a[href="#/h/scout"]').parentElement.querySelector('.stuck')`)],
    ['At work', false], 'a quiet helper\'s Chats row carries its status and no ask card');
  await b.run('location.hash = "#/chief"');
  await until("the Stop card in Chief's thread", () => b.run(`[...document.querySelectorAll('.stuck')].some((e) => /Scout has been quiet/.test(e.textContent))`), 30_000);
  await b.run('location.hash = "#/h/scout"');
  await until("Scout's own thread", () => b.run(`!!document.querySelector('.line') && !document.querySelector('.stuck')`), 30_000);
  assert.equal(await b.run(`document.querySelectorAll('.stuck').length`), 0, 'Scout\'s own thread asks nothing: the Stop card is Chief\'s alone');
  await b.run('location.hash = "#/"');
  await toOffice(b);
  await release(lab.crew, 'scout', 'Three Friday flights are ready.'); await settled(lab.db, job);
  await until('last reply in the row', async () => (await row())?.line === 'Three Friday flights are ready.', 30_000);
  assert.equal((await row()).word, 'Done');
  // Scout's reply is still unread: only Chief carries a badge, so the desk rail's Scout row has none.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await until('the desk rail', () => b.run("document.querySelectorAll('.side-row').length > 0"), 30_000);
  assert.equal((await api('/api/bots/scout')).bot.unread > 0, true);
  assert.equal(await b.run("document.querySelectorAll('.side-row .badge').length"), 0, 'no crew rail row carries a badge');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await b.run('location.hash = "#/h/scout"');
  await until('opening NEW divider', () => b.run("!!document.querySelector('.new-divider')"), 30_000);
  await until('read acknowledged', async () => (await api('/api/bots/scout')).bot.unread === 0);
  const boundary = await b.run("(() => { const n = document.querySelector('.new-divider'); return {word:n?.textContent, after:n?.nextElementSibling?.textContent}; })()");
  assert.equal(boundary.word, 'New'); assert.match(boundary.after, /Three Friday flights are ready/);
  await b.run('location.hash = "#/"');
  await until('left the helper thread', () => b.run("!!document.querySelector('.home-mode')"));
  await b.run('location.hash = "#/h/scout"');
  await until('opened the read thread', () => b.run("!!document.querySelector('.chat-page .line.them')"));
  assert.equal(await b.run("!!document.querySelector('.new-divider')"), false, 'a read thread has no NEW on the next visit');
});
