// The chat never goes quiet (bar.md, ch-chat-live-1): from the send to the reply the thread changes at least once a
// second, through a long model turn and a job passed to a helper, on a desk and at phone width. Real crewd (stub
// engine, its turn held) and the real built web app in a real Chromium. Needs a Chromium on PATH (skipped without one).
// As on a normal install, the phone link listens and no phone is paired, so Chief's thread carries Add your phone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { taskBrowser } from './browser.ts';
import { temp } from './tmp.ts';
import { setup, until, release, holding, settled, delegated } from './lab.ts';
import { browserBin } from '../src/desktop.ts';
import { startServer } from '../src/server.ts';

const repo = join(import.meta.dirname, '..');
const bin = browserBin();
/** The bar: never more than a second without a visible change, timed by the page itself (a slow runner's own
 *  round trips do not count against the product). The clock ticks on each whole second of the job, so a still
 *  stretch is its one-second period plus the browser's timer jitter. A busy CI runner delays a tick by 20 ms and
 *  more (CI 2026-10-10: 1020 and 1022 ms), while a thread that really stalls misses a whole tick (2000 ms), so the
 *  jitter allowance is a quarter second: it never hides a missed tick. */
const GAP_MS = 1000, JITTER_MS = 250, HELD_MS = 3500;

test('from send to reply the thread never sits still: a held Chief turn and a job passed to Scout, at 1440 and 390', { skip: !bin && 'no Chromium here' }, async () => {
  // The app as built from this tree, served by crewd itself.
  const parent = temp('chat-live');
  cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
  for (const d of ['src', 'templates', 'tools', 'skills', 'package.json']) symlinkSync(join(repo, d), join(parent, d));
  const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  let server: Awaited<ReturnType<typeof startServer>> | undefined, browser: ReturnType<typeof taskBrowser> | undefined, ws: WebSocket | undefined;
  // A failed browser close must not keep the server (and so the process) alive: the suite then waits out its file bound and kills it.
  // Registered before setup's own after(done), so the server and its phone link's 30 s timer stop before the database closes.
  after(async () => { ws?.close(); try { await browser?.close(); } finally { server?.closeAllConnections(); await new Promise((r) => server ? server.close(r) : r(null)); done(); } });
  const { cfg, db, crew, done } = setup();
  const linkPort = await new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
  Object.assign(cfg, { port: 0, host: '127.0.0.1', linkHost: '127.0.0.1', linkPort, repoDir: parent });
  server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = (method: string, path: string, body?: object) => fetch(base + path, { method, headers: { authorization: `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  await api('POST', '/api/onboard', { address: 'Umer' });
  assert.equal((await api('POST', '/api/recruit', { template: 'scout', name: 'Scout' })).id, 'scout');
  // Enough earlier lines that the thread scrolls at 1440 too, so reading up mid-turn has somewhere to go.
  for (let i = 1; i <= 24; i++) crew.say('chief', 'bot', `Earlier note ${i} for Umer.`);

  const profile = mkdtempSync(join(tmpdir(), 'chat-live-browser-'));
  browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
  const portFile = join(profile, 'DevToolsActivePort');
  // In CI the gateway lane's boots run beside this browser and starve its start past 30 s (CI 2026-10-09).
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), 60_000);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let target: { webSocketDebuggerUrl: string } | undefined;
  await until('a page', async () => (target = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).find((t) => t.type === 'page')), 10_000);
  ws = new WebSocket(target!.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws!.once('open', r); ws!.once('error', j); });
  let id = 0;
  const waiting = new Map<number, (m: any) => void>();
  ws.on('message', (d) => { const m = JSON.parse(String(d)); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  const send = (method: string, params: object = {}) => new Promise<any>((r, j) => {
    const n = ++id; waiting.set(n, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result))); ws!.send(JSON.stringify({ id: n, method, params }));
  });
  const run = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  // What the person sees of the thread: its visible words, live line included.
  const SCREEN = `[...document.querySelectorAll('.chat .lines')].filter((e) => e.offsetParent).map((e) => e.innerText).join('|')`;
  const screen = () => run(SCREEN);
  const BOX = `[...document.querySelectorAll('.chat .lines')].find((e) => e.offsetParent)`;
  /** Whether the person's newest words and Chief's live line are in sight inside the thread's own scrolling box. */
  const inSight = (words: string) => run(`(() => { const b = ${BOX}, o = b.getBoundingClientRect();
    const seen = (e) => { const r = e?.getBoundingClientRect(); return !!r && r.height > 0 && r.bottom > o.top + 2 && r.top < o.bottom - 2; };
    return { echo: seen([...b.querySelectorAll('.line.me')].filter((e) => e.innerText.includes(${JSON.stringify(words.slice(0, 30))})).at(-1)),
      live: seen(b.querySelector('.live-line, .live-end')) }; })()`);

  /** Send the words from the box and watch the thread while the model holds its turn; then let it answer. */
  const journey = async (width: number, bot: string, words: string, expect: RegExp) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
    await send('Page.navigate', { url: `${base}/?day#person=${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}` });
    await until('Home', () => run("!!document.querySelector('.stack-home')"), 30_000);
    await run('location.hash = "#/chief"');
    await until('Chief\'s box', () => run("!!document.querySelector('.chat .dock textarea')"), 30_000);
    await until('Add your phone in the thread', () => run("!!document.querySelector('.chat .lines [aria-label=\"Add your phone\"] .qr svg')"), 15_000);
    await run("document.querySelector('.chat .dock textarea').focus()");
    await send('Input.insertText', { text: words });
    // Stamp the mutation before innerText forces layout: the read's variable cost is measurement work,
    // not time before the words changed. Still count only changed, visible words, from the key press on.
    await run(`{ window.__watch?.disconnect(); window.__seen = []; window.__sent = undefined; let was = ${SCREEN};
      (window.__watch = new MutationObserver(() => { const at = performance.now(); const now = ${SCREEN}; if (now !== was) { was = now; __seen.push(at); } }))
        .observe(document.querySelector('.chat'), { subtree: true, childList: true, characterData: true });
      document.querySelector('.chat .dock textarea').addEventListener('keydown', () => { window.__sent ??= performance.now(); }, { capture: true }); true }`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    if (bot === 'scout') {
      // The stub no longer routes. Finish Chief's turn, then stage the helper's job explicitly.
      await holding(crew, 'chief');
      const chiefTask = crew.sessionOf('chief')!.task;
      await release(crew, 'chief', 'Scout is on it.');
      await settled(db, chiefTask);
      delegated(crew, 'scout', words + ' [tool crew_report {"text":"Looked up the tower"}] [tool bash {"command":"echo tower"}]');
    }
    await holding(crew, bot);
    // A send is never silent on screen: the thread holds its newest line, so nothing may sit below the live line
    // (Add your phone at the thread's foot once filled a phone screen after every send; ch-chat-silent-gap).
    await until('the words and the live line in sight', async () => { const s = await inSight(words); return s.echo && s.live; }, 10_000);
    await until(`${HELD_MS} ms of the held turn watched`, async () => (await run('performance.now() - __sent')) >= HELD_MS, 30_000);
    const { seen, from, to } = await run('({ seen: __seen, from: __sent, to: performance.now() })');
    let gap = 0, prev = from;
    for (const t of [...seen, to]) { gap = Math.max(gap, t - prev); prev = t; }
    gap = Math.round(gap);
    console.log(`${width} ${bot}: longest still screen ${gap} ms (${seen.length} changes)`);
    assert.ok(gap <= GAP_MS + JITTER_MS, `${width}: the thread sat still for ${gap} ms while ${bot} worked`);
    assert.match(await screen(), expect, `${width}: the live line says who is on it`);
    // The engine's own started and thinking events reach the line, not a local guess: the admission row (from the
    // kit's `started`) and the thinking row (from its `thinking`) both show while the turn is held (ch-chat-live-2).
    assert.match(await screen(), /Thinking/, `${width}: the live line shows the engine's own thinking step`);
    // The to-do list names its object and never repeats a bare label; the small steps stay behind the expand.
    assert.doesNotMatch(await screen(), /Working on it|Worked in its own space/, `${width}: no bare repeated label on screen`);
    if (bot === 'scout') {
      assert.match(await screen(), /Looked up the tower/, `${width}: the model's own progress note is the doing line`);
      assert.match(await screen(), /Show the small steps \(1\)/, `${width}: the small steps hide behind the expand`);
    }
    if (bot === 'chief') {
      // The engine can stay silent for tens of seconds while the model writes a big file: after 4 s with no
      // event the live card says so beside its one clock ("Chief · 27 s · still working"), and the next
      // event clears it. Read only while in sight: inside the thread's scrolling box, not under the composer.
      const head = () => run(`(() => { const q = [...document.querySelectorAll('.chat .lines .live-head')].find((e) => e.offsetParent);
        if (!q) return ''; const r = q.getBoundingClientRect(), b = q.closest('.lines').getBoundingClientRect();
        return r.top >= b.top - 1 && r.bottom <= b.bottom + 1 ? q.innerText.replace(/\\s+/g, ' ').trim() : 'out of sight'; })()`);
      const job = db.get("SELECT id FROM tasks WHERE bot = 'chief' ORDER BY id DESC")!.id;
      let shown = 0;
      await until('still working on the live line', async () => /still working$/.test(await head()) && (shown = Date.now()), 15_000);
      const lastAt = db.get("SELECT max(at) AS at FROM events WHERE json_extract(data, '$.task') = ?", job)!.at;
      assert.ok(shown - lastAt >= 4000, `${width}: it waits 4 s of silence (it showed after ${shown - lastAt} ms)`);
      const said = await head();
      assert.match(said, /^Chief( · step \d+ of \d+)? · \d+ s · still working$/, `${width}: one line, one clock`);
      assert.equal(await run("[...document.querySelectorAll('.chat .lines .live-line')].find((e) => e.offsetParent).innerText.match(/\\d+ s\\b/g).length"), 1, `${width}: no second clock under it`);
      db.event('run.tool', 'chief', { task: job, words: 'Wrote the week plan' });
      await until('the next event to clear it', async () => /^Chief( · step \d+ of \d+)? · \d+ s$/.test(await head()), 3_000);
    }
    // Reading up mid-turn keeps the place: the reply lands below without moving the thread, a New pill says so,
    // and its tap goes back to the newest line (chat quality map gap 3).
    const place = () => run(`(() => { const b = ${BOX}, p = b.querySelector('.new-pill'), r = p?.getBoundingClientRect(), o = b.getBoundingClientRect();
      return { st: Math.round(b.scrollTop), max: b.scrollHeight - b.clientHeight, pill: !!r && r.top >= o.top && r.bottom <= o.bottom + 1 }; })()`);
    const up = bot === 'scout';
    if (up) {
      await run(`${BOX}.scrollTop = 0`);
      await until('the thread read up', async () => (await place()).st === 0, 3_000);
      assert.ok((await place()).max > 0, `${width}: the thread is long enough to read up`);
    }
    await release(crew, bot, `All set for Umer from ${bot}.`);
    if (up) {
      await until('the New pill over the newest line', async () => (await place()).pill, 15_000);
      assert.equal((await place()).st, 0, `${width}: the reply landed without moving the place being read`);
      await run(`${BOX}.querySelector('.new-pill').click()`);
      await until('the tap at the newest line', async () => { const p = await place(); return p.st >= p.max - 1 && !p.pill; }, 3_000);
    }
    // A job passed to a helper ends as its hand-off chip in Chief's thread; the live-end row is not said twice (chip gap 13).
    const end = bot === 'scout'
      ? "[...document.querySelectorAll('.hand')].at(-1)?.textContent ?? ''"
      : "document.querySelector('.live-end')?.innerText ?? ''";
    await until('the reply and the end line', async () => /All set for Umer/.test(await screen()) && /done/i.test(await run(end)) && (bot !== 'scout' || !(await run("!!document.querySelector('.live-end')"))), 15_000);
  };
  for (const width of [1440, 390]) {
    await journey(width, 'chief', 'Please ask permission before you plan my week', /At work[\s\S]*Chief ·[\s\S]*Started on/);
    // On a phone there is no side column: the job passed to Scout is followed in Chief's thread itself. Scout's own
    // progress note is the doing line; its small steps stay behind the expand.
    await journey(width, 'scout', 'Ask Scout to ask permission first, then look up the tower', /At work[\s\S]*Scout ·[\s\S]*Passed to Scout/);
    // A turn that ends at once with a reply the thread does not show (the stub's own) keeps its end line, so the
    // send still says it finished; a quick Chief reply in the thread lets "Done · 0 s" go.
    const quick = `What did you finish at ${width}?`;
    await run("document.querySelector('.chat .dock textarea').focus()");
    await send('Input.insertText', { text: quick });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    // Chief's session still says "ask permission", so the stub holds this turn too: let it go at once, with the stub's own reply.
    await release(crew, 'chief');
    await until(`${width}: the quick turn's end line in sight`, async () => { const s = await inSight(quick); return s.echo && s.live && /Done/.test(await run("document.querySelector('.live-end')?.innerText ?? ''")); }, 15_000);
  }
});
