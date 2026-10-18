// Home's battery and layout rules, measured in a real browser on the ?demo households (web/src/main.tsx Home, the
// Stack crew view): flat with no 3D library anywhere, every face still, and at every crew size (?demo=crew1, crew5,
// crew12, crew30) on a phone and a computer every crew card sits clear of the others, nothing clips, counts agree with
// A.office, and Chief's card is the one way to his asks and his thread.
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

// What moves on Home: nothing. Every face is still Geo art; no animation loops.
const faces = (b: Awaited<ReturnType<typeof browse>>) => b.run(`(() => ({
  loops: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity).length,
  art: [...document.querySelectorAll('.stack-home .face img')].map((i) => i.getAttribute('src') ?? '') }))()`);

test('Home keeps the battery budget: every face is still and nothing loops, at work or calm', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const demo of ['calm', 'office']) {
    await b.open(`demo=${demo}&day`);
    await until('Home', () => b.run("document.querySelectorAll('.stack-home .face img').length > 0"), 30_000);
    const q0 = await faces(b);
    assert.equal(q0.loops, 0, `${demo}: no looping animation on Home`);
    await new Promise((r) => setTimeout(r, WINDOW_MS));
    assert.deepEqual((await faces(b)).art, q0.art, `${demo}: every face still, even at work`);
  }
});

// Each demo house and its crew size.
const HOUSES: [string, number][] = [['crew1', 1], ['crew5', 5], ['crew12', 12], ['crew30', 30], ['office', 5], ['calm', 5], ['finished', 5]];
test('at 1, 5, 12 and 30 crew, on a phone and a computer, Home\'s Today rows and Chief\'s asks are clear and whole, Chief\'s card opens his thread, and counts agree', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const asked: Record<string, number> = {};
  for (const [width, height, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    for (const [demo, n] of HOUSES) {
      for (const theme of ['day', 'night']) {
        // Each launch opens on Home, the crew view; Chief's card is the way into his thread.
        await b.open(`demo=${demo}&${theme}`);
        await until('Home', () => b.run("!!document.querySelector('.stack-home .sh-chief a[href=\"#/chief\"]')"), 30_000);
        assert.equal(await b.run("!!document.querySelector('.home-chat')"), false, `${demo} ${theme} at ${width}: Home is the crew view, not Chief's thread`);
        await b.run("document.querySelector('.sh-chief a[href=\"#/chief\"]').click()");
        await until("Chief's box", () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
        await until('a thread line', () => b.run("document.querySelectorAll('.home-chat .lines .line').length > 0"), 30_000);
        const first = await b.run(`(() => {
          const seen = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; };
          const lines = [...document.querySelectorAll('.home-chat .lines .line')];
          const asks = [...document.querySelectorAll('.home-chat .lines .ask')].map((e) => ({ text: e.innerText ?? '', on: (() => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < innerHeight && r.bottom > 0; })() }));
          return { pin: seen(document.querySelector('.home-chat .needs-pin .needs-row')), thread: lines.length > 0 && seen([...document.querySelectorAll('.home-chat .lines .line, .home-chat .lines .ask')].at(-1)), box: seen(document.querySelector('.home-chat .composer')), asks };
        })()`);
        // The thread's newest item (a line, or an ask card after it) is in view above the box and the tab bar.
        const lead = `${demo} ${theme} at ${width}, Chief's thread from Home`;
        assert.equal(first.pin, false, `${lead}: no pinned card in the conversation (the ask sits inline)`);
        assert.ok(first.thread && first.box, `${lead}: the conversation and Chief's box on the first screen`);
        if (first.asks.length) assert.ok(first.asks.some((a: { text: string; on: boolean }) => a.on && a.text.length > 40), `${lead}: the inline ask carries its words on the first screen (${first.asks.map((a: { text: string }) => JSON.stringify(a.text.slice(0, 60))).join(' | ')})`);
        await b.run('location.hash = "#/"');
        await until('Home', () => b.run("!!document.querySelector('.stack-home .sh-chief')"), 30_000);
        const m = await b.run(`(() => {
          const shown = (e) => e.getBoundingClientRect().height > 0;
          const units = [...document.querySelectorAll('.st-today .st-card:not(.st-ask)')];
          const asks = [...document.querySelectorAll('.st-today .st-ask, .st-asks .st-cc')].filter(shown).length;
          const box = (e) => e.getBoundingClientRect(), st = box(document.querySelector('.st-pri'));
          const hit = (a, c) => a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5;
          const rects = [...document.querySelectorAll('.st-today .st-card, .st-asks .st-cc')].filter(shown).map(box);
          const pairs = [];
          rects.forEach((a, i) => rects.slice(i + 1).forEach((c, j) => { if (hit(a, c)) pairs.push(i + ' x ' + (i + 1 + j)); }));
          // A phone's rows sit 4px wider than the column on each side, as drawn; none leaves its column's padding.
          const pad = parseFloat(getComputedStyle(document.querySelector('.st-pri')).paddingLeft);
          const out = units.map(box).filter((r) => r.left < st.left + pad - 5 || r.right > st.right - pad + 5).length;
          const clipped = [...document.querySelectorAll('.stack-home b, .st-pill, .st-sub, .st-line, .st-head h1')]
            .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent?.slice(0, 40));
          // Body text is 16px or more; only the small-caps labels and the status pills are 14px (a button is a control).
          const tiny = [...document.querySelectorAll('.stack-home *')].filter((e) => [...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())
            && shown(e) && !e.closest('.btn') && parseFloat(getComputedStyle(e).fontSize) < (e.matches('.st-pill, .st-label span') ? 14 : 16)).map((e) => e.textContent.slice(0, 30));
          // The pill keeps the title's first line, top right; a long title wraps beside it, never above or under it.
          const pillOff = [...document.querySelectorAll('.st-today .st-top')].filter((t) => { const b = t.querySelector('b'), p = t.querySelector('.st-pill');
            return b && p && shown(t) && (Math.abs(box(b).top - box(p).top) > 6 || box(p).left < box(b).right - 1); }).map((t) => t.innerText);
          const names = units.map((p) => p.getAttribute('href'));
          const words = units.map((p) => p.querySelector('.st-pill')?.textContent?.trim());
          const chiefTitle = document.querySelector('.sh-chief .sh-top b')?.textContent ?? '';
          const rail = document.querySelector('.st-asks .st-label')?.textContent ?? '';
          const crewActs = units.flatMap((p) => [...p.querySelectorAll('button, .btn')]).map((e) => e.textContent);
          const crewText = units.map((p) => p.innerText);
          const waitRows = units.filter((p) => p.querySelector('.st-pill.needs')).map((p) => p.querySelector('.st-sub')?.textContent ?? '');
          const doneText = units.filter((p) => p.querySelector('.st-pill.done')).map((p) => p.innerText);
          return { asks, pairs, out, clipped, tiny, pillOff, names, words, chiefTitle, rail, crewActs, crewText, waitRows, doneText,
            pins: document.querySelectorAll('.stack-home .needs-pin').length, hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
        })()`);
        const at = `${demo} ${theme} at ${width}`;
        try {
          // Chief's card carries the count; on a phone his asks sit at the top of Today, on a computer in the column beside
          // (never both), and either way there is one card per thing he has.
          assert.equal(m.pins, 0, `${at}: Home renders no Needs you pin`);
          const has = Number(/^Chief has (\d+)/.exec(m.chiefTitle)?.[1] ?? 0);
          // His count is one number for a house, at every width and theme.
          assert.equal(has, asked[demo] ??= has, `${at}: Chief's count is the same at every width and theme (${m.chiefTitle})`);
          if (width > 900) assert.equal(m.asks, has, `${at}: one card in the column per thing Chief has, none repeated in Today`);
          else assert.ok(m.asks <= has, `${at}: Today shows no more asks than Chief has`);
          if (width > 900 && has) assert.equal(m.rail, m.chiefTitle, `${at}: the column's label and Chief's card agree`);
          assert.equal(new Set(m.names).size, m.names.length, `${at}: nobody twice in Today`);
          assert.ok(m.names.every((h: string) => /^#\/h\//.test(h)), `${at}: every Today row opens that helper`);
          assert.ok(m.words.every((w: string) => w !== 'Free'), `${at}: Today holds jobs, never an idle helper (${m.words.join(' | ')})`);
          assert.equal(m.out, 0, `${at}: every row inside the column`);
          assert.equal(m.pairs.length, 0, `${at}: no card covers another: ${m.pairs.join('; ')}`);
          assert.deepEqual(m.clipped, [], `${at}: no word cut off`);
          assert.deepEqual(m.tiny, [], `${at}: body text is 16px or more`);
          assert.deepEqual(m.pillOff, [], `${at}: every pill sits top right on its title's first line`);
          assert.equal(m.hscroll, false, `${at}: no sideways scroll`);
          // Only Chief says "Needs you"; crew never ask the person: no crew row answers or approves or carries the ask, a
          // waiting one reads "Waiting for Chief", and a done one never says waiting.
          assert.ok(m.words.every((w: string) => w !== 'Needs you'), `${at}: no crew row says "Needs you" (${m.words.join(' | ')})`);
          assert.deepEqual(m.crewActs, [], `${at}: no crew row has an answer or approve button`);
          assert.ok(m.crewText.every((x: string) => !/has a question|needs your OK|Review .*order|Answer |Place order|\w needs you|your OK/i.test(x)), `${at}: no crew row carries the ask (${m.crewText.join(' | ')})`);
          assert.ok(m.waitRows.every((l: string) => /Waiting for Chief$/.test(l)), `${at}: a waiting row reads "Waiting for Chief" (${JSON.stringify(m.waitRows)})`);
          assert.ok(m.doneText.every((x: string) => !/waiting/i.test(x)), `${at}: a done row never says waiting (${m.doneText.join(' | ')})`);
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
    // One shared face per member: a Geo face is its own black disc, the same in day and night.
    const art: string[] = [];
    for (const theme of ['day', 'night']) {
      await b.open(`demo=crew5&${theme}`);
      await until('Home', () => b.run("document.querySelectorAll('.stack-home .face img').length > 1"), 30_000);
      art.push((await faces(b)).art.join('\n'));
    }
    assert.equal(art[0], art[1], `day and night draw the same faces at ${width}`);
  }
});


test('your crew reads whole: every tile has its Geo face in its own shape, and no tile overlaps or clips, phone and computer, day and night', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const tiles = `(() => [...document.querySelectorAll('.st-tile')].map((row) => {
    const r = row.getBoundingClientRect(), kids = [...row.children].map((e) => e.getBoundingClientRect());
    const overlap = kids.some((a, i) => kids.some((c, j) => j > i && a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1));
    const clip = kids.some((k) => k.left < r.left - 1 || k.right > r.right + 1) || [...row.querySelectorAll('b, span')].some((e) => e.scrollWidth > e.clientWidth + 1);
    // The face's box follows the drawing (its viewBox): a box forced to another shape squashes or shrinks the head.
    const squashed = [...row.querySelectorAll('.face img.ink')].filter((i) => !i.naturalHeight
      || Math.abs(i.width / i.height - i.naturalWidth / i.naturalHeight) > 0.05).length;
    return { faces: row.querySelectorAll('.face img.ink').length + (row.classList.contains('st-new') ? 1 : 0), overlap, clip, squashed };
  }))()`;
  for (const theme of ['day', 'night']) for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await b.open(`demo=crew5&${theme}#/crew`);
    await until('the crew tiles', () => b.run("document.querySelectorAll('.st-tile').length > 3 && [...document.querySelectorAll('.face img.ink')].every((i) => i.complete)"), 30_000);
    const found = await b.run(tiles), at = `${theme} ${w}`;
    assert.equal(found.length, 7, `${at}: Chief, every helper and Add a helper (${found.length} tiles)`);
    for (const [i, f] of found.entries()) {
      assert.equal(f.faces, 1, `${at} tile ${i}: one Geo face`);
      assert.equal(f.squashed, 0, `${at} tile ${i}: the face keeps its own shape`);
      assert.ok(!f.overlap, `${at} tile ${i}: status, face, name and role never overlap`);
      assert.ok(!f.clip, `${at} tile ${i}: nothing spills past the tile`);
    }
  }
  // Only Chief says "Needs you" (Main: one person, one Chief): a crew member waiting on the person reads "Waiting", on the
  // crew page and on the desk rail beside Chief, and Chief's tile says his real status, the rail's own.
  for (const theme of ['day', 'night']) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.open(`demo&${theme}#/crew`);
    await until('the crew tiles and the rail', () => b.run("document.querySelectorAll('.st-tile').length > 3 && document.querySelectorAll('.side-row').length > 0"), 30_000);
    const page = await b.run("[...document.querySelectorAll('.st-tile:not([href=\"#/chief\"]) .st-pill')].map((e) => e.textContent)"), at = `${theme} crew page`;
    assert.ok(!page.includes('Needs you'), `${at}: no crew tile says "Needs you" (${page.join(' | ')})`);
    assert.ok(page.includes('Waiting'), `${at}: a waiting crew member says "Waiting" (${page.join(' | ')})`);
    assert.equal(await b.run("document.querySelector('.st-tile[href=\"#/chief\"] .st-pill')?.textContent"), 'Needs you', `${at}: Chief's tile says his real status`);
    const rail = await b.run("[...document.querySelectorAll('.side-row .side-seat')].map((e) => e.textContent)"), atRail = `${theme} rail`;
    assert.ok(!rail.includes('Needs you'), `${atRail}: no crew rail row says "Needs you" (${rail.join(' | ')})`);
  }
});

test('what waits on the person is one count: Home, the menu, the tab bar and the Jobs page agree', { skip: !bin && 'no Chromium here' }, async () => {
  // Chief's card says "Chief has N things for you" (A.chiefHas, counts.needs); the side menu's and the tab bar's Jobs
  // count say the same N, and the Jobs page adds up to it: its Needs you rows plus the helpers gone quiet.
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const num = (s: string | null | undefined) => Number(/\d+/.exec(s ?? '')?.[0] ?? 0);
  for (const demo of ['maya', 'b1', 'crew5', 'crew12', 'calm', 'finished']) {
    const counts: Record<string, number> = {};
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 });
      await b.open(`demo=${demo}&day#/`);
      await until('Home', () => b.run("!!document.querySelector('.sh-chief .sh-top b')"), 30_000);
      const has = await b.run("document.querySelector('.sh-chief .sh-top b').textContent");
      counts[`home ${w}`] = /^Chief has/.test(has) ? num(has) : 0;
      if (w < 900) assert.equal(await b.run("[...document.querySelectorAll('.tabs .tab-ic')].filter((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)').length"), 1, `${demo}: only the current tab is lit`);
      counts[w < 900 ? 'tab bar' : 'menu'] = num(await b.run(`document.querySelector('${w < 900 ? '.tabs .tab-badge' : '.side-navs .side-count'}')?.textContent`));
    }
    await b.run('location.hash = "#/jobs"');
    await until('the Jobs page', () => b.run("!!document.querySelector('.jobs-page')"), 30_000);
    counts.jobs = await b.run("document.querySelectorAll('.jobs-page .needs-row').length") + num(await b.run("document.querySelector('.jobs-quiet b')?.textContent"));
    assert.equal(new Set(Object.values(counts)).size, 1, `${demo}: one count everywhere (${JSON.stringify(counts)})`);
  }
});

test('the side menu never stacks rows: the crew list scrolls inside it, Settings and the person stay whole and tappable', { skip: !bin && 'no Chromium here' }, async () => {
  // With a long crew on a short screen the person at the foot once sat over Settings; the crew list now takes the
  // menu's free height and scrolls, so every row keeps its own box. Crew rows count only where the list shows them.
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const [w, h] of [[1280, 832], [1280, 720]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    for (const demo of ['crew5', 'crew12', 'crew30']) {
      await b.open(`demo=${demo}&day#/`);
      await until('the side menu', () => b.run("document.querySelectorAll('.side-row').length > 0"), 30_000);
      const r = await b.run(`(() => {
        const crew = document.querySelector('.side-crew').getBoundingClientRect();
        const boxes = [...document.querySelectorAll('.side .brand, .side-nav, .side-row, .side-label, .side-me')].map((e) => {
          const r = e.getBoundingClientRect(), inCrew = e.closest('.side-crew');
          return { t: e.textContent.trim().slice(0, 24), top: inCrew ? Math.max(r.top, crew.top) : r.top, bottom: inCrew ? Math.min(r.bottom, crew.bottom) : r.bottom, left: r.left, right: r.right };
        }).filter((b) => b.bottom - b.top > 1);
        const overlap = [];
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => { if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1) overlap.push(a.t + ' / ' + b.t); }));
        const hit = (sel) => { const e = document.querySelector(sel), r = e.getBoundingClientRect(); return r.bottom <= innerHeight && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('a') === e; };
        return { overlap, settings: hit('.side-more a[href="#/settings"]'), me: hit('.side-me') };
      })()`);
      assert.deepEqual(r, { overlap: [], settings: true, me: true }, `${demo} at ${w}x${h}: menu rows stay apart, Settings and the person whole and tappable`);
    }
  }
});

test('your crew page reads the rail status: every tile matches its rail row', { skip: !bin && 'no Chromium here' }, async () => {
  // The Your crew tiles' status word is the rail's own (A.statusOf). This fails on a second status rule (the reported
  // bug: Reel and Scout showed their job while the rail said Waiting, and Scribe said "Waiting for Chief" while the
  // rail said Done).
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const demo of ['maya', 'b1', 'crew5', 'crew12', 'calm', 'finished']) {
    await b.open(`demo=${demo}&day#/crew`);
    await until('the crew tiles', () => b.run("document.querySelectorAll('.st-tile').length > 3"), 30_000);
    const r = await b.run(`(() => ({
      page: Object.fromEntries([...document.querySelectorAll('.st-tile:not(.st-new)')].map((t) => [t.querySelector('b')?.textContent.trim(), t.querySelector('.st-pill')?.textContent.trim()])),
      rail: Object.fromEntries([...document.querySelectorAll('.side-row')].map((row) => [row.querySelector('b')?.textContent.trim(), row.querySelector('.side-seat')?.textContent.trim()])) }))()`);
    const page = r.page as Record<string, string>, rail = r.rail as Record<string, string>;
    assert.ok(Object.keys(rail).length > 2, `${demo}: the rail lists the crew (${JSON.stringify(rail)})`);
    for (const [name, status] of Object.entries(rail)) assert.equal(page[name], status, `${demo}: the crew page reads ${name} as the rail does`);
  }
});

test('a finished file opens beside its chat: the chat\'s foot (a helper\'s Ask Chief about this) stays clear of the panel', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.open(`demo&day#/f/scribe/${encodeURIComponent('files/monthly-budget.xlsx')}`);
  const edges = "(() => { const c = document.querySelector('.chat-page .dock'), p = document.querySelector('.wb-panel'); return c && p && p.querySelector('.wb-grid') ? { composer: c.getBoundingClientRect().right, panel: p.getBoundingClientRect().left } : null; })()";
  await until('the chat and the open workbook', () => b.run(edges), 30_000);
  const { composer, panel } = await b.run(edges);
  assert.ok(composer <= panel, `the chat's foot ends at ${composer}px, left of the panel at ${panel}px`);
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

test('first run and the Share sheet read Term: critter faces, shared tiles, no bubble, one blue primary, words in full', { skip: !bin && 'no Chromium here' }, async () => {
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
    assert.equal(m.faces, 1, `${at} share: Chief speaks with his critter`);
    assert.ok(!m.cut, `${at}: what was shared and every idea read in full`);
    for (const [i, r] of m.rows.entries()) assert.ok(!r.overlap && !r.clip, `${at} row ${i}: nothing overlaps or spills`);
  }
});

test('Stack cards keep a primary, secondary and ⋯ on phone and desk; the named sheet has 16px rows', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const shown = (sel: string) => `[...document.querySelectorAll('${sel}')].filter((e) => e.getClientRects().length)`;
  for (const theme of ['day', 'night']) for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    const at = `${theme} ${w}`;
    await b.open(`demo&${theme}#/chief`);
    await until('a card in Chief\'s thread', () => b.run("!!document.querySelector('.chat .lines .card.ask .btns')"), 30_000);
    const m = await b.run(`({ dots: ${shown('.chat .lines .more-dots')}.length, acts: ${shown('.chat .lines .more-act')}.length })`);
    assert.ok(m.dots > 0 && m.acts > 0, `${at}: the secondary stays inline and extra choices sit behind ⋯`);
    await b.run(`${shown('.chat .lines .more-dots')}[0].click()`);
    await until('the ⋯ sheet, settled', () => b.run("!!document.querySelector('.more-sheet .more-row') && !document.querySelector('.more-sheet').getAnimations().length"), 10_000);
    const s = await b.run(`(() => { const head = document.querySelector('.more-head b'), rows = [...document.querySelectorAll('.more-row')];
      return { head: head?.textContent ?? '', rows: rows.map((r) => { const q = r.getBoundingClientRect();
        return { font: parseFloat(getComputedStyle(r).fontSize), h: q.height, inside: q.left >= -1 && q.right <= innerWidth + 1 && q.bottom <= innerHeight + 1 }; }) }; })()`);
    assert.ok(s.head.trim(), `${at}: the sheet names its card`);
    for (const [i, r] of s.rows.entries()) assert.ok(r.font >= 16 && r.h >= 48 && r.inside, `${at} row ${i}: 16px, a full tap height, on screen`);
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until('the sheet to close', () => b.run("!document.querySelector('.more-sheet')"), 10_000);
  }
});

// Cut 10: with no phone paired, Chief's chat offers Add your phone with the code in place (the same card as
// Settings › Phones › Add a phone) plus a plain way to skip; with phones paired the offer stays away.
test('after sign-in with no phone paired, the chat offers Add your phone with its code; paired, it stays away', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.open('demo=nophone&day#/chief');
  await until("Chief's box", () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
  await until('the pairing offer', () => b.run("!!document.querySelector('[aria-label=\"Add your phone\"] .qr svg')"), 30_000);
  const card = await b.run(`(() => { const c = document.querySelector('[aria-label="Add your phone"]');
    return { qr: !!c.querySelector('.qr svg'), code: /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){2}$/.test(c.querySelector('.pair-typed')?.textContent ?? ''),
      skip: [...c.querySelectorAll('button')].some((x) => x.innerText === 'Not now') }; })()`);
  assert.deepEqual(card, { qr: true, code: true, skip: true }, 'nophone: the QR, the code and Not now are in place');
  await b.open('demo=maya&day#/chief');
  await until("Chief's box", () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
  assert.equal(await b.run("!!document.querySelector('[aria-label=\"Add your phone\"]')"), false, 'paired phones: no offer in the chat');
});

// ch-ask-card-in-view: Add your phone at the foot of the thread used to push the open ask that needs the person
// off the top, so the chat opened on the footer and the ask was never seen. The card now waits under Chief's first
// answer (ch-chat-silent-gap), so nothing sits below the newest open ask and the thread opens with it whole in view.
test('an open ask card is in view when Chief\'s chat opens, with Add your phone above it', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await b.open('demo=nophone&day#/chief');
  await until('the ask and the phone offer', () => b.run("!!document.querySelector('[aria-label=\"Add your phone\"] .qr svg') && document.querySelectorAll('.chat .lines .card.ask').length > 1"), 30_000);
  const at = await b.run(`(() => { const el = document.querySelector('.chat .lines'), cards = [...el.querySelectorAll('.card.ask')];
    const r = cards.at(-1).getBoundingClientRect(), box = el.getBoundingClientRect(), pair = el.querySelector('[aria-label="Add your phone"]').getBoundingClientRect();
    return { wide: el.scrollHeight > el.clientHeight + 1, top: Math.round(r.top - box.top), bottom: Math.round(box.bottom - r.bottom), above: pair.bottom <= r.top }; })()`);
  assert.ok(at.wide, 'the thread is longer than its box');
  assert.ok(at.top >= 0 && at.bottom >= 0, `the newest open ask is whole in view (${at.top} from the top, ${at.bottom} from the foot)`);
  assert.ok(at.above, 'Add your phone sits above the ask, never at the thread\'s foot');
});

test('live crew cards keep one status, Chief carries the ask, and the opening NEW divider after read', { skip: !bin && 'no Chromium here' }, async () => {
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
  const job = (await api('/api/bots/chief/messages', { text: 'Scout, Check my Friday flights; ask permission' })).task;
  await holding(lab.crew, 'scout');
  const b = await browse(base);
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await b.open(`day#person=${person}`);
  await until('Home', () => b.run("!!document.querySelector('.stack-home')"), 30_000);
  const row = () => b.run(`(() => { const r = document.querySelector('.st-card[href="#/h/scout"]'); return r && { word: r.querySelector('.st-pill').textContent, badge: !!r.querySelector('.badge'), stuck: !!r.querySelector('.stuck') }; })()`);
  await until('Scout at work', async () => (await row())?.word === 'At work', 30_000);
  assert.equal((await row()).badge, false);
  // Scout goes quiet past the limit: still one status on its row, no ask card under it; the ask is Chief's alone.
  lab.db.run('UPDATE tasks SET updated_at = updated_at - 300000 WHERE id = ?', job);
  // Chief's card carries the ask as what he has for you, never a second status word beside it.
  const chief = () => b.run(`[document.querySelector('.sh-chief .sh-top b')?.textContent, document.querySelector('.sh-chief .st-word')?.textContent ?? null]`);
  await until('Chief asks about Scout', async () => (await chief())[0] === 'Chief has 1 thing for you', 30_000);
  assert.deepEqual(await chief(), ['Chief has 1 thing for you', null], 'Chief\'s card: what he has for you, no status word');
  assert.deepEqual(await row(), { word: 'At work', badge: false, stuck: false }, 'a quiet helper\'s card carries its status and no ask card');
  await b.run('location.hash = "#/chief"');
  await until("the Stop card in Chief's thread", () => b.run(`[...document.querySelectorAll('.stuck')].some((e) => /Scout has been quiet/.test(e.textContent))`), 30_000);
  await b.run('location.hash = "#/h/scout"');
  await until("Scout's own thread", () => b.run(`!!document.querySelector('.line') && !document.querySelector('.stuck')`), 30_000);
  assert.equal(await b.run(`document.querySelectorAll('.stuck').length`), 0, 'Scout\'s own thread asks nothing: the Stop card is Chief\'s alone');
  assert.deepEqual(await b.run(`[!!document.querySelector('.read-along'), document.querySelectorAll('.chat-page textarea').length]`), [true, 0], 'a helper\'s thread is read only: Ask Chief about this, no composer');
  await b.run('location.hash = "#/"');
  await until('Home', () => b.run("!!document.querySelector('.stack-home')"), 30_000);
  await release(lab.crew, 'scout', 'Three Friday flights are ready.'); await settled(lab.db, job);
  await until('Scout done on its card', async () => /^Done /.test((await row())?.word ?? ''), 30_000);
  // Chief relayed Scout's reply, so it is unread in Chief's thread and not in Scout's: only Chief carries a badge, so the desk rail's Scout row has none.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await until('the menu row says Done', async () => /^Done/.test(await b.run("document.querySelector('.side-row .side-seat')?.textContent ?? ''")), 30_000);
  assert.equal((await api('/api/bots/chief')).bot.unread > 0, true);
  assert.equal((await api('/api/bots/scout')).bot.unread, 0, 'a reply Chief relayed is not unread in the helper’s own thread');
  assert.equal(await b.run("document.querySelectorAll('.side-row .badge').length"), 0, 'no crew rail row carries a badge');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await b.run('location.hash = "#/chief"');
  await until('opening NEW divider', () => b.run("!!document.querySelector('.new-divider')"), 30_000);
  await until('read acknowledged', async () => (await api('/api/bots/chief')).bot.unread === 0);
  const boundary = await b.run("(() => { const n = document.querySelector('.new-divider'); return {word:n?.textContent, after:n?.nextElementSibling?.textContent}; })()");
  assert.equal(boundary.word, 'New'); assert.match(boundary.after, /Scout|Friday/, 'the divider opens on Chief’s first unread line about Scout’s job');
  await b.run('location.hash = "#/"');
  await until('left the helper thread', () => b.run("!!document.querySelector('.stack-home')"));
  await b.run('location.hash = "#/h/scout"');
  await until('opened the read thread', () => b.run("!!document.querySelector('.chat-page .line.them')"));
  assert.equal(await b.run("!!document.querySelector('.new-divider')"), false, 'a read thread has no NEW on the next visit');

  // A request routed to Scout through Chief is one hand-off chip after Chief's reply, under the limit from crewd's grants.
  const next = (await api('/api/bots/chief/messages', { text: 'Scout, check the Monday trains; ask permission' })).task;
  await holding(lab.crew, 'scout');
  await b.run('location.hash = "#/chief"');
  await until('the hand-off chip', () => b.run(`/at work/.test([...document.querySelectorAll('.hand')].at(-1)?.textContent ?? '')`), 30_000);
  // The Friday request was Chief's first hand-off to Scout, so it carries the limit; this Monday one is the second and does not.
  const chip = await b.run(`(() => { const hs = [...document.querySelectorAll('.hand-off')], h = hs.at(-1), lines = [...document.querySelectorAll('.chat .lines .line:not(.live-line)')];
    return { limit: hs[0].querySelector('.hand-limit').textContent, second: h.querySelector('.hand-limit'), href: h.querySelector('a.hand').getAttribute('href'), after: lines.indexOf(h) > lines.findIndex((l) => /Monday trains/.test(l.textContent)) }; })()`);
  assert.match(chip.limit, /^Scout .*can't pay or send anything without asking you\.$/);
  assert.deepEqual([chip.href, chip.after, chip.second], ['#/h/scout', true, null], 'the chip opens Scout\'s thread and sits after the request that handed it on');
  await release(lab.crew, 'scout', 'Two trains on Monday.'); await settled(lab.db, next);
  // The result is already the chip, so the finished job raises no toast in the thread it appears in (chat quality gap 12).
  await until('the first chip reads done', () => b.run(`/done/.test([...document.querySelectorAll('.hand')].at(-1)?.textContent ?? '')`), 30_000);
  assert.deepEqual(await b.run(`[...document.querySelectorAll('.toast')].map((t) => t.textContent).filter((t) => /Monday trains/.test(t))`), [], 'no toast repeats the finished job in the open thread');
  // A second hand-off to the same helper says the job alone: the limit sentence rides only its first hand-off (gap 13).
  const again = (await api('/api/bots/chief/messages', { text: 'Scout, check the Friday flights; ask permission' })).task;
  await holding(lab.crew, 'scout');
  await until('the third hand-off chip', () => b.run(`document.querySelectorAll('.hand-off').length === 3 && /at work/.test(document.querySelectorAll('.hand')[2]?.textContent ?? '')`), 30_000);
  assert.equal(await b.run(`!!document.querySelectorAll('.hand-off')[2].querySelector('.hand-limit')`), false, 'the third hand-off carries no limit sentence');
  await release(lab.crew, 'scout', 'Two flights on Friday.'); await settled(lab.db, again);
});

// The demo banner (main.tsx PairRow) at the hardest size a phone gets: 360 wide with the largest text. Its Pair
// button drops under the words, the words stay inside their own column and all of them stay on screen — on main the
// button held its width, the column collapsed to 6px and the words drew under the button, then off the top region.
test('the demo banner stacks its Pair button under its words at 360 wide and the largest text', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 3, mobile: true });
  await b.open('demo=plan&day');
  await until('the demo banner', () => b.run("!!document.querySelector('.pair-row .btn')"), 30_000);
  // look-check's own text scaling: every size read before any is written, because computed styles are live.
  const m = await b.run(`(() => {
    const all = [...document.querySelectorAll('body, body *')].map((e) => { const cs = getComputedStyle(e); return [e, cs.fontSize, cs.lineHeight]; });
    for (const [e, f, l] of all) { e.style.setProperty('font-size', parseFloat(f) * 2 + 'px', 'important'); if (l !== 'normal') e.style.setProperty('line-height', parseFloat(l) * 2 + 'px', 'important'); }
    const card = document.querySelector('.pair-row'), span = card.querySelector('.grow'), btn = card.querySelector('.btn');
    const rg = document.createRange(); rg.selectNodeContents(span);
    const ink = [...rg.getClientRects()], s = span.getBoundingClientRect(), p = btn.getBoundingClientRect();
    const meets = (a, c) => Math.min(a.right, c.right) - Math.max(a.left, c.left) > 1 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 1;
    const onScreen = (q) => { let r = { left: q.left, top: q.top, right: q.right, bottom: q.bottom };
      for (let a = span.parentElement; a && r.right > r.left && r.bottom > r.top; a = a.parentElement) { const cs = getComputedStyle(a);
        if (/hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY)) { const w = a.getBoundingClientRect();
          r = { left: Math.max(r.left, w.left), top: Math.max(r.top, w.top), right: Math.min(r.right, w.right), bottom: Math.min(r.bottom, w.bottom) }; } }
      return r.right - r.left > 1 && r.bottom - r.top > 1; };
    return { card: card.getBoundingClientRect().height, stacked: p.top >= s.bottom - 1,
      spill: ink.filter((q) => q.right > s.right + 1 || q.left < s.left - 1).length,
      covered: ink.filter((q) => meets(q, p)).length, hidden: ink.filter((q) => !onScreen(q)).length };
  })()`);
  assert.equal(m.spill, 0, `the banner's words stay inside their column (${Math.round(m.card!)}px card)`);
  assert.equal(m.covered, 0, "the Pair button covers none of the banner's words");
  assert.equal(m.hidden, 0, 'every one of the banner\'s word lines stays on screen (main hid three at 2x)');
  assert.equal(m.stacked, true, 'the Pair button sits under the words at this size');
  assert.ok(m.card! < 400, `the banner stays short: ${Math.round(m.card!)}px, against main's 562px at this size`);
});
