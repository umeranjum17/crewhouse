// Record a task-owned Chrome launched by chrome-devtools-axi with --remote-debugging-port.
// node scripts/verify/record.mjs <cdp-url> <page-url-prefix> <output.webm>
import { WebSocket } from 'ws';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [cdp, page, output, seconds = '30'] = process.argv.slice(2);
if (!cdp || !page || !output) throw new Error('Need CDP URL, owned page URL prefix and output path');
if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0 || Number(seconds) > 120) throw new Error('Capture duration must be 0 < seconds <= 120');
const target = (await (await fetch(`${cdp}/json/list`, { signal: AbortSignal.timeout(5_000) })).json()).find((t) => t.type === 'page' && t.url.startsWith(page));
if (!target) throw new Error('No owned page matches');
const dir = mkdtempSync(join(dirname(resolve(output)), 'motion-frames-'));
const socket = new WebSocket(target.webSocketDebuggerUrl, { handshakeTimeout: 5_000 });
let id = 0;
const waiting = new Map(), frames = [];
const call = (method, params = {}) => new Promise((resolve, reject) => {
  if (socket.readyState !== WebSocket.OPEN) return reject(new Error(`${method}: CDP disconnected`));
  const n = ++id;
  const finish = (error, result) => { clearTimeout(timer); waiting.delete(n); error ? reject(error) : resolve(result); };
  const timer = setTimeout(() => finish(new Error(`${method}: CDP response timed out`)), 5_000);
  waiting.set(n, finish);
  socket.send(JSON.stringify({ id: n, method, params }), (error) => { if (error) finish(error); });
});
const disconnected = (error) => { for (const finish of waiting.values()) finish(error); };
socket.on('close', () => disconnected(new Error('CDP disconnected')));
socket.on('error', disconnected);
socket.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && waiting.has(m.id)) {
    waiting.get(m.id)(m.error ? new Error(m.error.message) : null, m.result);
  }
  if (m.method !== 'Page.screencastFrame') return;
  const file = join(dir, `${frames.length}.jpg`);
  writeFileSync(file, Buffer.from(m.params.data, 'base64'));
  frames.push({ file, at: m.params.metadata.timestamp });
  socket.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
});
try {
  await new Promise((resolve, reject) => {
    const finish = (error) => { clearTimeout(timer); socket.off('open', opened); socket.off('error', failed); socket.off('close', closed); error ? reject(error) : resolve(); };
    const opened = () => finish(), failed = (error) => finish(error), closed = () => finish(new Error('CDP disconnected before open'));
    const timer = setTimeout(() => finish(new Error('CDP open timed out')), 5_000);
    socket.once('open', opened); socket.once('error', failed); socket.once('close', closed);
  });
  await call('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1440, maxHeight: 900 });
  await new Promise((resolve, reject) => {
    const finish = (error) => { clearTimeout(timer); process.off('SIGTERM', stop); socket.off('close', closed); socket.off('error', failed); error ? reject(error) : resolve(); };
    const stop = () => finish(), closed = () => finish(new Error('CDP disconnected during capture')), failed = (error) => finish(error);
    const timer = setTimeout(stop, Number(seconds) * 1_000);
    process.once('SIGTERM', stop); socket.once('close', closed); socket.once('error', failed);
    if (socket.readyState !== WebSocket.OPEN) closed();
    else console.log(`RECORDING: interact now; capture ends on SIGTERM (${seconds}-second safety bound).`);
  });
  await call('Page.stopScreencast');
  if (frames.length < 2) throw new Error(`Only ${frames.length} frame: no interaction proved`);
  const list = join(dir, 'frames.txt');
  writeFileSync(list, frames.map((f, i) => `file '${f.file.replaceAll("'", "'\\''")}'\nduration ${i + 1 < frames.length ? Math.max(0.02, frames[i + 1].at - f.at) : 0.2}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`);
  const ff = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', output], { encoding: 'utf8', timeout: 120_000 });
  if (ff.status !== 0) throw new Error(ff.stderr);
  console.log(JSON.stringify({ output, frames: frames.length, span: frames.at(-1).at - frames[0].at }));
} finally { socket.terminate(); rmSync(dir, { recursive: true, force: true }); }
