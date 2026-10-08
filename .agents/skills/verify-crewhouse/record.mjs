// Record a task-owned Chrome launched by chrome-devtools-axi with --remote-debugging-port.
// node .agents/skills/verify-crewhouse/record.mjs <cdp-url> <page-url-prefix> <output.webm>
import { WebSocket } from 'ws';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [cdp, page, output] = process.argv.slice(2);
if (!cdp || !page || !output) throw new Error('Need CDP URL, owned page URL prefix and output path');
const target = (await (await fetch(`${cdp}/json/list`)).json()).find((t) => t.type === 'page' && t.url.startsWith(page));
if (!target) throw new Error('No owned page matches');
const dir = mkdtempSync(join(dirname(resolve(output)), 'motion-frames-'));
const socket = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const waiting = new Map(), frames = [];
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; waiting.set(n, { resolve, reject }); socket.send(JSON.stringify({ id: n, method, params }));
});
socket.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && waiting.has(m.id)) {
    const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result);
  }
  if (m.method !== 'Page.screencastFrame') return;
  const file = join(dir, `${frames.length}.jpg`);
  writeFileSync(file, Buffer.from(m.params.data, 'base64'));
  frames.push({ file, at: m.params.metadata.timestamp });
  socket.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
});
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
try {
  await call('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1440, maxHeight: 900 });
  console.log('RECORDING: interact now; capture ends on SIGTERM (30-second safety bound).');
  await new Promise((resolve) => { const timer = setTimeout(resolve, 30_000); process.once('SIGTERM', () => { clearTimeout(timer); resolve(); }); });
  await call('Page.stopScreencast');
  if (frames.length < 2) throw new Error(`Only ${frames.length} frame: no interaction proved`);
  const list = join(dir, 'frames.txt');
  writeFileSync(list, frames.map((f, i) => `file '${f.file.replaceAll("'", "'\\''")}'\nduration ${i + 1 < frames.length ? Math.max(0.02, frames[i + 1].at - f.at) : 0.2}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`);
  const ff = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', output], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(ff.stderr);
  console.log(JSON.stringify({ output, frames: frames.length, span: frames.at(-1).at - frames[0].at }));
} finally { socket.close(); rmSync(dir, { recursive: true, force: true }); }
