// The Little nudge on the real product (A097): on Home a working helper's face moves inside its SVG and Reduce Motion
// stills every face. Runs its own headless Chromium (private profile, OS-assigned DevTools port) against a running
// crewd's app URL, at 390 wide, and writes the frames, a webm of the working face, and a JSON verdict.
//
//   node scripts/verify/face-motion.mjs <app-url-with-#person=key> <out-dir> [day|night]
//
// Exit 0 only when the working face's pixels change at least twice in 3 s, every face reads still under Reduce Motion
// and its pixels then hold for 1.5 s.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const [url, out, theme = 'day'] = process.argv.slice(2);
if (!url?.includes('#person=') || !out) throw new Error('usage: face-motion.mjs <app-url-with-#person=key> <out-dir> [day|night]');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'face-motion-'));
const chrome = spawn('/usr/bin/chromium', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not yet */ } }
  if (!port) throw new Error('Chromium never opened its DevTools port');
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let id = 0; const wait = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; const t = setTimeout(() => reject(new Error(`${method} timed out`)), 15_000);
    wait.set(n, (m) => { clearTimeout(t); m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result); }); ws.send(JSON.stringify({ id: n, method, params })); });
  const run = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  const until = async (what, fn, ms = 20_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(150); } throw new Error(`never: ${what}`); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  const [base, hash] = url.split('#');
  await send('Page.navigate', { url: `${base}?${theme}#${hash}` });
  // The app takes the key from the hash and then routes on it: go Home only once the key is taken.
  await until('the key taken', () => run(`!location.hash.startsWith('#person')`));
  await run(`location.hash = '#/'`);
  await until('Home with a working face', () => run(`!!document.querySelector('.stack-home .face[data-motion="work"] img')`));
  const clip = await run(`(async () => { await document.fonts.ready; const e = document.querySelector('.stack-home .face[data-motion="work"]'); e.scrollIntoView({ block: 'center' }); await new Promise(requestAnimationFrame); const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, scale: 3 }; })()`);
  const who = await run(`document.querySelector('.stack-home .face[data-motion="work"] img')?.alt ?? ''`);
  const shoot = async (tag, n, every) => { const shots = []; for (let i = 0; i < n; i++) { const { data } = await send('Page.captureScreenshot', { clip }); shots.push(data); writeFileSync(join(out, `${tag}-${String(i).padStart(2, '0')}.png`), Buffer.from(data, 'base64')); await sleep(every); } return shots; };
  const moving = await shoot('work', 30, 100);
  const motions = await run(`[...document.querySelectorAll('.stack-home .face')].map((e) => e.dataset.motion)`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await until('every face still', () => run(`[...document.querySelectorAll('.stack-home .face')].every((e) => e.dataset.motion === 'still')`), 5000);
  await run(`Promise.all([...document.querySelectorAll('.stack-home .face img')].map((i) => i.decode()))`);
  await sleep(300);
  const still = await shoot('reduced', 15, 100);
  const page2 = await send('Page.captureScreenshot', {});
  writeFileSync(join(out, `home-reduced-${theme}-390.png`), Buffer.from(page2.data, 'base64'));
  const distinct = (a) => new Set(a).size;
  const verdict = { who, theme, motions, workFrames: moving.length, workDistinct: distinct(moving), reducedFrames: still.length, reducedDistinct: distinct(still) };
  verdict.pass = verdict.workDistinct >= 3 && verdict.reducedDistinct === 1;
  const ff = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '10', '-i', join(out, 'work-%02d.png'), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', join(out, `face-work-${theme}.webm`)], { encoding: 'utf8' });
  verdict.webm = ff.status === 0 ? `face-work-${theme}.webm` : `ffmpeg failed: ${ff.stderr}`;
  writeFileSync(join(out, `face-motion-${theme}.json`), JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify(verdict));
  ws.close();
  if (!verdict.pass) process.exitCode = 1;
} finally { chrome.kill('SIGTERM'); await sleep(500); rmSync(profile, { recursive: true, force: true }); }
