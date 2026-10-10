// Captures of the sign-in card on a live crewd, in a private headless Chromium (own profile, own CDP port).
//   node .agents/skills/verify-crewhouse/scripts/signin-card.ts "$PWD" "http://127.0.0.1:$PORT" "$LAB/state/person.key" "$EV/screens" [slug]
// Recipe and what to read: ../features/signin-card.md. SCRATCH (default: the OS temp dir) holds the browser profile.
// Shots: card as shown and with "Use another account" opened, night/day, 1440 and 390. Plus one recording of the tap.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const [repo, base, keyFile, out, slug = 'signin-card'] = process.argv.slice(2);
const { taskBrowser } = await import(join(repo, 'test/browser.ts'));
const { browserBin } = await import(join(repo, 'src/desktop.ts'));
const { default: WebSocket } = await import(join(repo, 'node_modules/ws/index.js'));
const key = readFileSync(keyFile, 'utf8').trim();
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(process.env.SCRATCH ?? tmpdir(), 'cap-'));
const browser = taskBrowser(browserBin()!, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
const portFile = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 300 && !(existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n')); i++) await new Promise((r) => setTimeout(r, 100));
const port = readFileSync(portFile, 'utf8').split('\n')[0];
const page = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
let id = 0;
const waiting = new Map<number, (m: any) => void>();
const frames: { t: number; jpeg: Buffer }[] = [];
ws.on('message', (d: Buffer) => {
  const m = JSON.parse(String(d));
  if (m.method === 'Page.screencastFrame') { frames.push({ t: m.params.metadata.timestamp, jpeg: Buffer.from(m.params.data, 'base64') }); void send('Page.screencastFrameAck', { sessionId: m.params.sessionId }); }
  waiting.get(m.id)?.(m); waiting.delete(m.id);
});
const send = (method: string, params: object = {}) => new Promise<any>((r, j) => {
  const n = ++id; waiting.set(n, (m) => (m.error ? j(new Error(`${method}: ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: n, method, params }));
});
const run = async (expression: string) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const until = async (what: string, expr: string) => {
  for (let i = 0; i < 150; i++) { if (await run(expr).catch(() => false)) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`timed out waiting for ${what}`);
};
const shot = async (file: string) => writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const SIZES = { 1440: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, 390: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } };
const card = "document.querySelector('.card.ask .more-ways')";
const open = async (theme: string, w: 1440 | 390) => {
  await send('Emulation.setDeviceMetricsOverride', SIZES[w]);
  await send('Page.navigate', { url: 'about:blank' }); // a real load each time: the same URL twice is only a hash visit
  await send('Page.navigate', { url: `${base}/?${theme}#/` });
  await until('the card', `!!${card} && document.readyState === 'complete'`);
  await new Promise((r) => setTimeout(r, 400)); // fonts and images settle before the shot
};
const toBottom = "(document.querySelector('.chat .lines')?.scrollTo(0, 1e6), true)";
await send('Page.enable');
await send('Page.navigate', { url: `${base}/#person=${key}` });
await until('the app', "location.hash === '#/'");
const report: any[] = [];
for (const theme of ['night', 'day']) for (const w of [1440, 390] as const) {
  await open(theme, w);
  await run(toBottom);
  await shot(join(out, `${slug}-${theme}-${w}.png`));
  await run(`(${card}.querySelector('summary').click(), true)`);
  await until('opened', `${card}.open`);
  await run(toBottom);
  await new Promise((r) => setTimeout(r, 200));
  await shot(join(out, `${slug}-open-${theme}-${w}.png`));
  // Geometry: every sign-in button whole on screen, above the composer, none overlapping another, no sideways scroll.
  report.push({ theme, w, ...(await run(`(() => {
    const dock = document.querySelector('.chat .dock')?.getBoundingClientRect();
    const btns = [...document.querySelectorAll('.card.ask .btn')].filter((e) => /^Sign in/.test(e.textContent.trim()));
    const r = btns.map((e) => { const b = e.getBoundingClientRect(); return { text: e.textContent.trim(), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width) }; });
    return { buttons: r, primary: document.querySelector('.card.ask .btn.go')?.textContent.trim(), dockTop: dock && Math.round(dock.top), vh: innerHeight,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clippedOrUnder: r.filter((b) => b.top < 0 || b.bottom > innerHeight || (dock && b.bottom > dock.top)).map((b) => b.text),
      text: document.querySelector('.card.ask').innerText };
  })()`)) });
}
// One recording per width: the tap on "Use another account", night at 390 and day at 1440.
for (const [theme, w] of [['night', 390], ['day', 1440]] as const) {
  await open(theme, w);
  await run(toBottom);
  frames.length = 0;
  await send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1440, everyNthFrame: 1 });
  await new Promise((r) => setTimeout(r, 1200));
  await run(`(${card}.querySelector('summary').click(), true)`);
  await new Promise((r) => setTimeout(r, 300));
  await run(toBottom);
  await new Promise((r) => setTimeout(r, 1500));
  await send('Page.stopScreencast');
  const dir = mkdtempSync(join(process.env.SCRATCH ?? tmpdir(), 'frames-'));
  const list = frames.map((f, i) => { writeFileSync(join(dir, `${i}.jpg`), f.jpeg); return `file '${i}.jpg'\nduration ${((frames[i + 1]?.t ?? f.t + 0.5) - f.t).toFixed(4)}`; }).join('\n');
  writeFileSync(join(dir, 'frames.txt'), `${list}\nfile '${frames.length - 1}.jpg'\n`);
  const file = join(out, `${slug}-tap-${theme}-${w}.webm`);
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-pix_fmt', 'yuv420p', file], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  if (ff.status !== 0) throw new Error(ff.stderr);
  report.push({ recording: file, frames: frames.length, span: frames.length ? +(frames.at(-1)!.t - frames[0].t).toFixed(2) : 0 });
}
writeFileSync(join(out, `${slug}-geometry.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.map((r) => r.recording ? r : { theme: r.theme, w: r.w, primary: r.primary, n: r.buttons.length, clippedOrUnder: r.clippedOrUnder, sideways: r.sideways })));
ws.close();
await browser.close();
rmSync(profile, { recursive: true, force: true });
