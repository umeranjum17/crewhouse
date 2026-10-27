// Home's battery and layout rules, measured in a real browser on the ?demo households (web/src/main.tsx Home, the
// calm chat list; on a computer the list is the left pane beside Chief's thread): flat with no 3D library anywhere, SVG
// face motion without a JS frame loop, and at every crew size (?demo=crew1, crew5, crew12, crew30) on a phone and a
// computer every row sits clear of the others, nothing clips, counts agree with A.office, and Chief's row is the one
// way to his asks and his thread.
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
import { until, setup, settled, release, holding, delegated } from './lab.ts';
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
  const waiting = new Map<number, (m: any) => void>(), paused: unknown[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)); waiting.get(m.id)?.(m); waiting.delete(m.id);
    if (m.method === 'Fetch.requestPaused') paused.push(m.params);
  });
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
  return { send, run, open, paused };
}


/** Measuring that nothing happens needs a window, so this one is a measurement, not a wait. */
const WINDOW_MS = 600;

// Face motion lives inside isolated SVG images; the page has no looping animation or per-frame URI rewrites.
const faces = (b: Awaited<ReturnType<typeof browse>>) => b.run(`(() => ({
  loops: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity).length,
  motion: [...document.querySelectorAll('.chat-list .face')].map((e) => e.dataset.motion),
  art: [...document.querySelectorAll('.chat-list .face img')].map((i) => i.getAttribute('src') ?? '') }))()`);

test('Home keeps the battery budget: A moves in SVGs without a page animation loop, at work or calm', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const demo of ['calm', 'office']) {
    await b.open(`demo=${demo}&day`);
    // On a computer Home holds Chief's thread too: measure once it has loaded (its skeleton shimmers only until then).
    await until('Home', () => b.run("document.querySelectorAll('.chat-list .face img').length > 0 && !document.querySelector('.skeleton')"), 30_000);
    const q0 = await faces(b);
    assert.equal(q0.loops, 0, `${demo}: no looping page animation on Home`);
    assert.ok(q0.motion.includes(demo === 'office' ? 'work' : 'idle'), `${demo}: the shared face carries the real mood`);
    for (const src of q0.art) assert.match(decodeURIComponent(src.split(',')[1]), /prefers-reduced-motion:reduce/, 'every face respects reduced motion');
    await b.run(`new Promise((resolve) => { const end = performance.now() + ${WINDOW_MS}; function frame() { if (performance.now() >= end) resolve(true); else requestAnimationFrame(frame); } requestAnimationFrame(frame); })`);
    assert.deepEqual((await faces(b)).art, q0.art, `${demo}: no per-frame image rewrites, even at work`);
    if (demo === 'office') {
      // Native image pixels, not only the SVG source: positive motion control, then Reduce Motion.
      const clip = await b.run(`(async () => { await document.fonts.ready; const e = [...document.querySelectorAll('.chat-list .face[data-motion="work"] img')].find(e=>e.getBoundingClientRect().width>0); e.scrollIntoView({block:'center'}); await new Promise(requestAnimationFrame); const r=e.getBoundingClientRect(); return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}; })()`);
      const shot = async () => (await b.send('Page.captureScreenshot', { clip })).data;
      const moving = await shot();
      await until('the working SVG really moves', async () => (await shot()) !== moving, 5000);
      await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await until('every face chooses a static SVG', () => b.run(`[...document.querySelectorAll('.chat-list .face')].every(e=>e.dataset.motion==='still')`), 5000);
      await b.run(`Promise.all([...document.querySelectorAll('.chat-list .face img')].map(i=>i.decode()))`);
      await b.run('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
      const still = await shot();
      const end = Date.now() + 900;
      await until('the reduced-motion measurement window', async () => {
        assert.equal(await shot(), still, 'Reduce Motion freezes the actual SVG image pixels');
        return Date.now() >= end;
      }, 5000);
    }
  }
});

// Each demo house and its crew size.
const HOUSES: [string, number][] = [['crew1', 1], ['crew5', 5], ['crew12', 12], ['crew30', 30], ['office', 5], ['calm', 5], ['finished', 5]];
test('at 1, 5, 12 and 30 crew, on a phone and a computer, Home\'s chat list is clear and whole, Chief\'s row opens his thread (beside the list on a computer), and counts agree', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const asked: Record<string, number> = {};
  for (const [width, height, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    for (const [demo, n] of HOUSES) {
      for (const theme of ['day', 'night']) {
        // Each launch opens on the chat list; on a phone Chief's row is the way into his thread, on a computer his
        // thread already fills the centre pane beside it.
        await b.open(`demo=${demo}&${theme}`);
        await until('Home', () => b.run("!!document.querySelector('.chat-list a.cl-row[href=\"#/chief\"]')"), 30_000);
        assert.equal(await b.run("!!document.querySelector('.home-chat')"), !mobile, `${demo} ${theme} at ${width}: ${mobile ? 'a phone opens on the list' : 'a computer opens Chief beside the list'}`);
        if (mobile) await b.run("document.querySelector('.chat-list a.cl-row[href=\"#/chief\"]').click()");
        await until("Chief's box", () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
        await until('a thread line', () => b.run("document.querySelectorAll('.home-chat .lines .line').length > 0"), 30_000);
        const first = await b.run(`(() => {
          const seen = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; };
          const lines = [...document.querySelectorAll('.home-chat .lines .line')];
          const asks = [...document.querySelectorAll('.home-chat .lines .ask')].map((e) => ({ text: e.innerText ?? '', on: (() => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < innerHeight && r.bottom > 0; })() }));
          return { pin: seen(document.querySelector('.home-chat .needs-pin .needs-row')), thread: lines.length > 0 && seen([...document.querySelectorAll('.home-chat .lines .line, .home-chat .lines .ask')].at(-1)), box: seen(document.querySelector('.home-chat .composer')), asks };
        })()`);
        // The thread's newest item (a line, or an ask card after it) is in view above the box.
        const lead = `${demo} ${theme} at ${width}, Chief's thread from Home`;
        assert.equal(first.pin, false, `${lead}: no pinned card in the conversation (the ask sits inline)`);
        assert.ok(first.thread && first.box, `${lead}: the conversation and Chief's box on the first screen`);
        if (first.asks.length) assert.ok(first.asks.some((a: { text: string; on: boolean }) => a.on && a.text.length > 40), `${lead}: the inline ask carries its words on the first screen (${first.asks.map((a: { text: string }) => JSON.stringify(a.text.slice(0, 60))).join(' | ')})`);
        if (mobile) {
          await b.run('location.hash = "#/"');
          await until('Home', () => b.run("!!document.querySelector('.calm-home .chat-list')"), 30_000);
        }
        const m = await b.run(`(() => {
          const shown = (e) => e.getBoundingClientRect().height > 0;
          const list = document.querySelector('.chat-list'), rows = [...list.querySelectorAll('a.cl-row')];
          const box = (e) => e.getBoundingClientRect(), col = box(list);
          const hit = (a, c) => a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5;
          const rects = rows.filter(shown).map(box);
          const pairs = [];
          rects.forEach((a, i) => rects.slice(i + 1).forEach((c, j) => { if (hit(a, c)) pairs.push(i + ' x ' + (i + 1 + j)); }));
          const out = rects.filter((r) => r.left < col.left - 0.5 || r.right > col.right + 0.5).length;
          // A preview line ends in an ellipsis by design (.clamp1); names, times and counts are never cut.
          const clipped = [...list.querySelectorAll('.cl-top b, time, .cl-count')]
            .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent?.slice(0, 40));
          // Body text is 16px or more; only a time and a count are smaller.
          const tiny = [...list.querySelectorAll('*')].filter((e) => [...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())
            && shown(e) && !e.closest('time, .cl-count') && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.textContent.slice(0, 30));
          const crew = rows.filter((r) => r.getAttribute('href') !== '#/chief');
          const chief = rows.find((r) => r.getAttribute('href') === '#/chief');
          return { pairs, out, clipped, tiny, names: crew.map((r) => r.getAttribute('href')), first: rows[0]?.getAttribute('href'),
            chiefLine: chief.querySelector('.cl-line').textContent, chiefCount: chief.querySelector('.cl-count')?.textContent ?? '',
            crewActs: crew.flatMap((r) => [...r.querySelectorAll('button, .btn, .cl-count')]).map((e) => e.textContent),
            crewText: crew.map((r) => r.innerText), hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
        })()`);
        const at = `${demo} ${theme} at ${width}`;
        try {
          // Chief's row leads and carries the count: "Chief has N things for you" and N, one number for a house at every
          // width and theme.
          assert.equal(m.first, '#/chief', `${at}: Chief's row leads the list`);
          const has = Number(/^Chief has (\d+)/.exec(m.chiefLine)?.[1] ?? 0);
          assert.equal(has, asked[demo] ??= has, `${at}: Chief's count is the same at every width and theme (${m.chiefLine})`);
          assert.equal(m.chiefCount, has ? String(has > 9 ? '9+' : has) : '', `${at}: Chief's badge says his line's count`);
          assert.equal(new Set(m.names).size, m.names.length, `${at}: nobody twice in the list`);
          assert.ok(m.names.every((h: string) => /^#\/(h\/|room$)/.test(h)), `${at}: every other row opens that helper or the crew room`);
          assert.equal(m.names.filter((h: string) => h.startsWith('#/h/')).length, n, `${at}: one row per helper`);
          assert.equal(m.out, 0, `${at}: every row inside the list`);
          assert.equal(m.pairs.length, 0, `${at}: no row covers another: ${m.pairs.join('; ')}`);
          assert.deepEqual(m.clipped, [], `${at}: no name, time or count cut off`);
          assert.deepEqual(m.tiny, [], `${at}: body text is 16px or more`);
          assert.equal(m.hscroll, false, `${at}: no sideways scroll`);
          // Only Chief asks: no crew row answers, approves, counts or carries the ask.
          assert.deepEqual(m.crewActs, [], `${at}: no crew row has a button or a count`);
          assert.ok(m.crewText.every((x: string) => !/Needs you|has a question|needs your OK|Review .*order|Answer |Place order|\w needs you|your OK/i.test(x)), `${at}: no crew row carries the ask (${m.crewText.join(' | ')})`);
          assert.ok(m.crewText.every((x: string) => !/session|terminal|console|tmux|cursor/i.test(x)), `${at}: no terminal words in the list (${m.crewText.join(' | ')})`);
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
      await until('Home', () => b.run("document.querySelectorAll('.chat-list .face img').length > 1"), 30_000);
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
  // Only Chief says "Needs you" (Main: one person, one Chief): a crew member waiting on the person reads "Waiting" on the
  // crew page and says nothing of the sort in the list beside it, and Chief's tile says his real status.
  for (const theme of ['day', 'night']) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.open(`demo&${theme}#/crew`);
    await until('the crew tiles and the rail', () => b.run("document.querySelectorAll('.st-tile').length > 3 && document.querySelectorAll('.side .cl-row').length > 0"), 30_000);
    const page = await b.run("[...document.querySelectorAll('.st-tile:not([href=\"#/chief\"]) .st-pill')].map((e) => e.textContent)"), at = `${theme} crew page`;
    assert.ok(!page.includes('Needs you'), `${at}: no crew tile says "Needs you" (${page.join(' | ')})`);
    assert.ok(page.includes('Waiting'), `${at}: a waiting crew member says "Waiting" (${page.join(' | ')})`);
    assert.equal(await b.run("document.querySelector('.st-tile[href=\"#/chief\"] .st-pill')?.textContent"), 'Needs you', `${at}: Chief's tile says his real status`);
    const rail = await b.run("[...document.querySelectorAll('.side .cl-row:not([href=\"#/chief\"]) .cl-line')].map((e) => e.textContent)"), atRail = `${theme} list`;
    assert.ok(rail.length > 2 && rail.every((l: string) => !/Needs you/.test(l)), `${atRail}: no crew row in the list says "Needs you" (${rail.join(' | ')})`);
  }
});

test('what waits on the person is one count: the phone list, the computer list and the tab bar agree', { skip: !bin && 'no Chromium here' }, async () => {
  // Chief's row says "Chief has N things for you" with N beside it (A.chiefHas, counts.needs), on the phone's Home and
  // in the computer's left pane; the phone's tab bar (shown off Home and the chats) carries the same N on Chief's tab.
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const num = (s: string | null | undefined) => Number(/\d+/.exec(s ?? '')?.[0] ?? 0);
  const chiefRow = `document.querySelector('.chat-list a.cl-row[href="#/chief"]')`;
  for (const demo of ['umer', 'b1', 'crew5', 'crew12', 'calm', 'finished']) {
    const counts: Record<string, number> = {};
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 });
      await b.open(`demo=${demo}&day#/`);
      await until('the list', () => b.run(`!!${chiefRow}`), 30_000);
      const has = await b.run(`${chiefRow}.querySelector('.cl-line').textContent`);
      counts[`line ${w}`] = /^Chief has/.test(has) ? num(has) : 0;
      counts[`badge ${w}`] = num(await b.run(`${chiefRow}.querySelector('.cl-count')?.textContent`));
      if (w < 900) {
        await b.run('location.hash = "#/crew"');
        await until('the tab bar', () => b.run("!!document.querySelector('.tabs')"), 30_000);
        assert.equal(await b.run("[...document.querySelectorAll('.tabs .tab-ic')].filter((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)').length"), 1, `${demo}: only the current tab is lit`);
        counts['tab bar'] = num(await b.run("document.querySelector('.tabs .tab-badge')?.textContent"));
      }
    }
    assert.equal(new Set(Object.values(counts)).size, 1, `${demo}: one count everywhere (${JSON.stringify(counts)})`);
  }
  // The goal is one tap from Home: a row under the chats on a phone, a place in the left pane on a computer.
  for (const theme of ['day', 'night']) for (const width of [390, 1440]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await b.open(`demo=goal&${theme}#/`);
    const sel = width === 390 ? '.calm-home a.cl-goal' : '.side a[href="#/goal"]';
    await until('the goal link', () => b.run(`!!document.querySelector('${sel}')`), 30_000);
    const link = await b.run(`(() => { const a=document.querySelector('${sel}'), box=a.getBoundingClientRect(), title=a.querySelector('b')?.getBoundingClientRect(), detail=a.querySelector('.cl-line')?.getBoundingClientRect();
      return { separate: !detail || title.bottom <= detail.top, tappable: box.height >= 48, inside: box.left >= 0 && box.right <= innerWidth }; })()`);
    assert.deepEqual(link, { separate: true, tappable: true, inside: true }, `${theme} ${width}: the goal link's title and description are separate, readable rows`);
  }
});

test('the left pane never stacks rows: the chat list scrolls inside it, Settings and the person stay whole and tappable', { skip: !bin && 'no Chromium here' }, async () => {
  // With a long crew on a short screen the person at the foot once sat over Settings; the chat list takes the pane's
  // free height and scrolls, so every row keeps its own box. List rows count only where the list shows them.
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const [w, h] of [[1280, 832], [1280, 720]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    for (const demo of ['crew5', 'crew12', 'crew30']) {
      await b.open(`demo=${demo}&day#/`);
      await until('the left pane', () => b.run("document.querySelectorAll('.side .cl-row').length > 0"), 30_000);
      const r = await b.run(`(() => {
        const list = document.querySelector('.side .chat-list').getBoundingClientRect();
        const boxes = [...document.querySelectorAll('.side .brand, .side .search-pill, .side-nav, .side .cl-row, .side-me')].map((e) => {
          const r = e.getBoundingClientRect(), inList = e.closest('.chat-list');
          return { t: e.textContent.trim().slice(0, 24), top: inList ? Math.max(r.top, list.top) : r.top, bottom: inList ? Math.min(r.bottom, list.bottom) : r.bottom, left: r.left, right: r.right };
        }).filter((b) => b.bottom - b.top > 1);
        const overlap = [];
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => { if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1) overlap.push(a.t + ' / ' + b.t); }));
        const hit = (sel) => { const e = document.querySelector(sel), r = e.getBoundingClientRect(); return r.bottom <= innerHeight && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('a') === e; };
        return { overlap, settings: hit('.side-more a[href="#/settings"]'), me: hit('.side-me') };
      })()`);
      assert.deepEqual(r, { overlap: [], settings: true, me: true }, `${demo} at ${w}x${h}: pane rows stay apart, Settings and the person whole and tappable`);
    }
  }
});

test('your crew page and the list agree on who is at work: every At work tile is a working row, and only those', { skip: !bin && 'no Chromium here' }, async () => {
  // The Your crew tiles' status word (A.statusOf) and the list's working line (A.chats) come from one rule. This fails
  // on a second status rule (the reported bug: Reel and Scout showed their job while the rail said Waiting).
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const demo of ['umer', 'b1', 'crew5', 'crew12', 'calm', 'finished']) {
    await b.open(`demo=${demo}&day#/crew`);
    await until('the crew tiles and the list', () => b.run("document.querySelectorAll('.st-tile').length > 3 && document.querySelectorAll('.side .cl-row').length > 2"), 30_000);
    const r = await b.run(`(() => ({
      page: Object.fromEntries([...document.querySelectorAll('.st-tile:not(.st-new):not([href="#/chief"])')].map((t) => [t.querySelector('b')?.textContent.trim(), t.querySelector('.st-pill')?.textContent.trim() === 'At work'])),
      list: Object.fromEntries([...document.querySelectorAll('.side .cl-row[href^="#/h/"]')].map((row) => [row.querySelector('b')?.textContent.trim(), !!row.querySelector('.cl-line.working')])) }))()`);
    const page = r.page as Record<string, boolean>, list = r.list as Record<string, boolean>;
    assert.ok(Object.keys(list).length > 1, `${demo}: the list holds the crew (${JSON.stringify(list)})`);
    assert.deepEqual(list, page, `${demo}: the crew page and the list agree on who is at work`);
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

test('a finished sheet ends Chief\'s thread as a compact attachment: neutral, its name and one line of what is in it, and a tap opens the read-only sheet', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const card = `(() => { const c = [...document.querySelectorAll('.chat .lines a.att')].at(-1); if (!c) return null;
    const small = [...c.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.textContent);
    const r = c.getBoundingClientRect(), bubble = c.closest('.line').querySelector('.bubble-text');
    return { name: c.querySelector('.att-what b').textContent, about: c.querySelector('.att-what span').textContent, open: c.getAttribute('href'),
      fill: getComputedStyle(c).backgroundColor, ink: getComputedStyle(document.body).backgroundColor, said: bubble?.textContent ?? '',
      buttons: c.querySelectorAll('button, .btn').length, narrow: r.width <= Math.min(innerWidth * 0.8, 360) + 1, small }; })()`;
  for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await b.open('demo=done&day#/chief');
    await until(`the attachment at ${w}`, () => b.run(card), 30_000);
    const c = await b.run(card);
    assert.equal(c.name, 'Monthly budget');
    assert.ok(c.about.length > 0, 'one line of what is in it under the name');
    assert.match(c.said, /monthly budget is ready/, 'Chief\'s words sit in the bubble above it');
    assert.match(c.open, /^#\/f\/scribe\//);
    assert.equal(c.buttons, 0, 'no buttons on the attachment: a tap opens it');
    assert.ok(c.narrow, `${w}: the attachment is compact, never a full-width block`);
    assert.notEqual(c.fill, 'rgba(0, 0, 0, 0)', 'it sits on the bubbles\' own neutral surface');
    assert.deepEqual(c.small, [], `${w}: nothing on the attachment reads under 16px`);
    // A tap: the read-only sheet over Chief's thread (on a computer the wide page), then Back to the same attachment.
    await b.run(`[...document.querySelectorAll('.chat .lines a.att')].at(-1).click(), 0`);
    await until('the open sheet', () => b.run(`!!document.querySelector('.wb-scrim .wb-grid')`), 30_000);
    if (!mobile) assert.ok(await b.run(`!!document.querySelector('.wb-scrim.wb-wide')`), 'a computer opens the wide file page');
    await b.run('history.back(), 0');
    await until('Chief\'s thread with the attachment', () => b.run(`location.hash === '#/chief' && !document.querySelector('.wb-scrim') && !!document.querySelector('.chat .lines a.att')`), 10_000);
    await b.run(`[...document.querySelectorAll('.chat .lines a.att')].at(-1).click(), 0`);
    await until('the attachment opens the sheet again', () => b.run(`!!document.querySelector('.wb-scrim .wb-grid')`), 30_000);
  }
});

test('a routine\'s switch keeps its knob inside the track, day and night, phone and computer, text at 1.3x', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  // The knob is a ::after, so its box comes from the computed style; translateX counts too (two switch rules once stacked both).
  const gap = `(() => { const i = document.querySelector('.routine-switch input'); if (!i) return null; const w = i.nextElementSibling;
    const k = getComputedStyle(i, '::after'), t = new DOMMatrix(k.transform === 'none' ? undefined : k.transform), r = i.getBoundingClientRect();
    const knob = r.left + i.clientLeft + parseFloat(k.left) + t.e + parseFloat(k.width);
    return { inTrack: r.right - knob, toWords: w ? w.getBoundingClientRect().left - knob : 1, words: w?.textContent }; })()`;
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

test('things, routines and helper profiles: each thing its maker\'s card, shared file cards, names in full, nothing overlaps', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  // Old-style markers: the pastel file chip and the coral result link. Their Term replacements carry the rows.
  const markers = `(() => ({ chips: document.querySelectorAll('.file-chip').length,
    coral: document.querySelectorAll('.link.pink').length,
    tiles: [...document.querySelectorAll('.st-made .wb-ic, .st-made .doc-ic')].map((e) => e.textContent),
    made: [...document.querySelectorAll('.st-things .st-made .wb-card')].map((c) => !!c.querySelector(':scope > .face') && !!c.querySelector(':scope > .wb-open')),
    primary: [...document.querySelectorAll('.routine .btn.go, .wb-panel .btn.go')].map((e) => e.textContent),
    rows: [...document.querySelectorAll('.routine, .st-made .wb-card, .st-made .doc')].map((row) => {
      const r = row.getBoundingClientRect(), kids = [...row.children].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
      const overlap = kids.some((a, i) => kids.some((c, j) => j > i && a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1));
      const clip = kids.some((k) => k.left < r.left - 1 || k.right > r.right + 1);
      const cut = [...row.querySelectorAll('b')].some((e) => e.scrollWidth > e.clientWidth + 1);
      return { overlap, clip, cut };
    }) }))()`;
  for (const theme of ['day', 'night']) for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    const at = `${theme} ${w}`;
    await b.open(`demo&${theme}#/things`);
    await until('the things cards', () => b.run("document.querySelectorAll('.st-things .st-made .wb-card').length > 0"), 30_000);
    let m = await b.run(markers);
    assert.equal(m.chips, 0, `${at} things: no old file chips`);
    assert.ok((m.made as boolean[]).length > 0 && (m.made as boolean[]).every(Boolean), `${at} things: every card wears its maker's face and an Open`);
    for (const [i, r] of m.rows.entries()) assert.ok(!r.overlap && !r.clip && !r.cut, `${at} thing ${i}: nothing overlaps, spills or cuts`);
    await b.open(`demo&${theme}#/routines`);
    await until('the routine rows', () => b.run("document.querySelectorAll('.routine').length > 0"), 30_000);
    m = await b.run(markers);
    assert.equal(m.coral, 0, `${at} routines: no coral result link`);
    assert.ok(((m.primary as string[]).some((t) => /Do it now|Download/.test(t ?? ''))), `${at} routines: one filled-blue primary per row`);
    await b.open(`demo&${theme}#/h/scribe/details`);
    await until("scribe's files and job", () => b.run("document.querySelectorAll('.st-made .wb-card, .st-made .doc').length > 0 && !!document.querySelector('.st-job dt')"), 30_000);
    m = await b.run(markers);
    assert.equal(m.chips, 0, `${at} helper details: no old file chips`);
    assert.ok(m.tiles.length > 0, `${at} helper profile: finished work wears the shared tile`);
    assert.deepEqual(await b.run(`(() => ({ hero: !!document.querySelector('.st-profile-hero .face'),
      job: [...document.querySelectorAll('.st-profile-job .st-job dt')].map((d) => d.textContent).join(), remembers: document.body.textContent.includes('What Scribe remembers'),
      chief: [...document.querySelectorAll('.st-profile-job > .btn')].map((x) => x.textContent).join(), scroll: document.documentElement.scrollWidth > innerWidth + 1,
      typed: document.querySelectorAll('.st-profile-job input:not([type=checkbox]):not([type=url]), .st-profile-job textarea').length,
      skillAddress: document.querySelectorAll('.st-profile-job input[type=url]').length,
      seen: ${mobile} || document.querySelector('.st-change').getBoundingClientRect().bottom <= innerHeight }))()`),
      { hero: true, job: 'Does,Aims,Asks', remembers: true, chief: "Ask Chief to change Scribe's job", scroll: false, typed: 0, skillAddress: 1, seen: true }, `${at}: profile reads the job in three rows, nothing is typed to the helper, and Chief is the one way to change it, in view on a computer`);
    for (const [i, r] of m.rows.entries()) {
      assert.ok(!r.overlap, `${at} row ${i}: never overlaps`);
      assert.ok(!r.clip, `${at} row ${i}: nothing spills past the row`);
      assert.ok(!r.cut, `${at} row ${i}: names read in full`);
    }
    await b.open(`demo&${theme}#/h/scribe/chat`);
    await until('helper composer', () => b.run("!!document.querySelector('.st-helper-chat .composer textarea')"), 30_000);
    assert.equal(await b.run("document.querySelectorAll('.st-helper-chat textarea').length"), 1, `${at}: helper has its own composer`);
    if (!mobile) assert.equal(await b.run(`(() => { const p = document.querySelector('.st-helper-chat'),
      a = p.querySelector('.lines').getBoundingClientRect(), c = p.querySelector('.working-on').getBoundingClientRect();
      return c.left >= a.right - 1 && Math.abs(c.top - a.top) < 2 && p.getBoundingClientRect().width === document.querySelector('.main').getBoundingClientRect().width; })()`), true, `${at}: helper context sits beside the full-width transcript, never below it`);
  }
});

test('first run and the Share sheet read Term: Chief\'s pitch with ideas to try, no bubble, one blue primary, words in full', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  const look = `(() => { const W = innerWidth, sp = document.querySelector('.speech'), st = sp && getComputedStyle(sp);
    const boxes = (sel) => [...document.querySelectorAll(sel)].map((row) => {
      const r = row.getBoundingClientRect(), kids = [...row.children].map((e) => e.getBoundingClientRect());
      return { overlap: kids.some((a, i) => kids.some((c, j) => j > i && a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1)),
        clip: r.left < -1 || r.right > W + 1 || kids.some((k) => k.left < r.left - 1 || k.right > r.right + 1) }; });
    return { ideas: document.querySelectorAll('.chips.center .chip').length,
      bubble: !!st && (parseFloat(st.borderTopWidth) > 0 || st.backgroundColor !== 'rgba(0, 0, 0, 0)'),
      chips: document.querySelectorAll('.share .chip').length, primary: document.querySelectorAll('.share .btn.go').length,
      faces: document.querySelectorAll('.share .fr-mark .face img.ink').length,
      cut: [...document.querySelectorAll('.share .said, .chips.center .chip')].some((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1),
      rows: boxes('.chips.center, .share-acts') }; })()`;
  const shared = new URLSearchParams({ title: 'Dentist appointment', text: 'Dr Patel, Thursday 14 November at 10:30, Harley Street Dental Practice, please arrive 10 minutes early' });
  for (const theme of ['day', 'night']) for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    const at = `${theme} ${w}`;
    await b.open(`demo=named&${theme}#/chief`);
    await until('the first-run ideas', () => b.run("document.querySelectorAll('.chips.center .chip').length > 0"), 30_000);
    let m = await b.run(look);
    assert.ok(m.ideas >= 4, `${at} named: the ideas to try and How does this work? sit under his pitch`);
    assert.ok(!m.bubble, `${at} named: Chief's pitch is plain words, not a speech bubble`);
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
  await b.open('demo=umer&day#/chief');
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
  const assign = (bot: string, text: string) => { lab.crew.say('chief', 'person', text); return delegated(lab.crew, bot, text).task; };
  const job = assign('scout', 'Check my Friday flights; ask permission');
  await holding(lab.crew, 'scout');
  const b = await browse(base);
  await b.send('Page.enable'); await b.send('Runtime.enable');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await b.open(`day#person=${person}`);
  await until('Home', () => b.run("!!document.querySelector('.chat-list')"), 30_000);
  const row = () => b.run(`(() => { const r = document.querySelector('.chat-list a.cl-row[href="#/h/scout"]'); return r && { working: !!r.querySelector('.cl-line.working'), badge: !!r.querySelector('.cl-count'), stuck: !!r.querySelector('.stuck') }; })()`);
  await until('Scout at work', async () => (await row())?.working === true, 30_000);
  assert.equal((await row()).badge, false);
  const rowMotion = () => b.run(`document.querySelector('.chat-list a.cl-row[href="#/h/scout"] .face')?.dataset.motion`);
  assert.equal(await rowMotion(), 'work', 'the real working task leans on Home');
  // Scout goes quiet past the limit: still one status on its row, no ask card under it; the ask is Chief's alone.
  lab.db.run('UPDATE tasks SET updated_at = updated_at - 300000 WHERE id = ?', job);
  // Chief's row carries the ask as what he has for you, with its count.
  const chief = () => b.run(`(() => { const r = document.querySelector('.chat-list a.cl-row[href="#/chief"]'); return [r?.querySelector('.cl-line')?.textContent, r?.querySelector('.cl-count')?.textContent ?? null]; })()`);
  await until('Chief asks about Scout', async () => (await chief())[0] === 'Chief has 1 thing for you', 30_000);
  assert.deepEqual(await chief(), ['Chief has 1 thing for you', '1'], 'Chief\'s row: what he has for you, and its count');
  assert.deepEqual(await row(), { working: true, badge: false, stuck: false }, 'a quiet helper\'s row carries its work and no ask');
  await b.run('location.hash = "#/chief"');
  await until("the Stop card in Chief's thread", () => b.run(`[...document.querySelectorAll('.stuck')].some((e) => /Scout has been quiet/.test(e.textContent))`), 30_000);
  await b.run('location.hash = "#/h/scout"');
  await until("Scout's own thread", () => b.run(`!!document.querySelector('.line') && !document.querySelector('.stuck')`), 30_000);
  assert.equal(await b.run(`document.querySelectorAll('.stuck').length`), 0, 'Scout\'s own thread asks nothing: the Stop card is Chief\'s alone');
  assert.deepEqual(await b.run(`[!!document.querySelector('.read-along'), document.querySelectorAll('.chat-page textarea').length]`), [false, 1], 'a helper\'s own thread has a composer');
  // The helper's own controls ride under its head while it works: its word, Stop, and Take control when it has a computer, all inside the phone.
  const bar = await b.run(`(() => { const e = document.querySelector('.live-ctl'), r = e?.getBoundingClientRect(); return e && { words: [...e.children].map((c) => c.textContent), inside: r.left >= 0 && r.right <= innerWidth }; })()`);
  assert.equal(bar.words[0], 'At work'); assert.equal(bar.words.at(-1), 'Stop'); assert.equal(bar.inside, true, 'the bar fits the phone');
  assert.equal(bar.words.includes('Take control'), (await api('/api/state')).bots.find((x: { id: string }) => x.id === 'scout').computer, 'Take control is there exactly when the helper has a computer');
  // Use crewd's real ephemeral fan-out, the same path the scripted runtime's text callback uses.
  lab.db.live('reply.partial', 'scout', { task: job, text: 'Umer, three Friday flights are ready.' });
  await until('the header and streamed reply nod together', () => b.run(`document.querySelector('.chat-head .face')?.dataset.motion === 'talk' && document.querySelector('.streaming .face')?.dataset.motion === 'talk'`));
  // The calm thread's bubbles carry no face: the header's 32px face is the one that nods.
  assert.deepEqual(await b.run(`[document.querySelector('.chat-head .face').offsetWidth, document.querySelector('.streaming .face').offsetWidth]`), [32, 0]);
  const speaking = await b.run(`document.querySelector('.chat-head .face img').src`);
  lab.db.live('reply.partial', 'scout', { task: job, text: 'Umer, three Friday flights are ready. I checked the times.' });
  await until('the next streamed words', () => b.run(`document.querySelector('.streaming')?.textContent.includes('checked the times')`));
  assert.equal(await b.run(`document.querySelector('.chat-head .face img').src`), speaking, 'streaming words do not restart the nod');
  await b.run('location.hash = "#/"');
  await until('Home', () => b.run("!!document.querySelector('.chat-list')"), 30_000);
  await release(lab.crew, 'scout', 'Three Friday flights are ready.'); await settled(lab.db, job); await release(lab.crew, 'verifier-vera'); // the check's brief repeats the ask, so the stub holds it too
  await until('Scout done on its row', async () => (await row())?.working === false && (await rowMotion()) === 'done', 30_000);
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await b.run(`matchMedia('(prefers-reduced-motion: reduce)').matches`), true);
  await b.send('Emulation.setEmulatedMedia', { features: [] });
  // Chief relayed Scout's reply, so it is unread in Chief's thread and not in Scout's: only Chief carries a mark, so the left pane's Scout row has none.
  assert.equal((await api('/api/bots/chief')).bot.unread > 0, true);
  assert.equal((await api('/api/bots/scout')).bot.unread, 0, 'a reply Chief relayed is not unread in the helper’s own thread');
  await b.run('location.hash = "#/chief"');
  await until('opening NEW divider', () => b.run("!!document.querySelector('.new-divider')"), 30_000);
  await until('read acknowledged', async () => (await api('/api/bots/chief')).bot.unread === 0);
  const boundary = await b.run("(() => { const n = document.querySelector('.new-divider'); return {word:n?.textContent, after:n?.nextElementSibling?.textContent}; })()");
  assert.equal(boundary.word, 'New'); assert.match(boundary.after, /Scout|Friday/, 'the divider opens on Chief’s first unread line about Scout’s job');
  await b.run('location.hash = "#/"');
  await until('left the helper thread', () => b.run("!!document.querySelector('.calm-home')"));
  await b.run('location.hash = "#/h/scout"');
  await until('opened the read thread', () => b.run("!!document.querySelector('.chat-page .line.them')"));
  assert.equal(await b.run("!!document.querySelector('.new-divider')"), false, 'a read thread has no NEW on the next visit');
  // A computer's Home shows Chief's thread in the centre pane, which reads it, so the left pane is checked after the NEW divider.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await until('the left pane\'s Scout row done', () => b.run("(() => { const r = document.querySelector('.side a.cl-row[href=\"#/h/scout\"]'); return !!r && !r.querySelector('.working'); })()"), 30_000);
  assert.equal(await b.run("document.querySelectorAll('.side a.cl-row:not([href=\"#/chief\"]) :is(.cl-count, .cl-dot)').length"), 0, 'no crew row in the left pane carries a mark');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  // A Chief-assigned job is one hand-off chip, under the limit from crewd's grants.
  const next = assign('scout', 'check the Monday trains; ask permission');
  await holding(lab.crew, 'scout');
  await b.run('location.hash = "#/chief"');
  await until('the hand-off chip', () => b.run(`/at work/.test([...document.querySelectorAll('a.hand[href="#/h/scout"]')].at(-1)?.textContent ?? '')`), 30_000);
  // The Friday request was Chief's first hand-off to Scout, so it carries the limit; this Monday one is the second and does not.
  const chip = await b.run(`(() => { const hs = [...document.querySelectorAll('.hand-off')].filter((e) => e.querySelector('a.hand[href="#/h/scout"]')), h = hs.at(-1), lines = [...document.querySelectorAll('.chat .lines .line:not(.live-line)')];
    return { limit: hs[0].querySelector('.hand-limit').textContent, second: h.querySelector('.hand-limit'), href: h.querySelector('a.hand').getAttribute('href'), after: lines.indexOf(h) > lines.findIndex((l) => /Monday trains/.test(l.textContent)) }; })()`);
  assert.match(chip.limit, /^Scout .*can't pay or send anything without asking you\.$/);
  assert.deepEqual([chip.href, chip.after, chip.second], ['#/h/scout', true, null], 'the chip opens Scout\'s thread and sits after the request that handed it on');
  await release(lab.crew, 'scout', 'Two trains on Monday.'); await settled(lab.db, next); await release(lab.crew, 'verifier-vera'); // the check's brief repeats the ask, so the stub holds it too
  // The result is already the chip, so the finished job raises no toast in the thread it appears in (chat quality gap 12).
  await until('the first chip reads done', () => b.run(`/done/.test([...document.querySelectorAll('a.hand[href="#/h/scout"]')].at(-1)?.textContent ?? '')`), 30_000);
  assert.deepEqual(await b.run(`[...document.querySelectorAll('.toast')].map((t) => t.textContent).filter((t) => /Monday trains/.test(t))`), [], 'no toast repeats the finished job in the open thread');
  // A second hand-off to the same helper says the job alone: the limit sentence rides only its first hand-off (gap 13).
  const again = assign('scout', 'check the Friday flights; ask permission');
  await holding(lab.crew, 'scout');
  await until('the third hand-off chip', () => b.run(`[...document.querySelectorAll('.hand-off')].filter((e) => e.querySelector('a.hand[href="#/h/scout"]')).length === 3 && /at work/.test([...document.querySelectorAll('a.hand[href="#/h/scout"]')][2]?.textContent ?? '')`), 30_000);
  assert.equal(await b.run(`!![...document.querySelectorAll('.hand-off')].filter((e) => e.querySelector('a.hand[href="#/h/scout"]'))[2].querySelector('.hand-limit')`), false, 'the third hand-off carries no limit sentence');
  await release(lab.crew, 'scout', 'Two flights on Friday.'); await settled(lab.db, again); await release(lab.crew, 'verifier-vera'); // the check's brief repeats the ask, so the stub holds it too
  // Hold the browser's roster refresh while a real new helper starts: an old snapshot cannot prove it was deleted.
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/state', requestStage: 'Request' }] });
  const rae = await api('/api/recruit', { template: 'scout', name: 'Research Rae' });
  const named = assign(rae.id, 'check the notebook; ask permission');
  await holding(lab.crew, rae.id);
  try {
    await b.open(`day#/h/${rae.id}`);
    await until('the held roster refresh', () => b.paused.length > 0);
    await b.run('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const page = await b.run('({hash:location.hash,text:document.body.innerText})');
    assert.equal(page.hash, `#/h/${rae.id}`, 'a stale roster never throws a new helper’s chat back to Home');
    assert.doesNotMatch(page.text, /This helper has left the crew/, 'absence from a stale roster never claims the helper left');
  } finally { await b.send('Fetch.disable'); }
  const writing = [];
  for (const theme of ['day', 'night']) for (const width of [390, 1440]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await b.open(`${theme}#/h/${rae.id}`);
    try { await until('the working helper’s Stop button', () => b.run("!!document.querySelector('.live-ctl button')"), 30_000); }
    catch (e) { console.error('working header diagnostic', { theme, width, task: lab.db.get('SELECT id, bot, state FROM tasks WHERE id = ?', named), page: await b.run('({url:location.href,text:document.body.innerText})') }); throw e; }
    const wholeWord = await b.run(`(() => { const n=document.querySelector('.chat-head .ch-name a').firstChild,r=document.createRange();r.setStart(n,0);r.setEnd(n,'Research'.length);return r.getClientRects().length===1; })()`);
    await b.open(`${theme}#/chief`);
    await until('Chief’s voice button', () => b.run("!!document.querySelector('.composer .c-pill > .mic')"), 30_000);
    await b.run("document.querySelector('.composer textarea').focus();document.querySelector('.composer textarea').select()");
    await b.send('Input.insertText', { text: 'Ask Research Rae to read facts.txt and tell me who owns the blue folder and its reference.' });
    const clear = await b.run(`(() => { const t=document.querySelector('.composer textarea'),m=document.querySelector('.composer .c-pill > .mic');return t.getBoundingClientRect().right-parseFloat(getComputedStyle(t).paddingRight)<=m.getBoundingClientRect().left; })()`);
    writing.push({ theme, width, wholeWord, clear });
  }
  for (const r of writing) assert.deepEqual([r.wholeWord,r.clear], [true,true], `${r.theme} ${r.width}: a working helper’s name stays whole-word and the microphone never covers typed words`);
  await release(lab.crew, rae.id, 'The notebook is checked.'); await settled(lab.db, named);
  for (const theme of ['day', 'night']) for (const width of [390, 1440]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await b.open(`${theme}#/chief`);
    await until('the named helper’s finished chip', () => b.run(`[...document.querySelectorAll('.hand')].some(h => h.textContent.includes('Research Rae') && /done/.test(h.textContent))`), 30_000);
    const fit = await b.run(`(() => { const h = [...document.querySelectorAll('.hand')].find(h => h.textContent.includes('Research Rae')),
      word = h.querySelector('.hand-word'), label = h.querySelector('b').parentElement, r = document.createRange(); r.selectNodeContents(label);
      const w = word.getBoundingClientRect(), box = h.getBoundingClientRect(); return { clipped: word.scrollWidth > word.clientWidth + 1,
        overlap: [...r.getClientRects()].some(x => Math.min(x.right,w.right)-Math.max(x.left,w.left)>1 && Math.min(x.bottom,w.bottom)-Math.max(x.top,w.top)>1),
        inside: box.left >= 0 && box.right <= innerWidth }; })()`);
    assert.deepEqual(fit, { clipped: false, overlap: false, inside: true }, `${theme} ${width}: the helper’s full name and finished status stay readable`);
  }
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

test('your path to the US opens from the goal: four stages that open on a tap, each claim with its page and date, nothing to fill in, phone and computer, day and night', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  await b.send('Page.enable'); await b.send('Runtime.enable');
  for (const theme of ['day', 'night']) for (const width of [390, 1440]) {
    const at = `${theme} ${width}`;
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await b.open(`demo=goal&${theme}#/goal`);
    await until('the path link on the goal', () => b.run("!!document.querySelector('a.path-link[href=\"#/goal/path\"]')"), 30_000);
    await b.run("document.querySelector('a.path-link').click()");
    await until('the four stages', () => b.run("document.querySelectorAll('.path-stages > li').length === 4"), 30_000);
    assert.equal(await b.run("document.querySelectorAll('.path-item').length"), 0, `${at}: the stages start closed`);
    assert.match(await b.run("document.querySelector('.goal-rules').textContent"), /not legal advice/, `${at}: says it is information`);
    await b.run("document.querySelector('.path-head').click()");
    await until('the first stage', () => b.run("document.querySelector('.path-head').getAttribute('aria-expanded') === 'true' && document.querySelectorAll('.path-item').length > 0"), 30_000);
    await b.run("document.querySelector('.path-item summary').click()");
    await until('an item', () => b.run("document.querySelector('.path-item').open && !!document.querySelector('.path-claim a')"), 30_000);
    const m = await b.run(`(() => {
      const claim = document.querySelector('.path-claim'), a = claim.querySelector('a'), page = document.querySelector('.path-page');
      const small = [...page.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.className || e.tagName);
      const tight = [...page.querySelectorAll('button, summary')].filter((e) => e.getBoundingClientRect().height < 44).length;
      return { href: a.href, when: /(updated|checked|current as of) \\d{1,2} [A-Z][a-z]{2} \\d{4}/.test(claim.textContent), asks: page.querySelectorAll('input, textarea, select').length,
        wide: document.documentElement.scrollWidth > innerWidth, small, tight, says: claim.querySelector('p').textContent.length > 12 }; })()`);
    assert.match(m.href, /^https:\/\//, `${at}: a claim links to its page`);
    assert.deepEqual({ ...m, href: '' }, { href: '', when: true, asks: 0, wide: false, small: [], tight: 0, says: true }, `${at}: dated, nothing to fill in, no sideways scroll, text 16px or more, rows 44px tall`);
  }
});
