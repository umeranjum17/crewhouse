// Hold the owned crewd event loop while a live installed PWA keeps displaying its cached working crew. Two task-local TCP
// clients prove that the same host stall stops the link listener accepting new connections; a fresh connection succeeds on resume.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import WebSocket from 'ws';

const [lab, queueFile, doneFile, failedFile] = process.argv.slice(2);
if (!lab || !queueFile || !doneFile || !failedFile) throw new Error('usage: hold-link-loop.mjs <lab> <queue-file> <done-file> <failed-file>');
const env = Object.fromEntries(readFileSync(join(lab, 'env'), 'utf8').trim().split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));
const log = readFileSync(join(lab, 'crewd.log'), 'utf8');
const inspector = log.match(/Debugger listening on ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)?.[0]?.replace('Debugger listening on ', '');
if (!inspector) throw new Error('the owned crewd did not start its loopback inspector');
const port = Number(env.LINK_PORT), duration = 85_000, ws = new WebSocket(inspector);
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
let id = 0;
const pending = new Map();
ws.on('message', (raw) => { const message = JSON.parse(String(raw)); if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result); } });
const block = new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression: `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${duration}); 'resumed'`, returnByValue: true } })); });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const connect = () => new Promise((resolve, reject) => { const socket = net.createConnection(port, '127.0.0.1'); socket.once('connect', () => resolve(socket)); socket.once('error', reject); });
const until = Date.now() + duration - 1000;
try {
  await delay(300);
  const clients = await Promise.all([connect(), connect()]);
  let queue = 0, seen = '';
  while (Date.now() < until) {
    seen = execFileSync('ss', ['-ltn', 'sport', '=', `:${port}`], { encoding: 'utf8' });
    const row = seen.split('\n').find((line) => line.startsWith('LISTEN') && line.includes(`:${port}`));
    queue = Number(row?.trim().split(/\s+/)[1] ?? 0);
    if (queue >= 2) break;
    await delay(250);
  }
  writeFileSync(queueFile, `link port ${port}\n${seen}`);
  if (queue < 2) throw new Error(`event-loop hold did not record two queued accepts (saw ${queue})`);
  const held = await block;
  if (held?.result?.value !== 'resumed') throw new Error('the owned event loop did not resume');
  const recovered = await connect();
  for (const socket of [...clients, recovered]) socket.destroy();
  writeFileSync(doneFile, 'event loop resumed; a new link TCP connection succeeded');
  console.log(`event-loop hold ${duration}ms; link accept queue ${queue}; a new link connection succeeded after resume`);
} catch (error) {
  writeFileSync(failedFile, String(error));
  await block.catch(() => {});
  process.exitCode = 1;
} finally { ws.close(); }
