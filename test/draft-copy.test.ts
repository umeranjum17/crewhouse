// "Copy and open" on a draft with a link, in the real web app on both ask surfaces (the card in the thread and the
// sheet that opens it): the yes copies the words the person sees — their edit when they made one — and opens the link.
// Driven in a real Chromium on the built app (web/src/parts.tsx useDraftEdit), so the copy and the open are what a
// person gets. Also checks exact terminal-argument approvals fit the sheet. Needs Chromium on PATH (skipped without one).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { taskBrowser } from './browser.ts';
import WebSocket from 'ws';
import { browserBin } from '../src/desktop.ts';
import { temp } from './tmp.ts';
import { until } from './lab.ts';
import { buildSync } from 'esbuild';
import { effectOf } from '../src/policy.ts';
import { card } from '../web/src/adapter.ts';

const repo = join(import.meta.dirname, '..');
const bin = browserBin();
const LINK = 'https://shop.example/orders/98765/refund';
const BODY = 'Hello, my return reached you on 16 May, inside your own 30-day window. The order page still shows no refund.\n\nPlease confirm when the refund goes back to my card. Regards,\nMaya';
const EDIT = 'Hello, my return reached you on 16 May. Where is the refund?';

const parent = temp('draft-web');
cpSync(join(repo, 'web'), join(parent, 'web'), { recursive: true, filter: (s) => !/[/\\]dist([/\\]|$)/.test(s) });
symlinkSync(join(repo, 'src'), join(parent, 'src'), 'dir');
const dist = join(parent, 'web', 'dist');
const built = spawnSync(process.execPath, [join(repo, 'scripts', 'build-web.mjs'), join(parent, 'web')], { encoding: 'utf8' });

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
  const profile = mkdtempSync(join(tmpdir(), 'draft-browser-'));
  const browser = taskBrowser(bin!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
  let ws: WebSocket;
  after(async () => { ws?.close(); server.close(); await browser.close(); });
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
  const run = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  // What the person would get: the words on their clipboard, and the page that opened.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const log = window.__done = { copied: [], opened: [] };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { log.copied.push(t); return Promise.resolve(); } } });
    const open = window.open.bind(window);
    window.open = (url, ...rest) => { log.opened.push(String(url)); return null; };
    void open;
  })()` });
  return { run, base, type: (text: string) => send('Input.insertText', { text }), send, open: async (query: string, path = '/') => { await send('Page.navigate', { url: `${base}${path}?${query}` }); } };
}

/** The yes on one surface, with the person's edit, exactly as they tap it. */
const pressYes = async (b: Awaited<ReturnType<typeof browse>>, edit: string, scope = '.home-chat .lines .card.ask') => {
  const in_ = (what: string) => `[...document.querySelectorAll('${scope} button, ${scope} a')].find((x) => x.textContent === ${JSON.stringify(what)})`;
  await until(`the draft's yes in ${scope}`, () => b.run(`!!${in_('Copy and open')}`), 30_000);
  if (edit) {
    await b.run(`${in_('Edit')}.click()`);
    await until('the person\'s own words box', () => b.run(`!!document.querySelector('${scope} textarea.draft-edit')`), 10_000);
    await b.run(`(() => { const t = document.querySelector('${scope} textarea.draft-edit'); t.focus(); t.select(); })()`);
    await b.type(edit);
  }
  await b.run(`${in_('Copy and open')}.click()`);
  return b.run('window.__done');
};

test('long terminal arguments remain whole and approval controls fit the sheet', { skip: !bin && 'no Chromium here' }, async () => {
  const args = ['pane', 'run', 'w1:p1', 'x'.repeat(231 - 'COMPLETE_TAIL_987'.length) + 'COMPLETE_TAIL_987'];
  const effect = effectOf('herdr', { args }, { bot: 'CTO', space: '/bot', secret: [], run: { herdr: { name: 'Herdr', free: [], spend: ['pane run'] } } });
  assert.equal(effect.kind, 'send');
  if (effect.kind !== 'send') throw new Error('expected a drive approval');
  const c = card({ id: 99, bot: 'cto', kind: 'permission', detail: { effect: effect.kind, words: effect.words, preview: effect.preview } }, { bots: [{ id: 'cto', display: 'CTO' }], tasks: [] });
  buildSync({
    stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import { AskSheet } from ${JSON.stringify(join(repo, 'web/src/parts.tsx'))};
      createRoot(document.getElementById('app')).render(<AskSheet c={${JSON.stringify(c)}} onClose={() => {}} />);`, resolveDir: repo, loader: 'tsx' },
    outfile: join(dist, 'approval.js'), bundle: true, format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  });
  const css = readdirSync(dist).find((f) => /^styles-.*\.css$/.test(f));
  writeFileSync(join(dist, 'approval.html'), `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"><div id="app"></div><script type="module" src="/approval.js"></script>`);
  const b = await browse();
  for (const theme of ['day', 'night']) for (const width of [320, 390, 1440]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await b.open('', '/approval.html');
    await until('the approval sheet', () => b.run("!!document.querySelector('.sheet.approve .ask-words')"), 30_000);
    await b.run(`document.documentElement.dataset.theme = '${theme}'`);
    await b.run('document.fonts.ready');
    for (const expanded of [false, true]) {
      if (expanded) await b.run("[...document.querySelectorAll('.sheet button')].find((b) => b.textContent === 'Read all').click()");
      const layout = await b.run(`(() => {
        const sheet = document.querySelector('.sheet'), heading = sheet.querySelector('.ask-words'), body = sheet.querySelector('.ev-body');
        const r = sheet.getBoundingClientRect();
        const controls = [...sheet.querySelectorAll('.approve-btns button')];
        return { heading: heading.textContent, body: body.textContent, width: sheet.clientWidth, scroll: sheet.scrollWidth,
          fits: [heading, body, ...controls].every((e) => { const b = e.getBoundingClientRect(); return b.left >= r.left && b.right <= r.right && e.scrollWidth <= e.clientWidth + 1; }),
          labels: controls.map((b) => b.textContent) };
      })()`);
      assert.equal(layout.heading, effect.words);
      assert.equal(layout.body, JSON.stringify(args));
      assert.deepEqual(layout.labels, ['Remind me tomorrow', 'Not now', 'Yes, go ahead']);
      assert.ok(layout.fits && layout.scroll <= layout.width + 1, `${theme} ${width}px expanded=${expanded}: ${JSON.stringify(layout)}`);
    }
  }
});

test('the app is built', () => {
  assert.equal(built.status, 0, built.stderr);
  assert.ok(readdirSync(dist).some((f) => f.endsWith('.js')));
});

test('a draft with a link: both ask surfaces read Copy and open, copy the words the person sees, and open the link', { skip: !bin && 'no Chromium here' }, async () => {
  const b = await browse();
  // The card in the thread, with the person's edit.
  await b.open('demo=chase&day');
  await until("Chief's box", () => b.run("!!document.querySelector('.home-chat .composer')"), 30_000);
  // Scout wrote the draft; Chief carries its decision in the opening chat.
  assert.deepEqual(await pressYes(b, EDIT), { copied: [EDIT], opened: [LINK] });
  // The sheet that opens the same draft, with no edit: the draft's own words.
  await b.open('demo=chase&day#/ask/17');
  await b.run('location.reload()');
  await until('the sheet', () => b.run("!!document.querySelector('.sheet.approve')"), 30_000);
  const said = await pressYes(b, '', '.sheet.approve');
  assert.deepEqual(said.copied, [BODY], 'the draft\'s own words, not the edit');
  assert.deepEqual(said.opened, [LINK]);
});
