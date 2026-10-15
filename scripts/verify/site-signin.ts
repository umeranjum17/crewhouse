// A helper's site sign-in, end to end on a live crewd, in a private headless browser (own profile, own CDP port).
//   SITE_URL=http://shop.localhost:<port> node scripts/verify/site-signin.ts "$PWD" "$B" "$LAB/state" "$EV" [bot] [day-1440,…]
// One pass per fresh lab (run.sh): a lab's earlier answered lines would sit in the next pass's shots. The report appends.
// Recipe and what to read: ../features/site-signin.md. SCRATCH (default: the OS temp dir) holds the browser profile.
// Per theme and width: the card in Chief's thread, the large screen, the signed-in page with Done, the answered line.
// One recording of the whole flow (day, 1440). On the stub engine the helper's browser tool is headless, so the
// shop's page reaches the helper's own screen through its display (xtype.py), standing in for its `browser goto`.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const [repo, base, stateDir, out, bot = 'penny', tags = 'day-1440,night-1440,day-390,night-390'] = process.argv.slice(2);
const site = process.env.SITE_URL!, host = new URL(site).hostname;
const { taskBrowser } = await import(join(repo, 'test/browser.ts'));
const { browserBin } = await import(join(repo, 'src/desktop.ts'));
const { default: WebSocket } = await import(join(repo, 'node_modules/ws/index.js'));
const key = readFileSync(join(stateDir, 'person.key'), 'utf8').trim();
const H = { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${key}` };
const api = async (method: string, path: string, body?: object) => (await fetch(`${base}${path}`, { method, headers: H, body: body && JSON.stringify(body), signal: AbortSignal.timeout(60_000) })).json();
mkdirSync(join(out, 'screens'), { recursive: true }); mkdirSync(join(out, 'motion'), { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The helper's own display, found from crewd's Xvfb by its cookie file: never the owner's screen. */
function display(xauth: string) {
  for (const pid of readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    let cmd: string[]; try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0'); } catch { continue; }
    if (!/Xvfb$/.test(cmd[0] ?? '') || cmd[cmd.indexOf('-auth') + 1] !== xauth) continue;
    const inodes = new Set(readdirSync(`/proc/${pid}/fd`).map((f) => { try { return /socket:\[(\d+)\]/.exec(readlinkSync(`/proc/${pid}/fd/${f}`))?.[1]; } catch { return undefined; } }));
    for (const l of readFileSync('/proc/net/unix', 'utf8').split('\n')) { const p = l.trim().split(/\s+/); const m = /X11-unix\/X(\d+)$/.exec(p[7] ?? ''); if (m && inodes.has(p[6])) return `:${m[1]}`; }
  }
  throw new Error(`no display for ${bot}`);
}
const xauth = join(stateDir, 'desktops', `${bot}.xauth`);
const xtype = (...keys: string[]) => execFileSync('python3', ['-I', join(import.meta.dirname, 'xtype.py'), ...keys],
  { env: { PATH: '/usr/bin:/bin', DISPLAY: display(xauth), XAUTHORITY: xauth } }).toString();

const profile = mkdtempSync(join(process.env.SCRATCH ?? tmpdir(), 'cap-'));
const browser = taskBrowser(browserBin()!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required', 'about:blank'], profile);
const portFile = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 1200 && !(existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n')); i++) await sleep(100);
if (!existsSync(portFile)) throw new Error(`the capture browser did not start (exit ${browser.chrome.exitCode}, signal ${browser.chrome.signalCode})`);
const port = readFileSync(portFile, 'utf8').split('\n')[0];
const page = ((await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(30_000) })).json()) as any[]).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); setTimeout(() => j(new Error('no DevTools socket')), 30_000); });
let id = 0;
const waiting = new Map<number, (m: any) => void>();
const frames: { t: number; jpeg: Buffer }[] = [];
ws.on('message', (d: Buffer) => {
  const m = JSON.parse(String(d));
  if (m.method === 'Page.screencastFrame') { frames.push({ t: m.params.metadata.timestamp, jpeg: Buffer.from(m.params.data, 'base64') }); send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {}); }
  waiting.get(m.id)?.(m); waiting.delete(m.id);
});
const send = (method: string, params: object = {}) => new Promise<any>((r, j) => {
  const n = ++id, late = setTimeout(() => j(new Error(`${method}: no answer`)), 60_000);
  waiting.set(n, (m) => { clearTimeout(late); if (m.error) j(new Error(`${method}: ${m.error.message}`)); else r(m.result); }); ws.send(JSON.stringify({ id: n, method, params }));
});
const run = async (expression: string) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const until = async (what: string, test: () => Promise<unknown>, ms = 120_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await test().catch(() => false)) return;
  await shot('failed').catch(() => {});
  throw new Error(`timed out waiting for ${what} at ${await run('location.href + " " + document.body.innerText.slice(0, 300)').catch(() => '?')}`);
};
const seen = (expr: string) => () => run(expr);
const shot = async (name: string, tries = 5): Promise<string> => { // a loaded host sometimes has no frame ready yet
  const f = join(out, 'screens', `${name}.png`);
  try { writeFileSync(f, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); return f; } catch (e) { if (!tries) throw e; await sleep(1000); return shot(name, tries - 1); }
};
const SIZES = { 1440: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, 390: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } };
const go = async (theme: string, hash: string) => { await send('Page.navigate', { url: 'about:blank' }); await send('Page.navigate', { url: `${base}/?${theme}${hash}` }); };
const click = async (x: number, y: number) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
};
const tapOn = async (sel: string) => { const r = await run(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`); await click(r[0], r[1]); };
const KEYS: Record<string, [string, number]> = { Tab: ['Tab', 9], Enter: ['Enter', 13] };
const press = async (k: string) => { const [code, vk] = KEYS[k]; for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, ...(k === 'Enter' && type === 'rawKeyDown' ? { text: '\r' } : {}) }); await sleep(120); };
const type = async (text: string) => { for (const ch of text) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); await sleep(40); } };
/** The page point over one of the helper's own pixels (1280×800), through the picture as it is laid out now, fitted or zoomed. */
const pagePoint = async (x: number, y: number) => {
  const r = await run(`(() => { const b = document.querySelector('.signin-stage video').getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()`);
  return [r[0] + (x + 0.5) * r[2] / 1280, r[1] + (y + 0.5) * r[3] / 800];
};
const onScreen = async (x: number, y: number) => { const [px, py] = await pagePoint(x, y); await click(px, py); };
/** A phone's finger: one tap on the helper's pixel, wherever the zoomed picture has put it. */
const touch = async (type: string, points: number[][]) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i })) });
const tapScreen = async (x: number, y: number) => { const [px, py] = await pagePoint(x, y); await touch('touchStart', [[px, py]]); await sleep(60); await touch('touchEnd', []); await sleep(400); };
/** Two fingers spreading around one of the helper's pixels, as a phone's pinch. */
const pinch = async (x: number, y: number, from: number, to: number) => {
  const [cx, cy] = await pagePoint(x, y), at = (s: number) => [[cx - s / 2, cy], [cx + s / 2, cy]];
  await touch('touchStart', at(from).slice(0, 1)); await touch('touchStart', at(from));
  for (let k = 1; k <= 12; k++) { await touch('touchMove', at(from + (to - from) * k / 12)); await sleep(80); }
  await touch('touchEnd', at(to).slice(0, 1)); await touch('touchEnd', []); await sleep(600);
};
/** One finger dragging the zoomed picture by (dx, dy) page pixels. */
const pan = async (dx: number, dy: number) => {
  const [x, y] = [195, 500];
  await touch('touchStart', [[x, y]]);
  for (let k = 1; k <= 10; k++) { await touch('touchMove', [[x + dx * k / 10, y + dy * k / 10]]); await sleep(60); }
  await touch('touchEnd', []); await sleep(400);
};
/** Where the shop's form fields sit on the page now, and whether a person sees them whole. */
const fields = async () => {
  const rect = async (x0: number, y0: number, x1: number, y1: number) => { const [a, b] = await pagePoint(x0, y0), [c, d] = await pagePoint(x1, y1); return [a, b, c - a, d - b].map(Math.round); };
  const email = await rect(431, 350, 850, 393), vw = await run('innerWidth'), stage = await run(`(() => { const b = document.querySelector('.signin-stage').getBoundingClientRect(); return [b.top, b.bottom]; })()`);
  return { email, fieldHeightCss: email[3], inView: email[0] >= 0 && email[0] + email[2] <= vw && email[1] >= stage[0] && email[1] + email[3] <= stage[1] };
};
const record = { on: false, start: async () => { frames.length = 0; record.on = true; await send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1440, everyNthFrame: 1 }); },
  stop: async (file: string) => {
    await send('Page.stopScreencast'); record.on = false;
    const dir = mkdtempSync(join(process.env.SCRATCH ?? tmpdir(), 'frames-'));
    const list = frames.map((f, i) => { writeFileSync(join(dir, `${i}.jpg`), f.jpeg); return `file '${i}.jpg'\nduration ${((frames[i + 1]?.t ?? f.t + 0.5) - f.t).toFixed(4)}`; }).join('\n');
    writeFileSync(join(dir, 'frames.txt'), `${list}\nfile '${frames.length - 1}.jpg'\n`);
    const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-pix_fmt', 'yuv420p', file], { encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
    if (ff.status !== 0) throw new Error(ff.stderr);
    return { recording: file, frames: frames.length, span: frames.length ? +(frames.at(-1)!.t - frames[0].t).toFixed(2) : 0 };
  } };
const openAsk = async () => ((await api('GET', '/api/state')).asks as any[]).find((a) => a.kind === 'signin' && a.detail.bot === bot);

await send('Page.enable');
for (let i = 0; ; i++) { // a loaded host can drop the first load: navigate again
  await send('Page.navigate', { url: `${base}/#person=${key}` }).catch(() => {});
  try { await until('the app', seen("location.hash === '#/'"), 40_000); break; } catch (e) { if (i === 3) throw e; }
}
const reportFile = join(out, 'site-signin-report.json'), report: any[] = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : [];
const name = (await api('GET', `/api/bots/${bot}`)).bot.display;
for (const tag of tags.split(',')) {
  const [theme, w] = tag.split('-') as ['day' | 'night', '1440' | '390'], clip = tag === 'day-1440';
  console.error(`pass ${tag}`);
  await send('Emulation.setDeviceMetricsOverride', SIZES[w]);
  // 1. The helper's job: its browser opens the shop (signed out), then crew_signin asks.
  await go(theme, `#/h/${bot}/screen`);
  await until('the screen tab', seen("!!document.querySelector('.card.screen')"));
  await run("[...document.querySelectorAll('.card.screen .btn')].find((b) => /^Watch /.test(b.textContent))?.click(), true");
  await until('the desktop', async () => existsSync(xauth) && !!display(xauth), 60_000);
  await sleep(1500);
  xtype('key:ctrl+l', `text:${site}/logout`, 'key:Return');
  await sleep(1500);
  // Asked of Chief, as a person would; the app shows the words without the stub's tool line.
  await api('POST', '/api/bots/chief/messages', { text: `${name}, check my Corner Shop orders [tool crew_signin {"site":"${site}/login"}]` });
  await until('the sign-in ask', openAsk);
  const ask = await openAsk();
  // 2. The card, in Chief's thread.
  await go(theme, '#/');
  await until('the card', seen("!!document.querySelector('.signin-card') && document.readyState === 'complete'"));
  await run("document.querySelector('.signin-card').scrollIntoView({ block: 'center' }), true");
  await until('the site icon', seen("!!document.querySelector('.signin-card .site-ic img')?.complete"), 5000).catch(() => {});
  await sleep(500);
  const card = await run(`(() => { const c = document.querySelector('.signin-card'), b = c.getBoundingClientRect(); return { text: c.innerText, icon: !!c.querySelector('.site-ic img')?.naturalWidth,
    button: c.querySelector('.btn.go').textContent, inChief: location.hash === '#/', copies: [...document.querySelectorAll('.signin-card')].filter((e) => e.getBoundingClientRect().width > 0).length, box: [b.x, b.y, b.width, b.height].map(Math.round), sideways: document.documentElement.scrollWidth - innerWidth }; })()`);
  report.push({ tag, step: 'card', ...card, file: await shot(`card-${tag}`) });
  if (clip) await record.start();
  // 3. One tap: the helper's screen, large and already driving.
  await tapOn('.signin-card .btn.go');
  await until('the large screen, live', seen("(document.querySelector('.signin-stage video')?.videoWidth ?? 0) > 0 && !document.querySelector('.signin-bar .btn.go').disabled"), 60_000);
  await sleep(2000);
  const big = await run(`(() => { const f = document.querySelector('.signin-full').getBoundingClientRect(), v = document.querySelector('.signin-stage video').getBoundingClientRect();
    return { head: document.querySelector('.signin-bar b').textContent, line: document.querySelector('.signin-bar .small').innerText, done: document.querySelector('.signin-bar .btn.go').textContent,
      full: [f.width, f.height].map(Math.round), picture: [v.width, v.height].map(Math.round), vw: innerWidth, vh: innerHeight }; })()`);
  report.push({ tag, step: 'large', ...big, controls: (await api('GET', '/api/state')).bots.find((b: any) => b.id === bot)?.controls, file: await shot(`large-${tag}`) });
  // 4. The person signs in on the helper's screen, through the picture: the header first, then the form by keys.
  if (w === '390') {
    // On a phone the whole desktop is a strip: pinch on the form until it fills the width, nudge it with one finger,
    // then tap each field where the zoomed picture put it and type, as a person would. One clip per theme at 390.
    const fitted = await fields();
    if (theme === 'day') { await record.start(); await sleep(1500); } // the clip opens on the whole desktop, before the pinch
    await pinch(640, 420, 60, 165);
    await pan(0, -40);
    const zoomed = await fields();
    // The phone's keyboard rises when desklink's hidden textarea has focus: a pinch or a pan must leave it down, a tap raises it.
    const keyboardUp = () => run("document.activeElement?.getAttribute('aria-label') === 'Remote keyboard'");
    report.push({ tag, step: 'zoomed', fitted, zoomed, keyboardAfterPinch: await keyboardUp(), file: await shot(`zoomed-${tag}`) });
    await tapScreen(640, 371);
    report.push({ tag, step: 'tapped', keyboardAfterTap: await keyboardUp() });
    await type('umer@example.com');
    await tapScreen(640, 457); await type('not-a-real-password');
    await sleep(800);
    report.push({ tag, step: 'typed', file: await shot(`typed-${tag}`) });
    await press('Enter');
  } else {
    await onScreen(640, 125);
    await press('Tab'); await type('umer@example.com'); await press('Tab'); await type('not-a-real-password'); await press('Enter');
  }
  await sleep(3000);
  report.push({ tag, step: 'signed-in', file: await shot(`done-${tag}`) });
  // 5. Done: the wheel goes back and the card becomes one answered line.
  await tapOn('.signin-bar .btn.go');
  await until('the answered line', seen("!document.querySelector('.signin-full') && [...document.querySelectorAll('.card.answered')].some((l) => /^Signed in to /.test(l.innerText.trim()))"));
  await sleep(800);
  const st = await api('GET', '/api/state');
  const answered = await run(`(() => { const l = [...document.querySelectorAll('.card.answered')].filter((x) => /^Signed in to /.test(x.innerText.trim())).at(-1); l.scrollIntoView({ block: 'center' }); return { line: l.innerText.trim(), card: !!document.querySelector('.signin-card') }; })()`);
  await sleep(400);
  report.push({ tag, step: 'answered', ...answered, ask: ask.id, open: st.asks.filter((a: any) => a.kind === 'signin').length, controls: st.bots.find((b: any) => b.id === bot)?.controls,
    signedIn: (await api('GET', `/api/bots/${bot}`)).signedIn, file: await shot(`answered-${tag}`) });
  if (clip || tag === 'day-390') { await sleep(1500); report.push({ tag, step: 'clip', ...await record.stop(join(out, 'motion', `site-signin-${tag}.webm`)) }); }
  await until('the helper carried on', async () => !(await api('GET', '/api/state')).bots.find((b: any) => b.id === bot)?.task);
  const after = await api('GET', '/api/state'); // the helper's chat badge and the crew's counts, once its job is done
  report.push({ tag, step: 'after', unread: after.bots.find((b: any) => b.id === bot)?.unread, waiting: after.asks.length, file: await shot(`after-${tag}`) });
}
writeFileSync(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.map(({ text: _t, ...r }) => r)));
ws.close();
await browser.close().catch(async (e: Error) => { // a loaded host can take longer than the close bound: wait for our own browser to go
  const left = () => [...String(e.message).matchAll(/"pid":(\d+)/g)].map((m) => m[1]).filter((p) => existsSync(`/proc/${p}`));
  for (let i = 0; i < 600 && left().length; i++) await sleep(100);
  if (left().length) throw e;
});
rmSync(profile, { recursive: true, force: true });
