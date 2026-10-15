import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocketServer } from 'ws';

const run = (command: string, args: string[], env = process.env) => {
  const child = spawn(command, args, { env, timeout: 12_000, killSignal: 'SIGKILL' });
  let stdout = '', stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const done = once(child, 'close').then(([code]) => ({ code, stdout, stderr }));
  return { child, done };
};

test('screen captures retry standalone failures under errexit', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-screens-'));
  writeFileSync(join(dir, 'chrome-devtools-axi'), `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PROBE/calls"
case "$1" in
  pages) printf 'id,url,selected\\n1,about:blank,true\\n';;
  emulate) if [ ! -e "$PROBE/retried" ]; then touch "$PROBE/retried"; echo 'transient CDP failure'; exit 42; fi;;
  screenshot) touch "$2";;
esac
`, { mode: 0o755 });
  const { child, done } = run('bash', ['scripts/verify/screens.sh', dir, 'probe', 'http://127.0.0.1:12345/'], {
    ...process.env, PATH: `${dir}:${process.env.PATH}`, PROBE: dir,
  });
  try {
    const result = await done;
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /exit 42, attempt 1/);
    assert.equal(readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter((s) => s === 'emulate').length, 5);
    assert.equal(readdirSync(dir).filter((s) => s.endsWith('.png')).length, 4);
  } finally { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});

test('recorder bounds silent peers and settles disconnected requests', { timeout: 45_000 }, async () => {
  for (const mode of ['discovery', 'upgrade', 'start', 'capture-close', 'stop-close', 'stop-silent', 'acknowledged']) {
    const dir = mkdtempSync(join(tmpdir(), 'verify-record-'));
    const server = createServer((req, res) => {
      if (mode === 'discovery') return;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ type: 'page', url: 'http://owned.test/', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/page` }]));
    });
    const sockets = new Set<import('node:net').Socket>();
    server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      if (mode !== 'upgrade') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
    });
    let stopSeen = false;
    wss.on('connection', (ws) => ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.method === 'Page.startScreencast') {
        if (mode === 'start') return;
        ws.send(JSON.stringify({ id: msg.id, result: {} }));
      }
      if (msg.method === 'Page.stopScreencast') {
        stopSeen = true;
        if (mode === 'stop-close') return ws.terminate();
        if (mode === 'stop-silent') return;
        ws.send(JSON.stringify({ id: msg.id, result: {} }));
      }
    }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as import('node:net').AddressInfo).port;
    const { child, done } = run(process.execPath, ['scripts/verify/record.mjs', `http://127.0.0.1:${port}`, 'http://owned.test/', join(dir, 'out.webm')]);
    child.stdout.on('data', (data) => {
      if (!String(data).includes('RECORDING:')) return;
      if (mode === 'capture-close') { for (const ws of wss.clients) ws.terminate(); }
      else child.kill('SIGTERM');
    });
    try {
      const result = await done;
      assert.notEqual(result.code, 0, mode);
      if (mode === 'acknowledged') {
        assert.ok(stopSeen);
        assert.match(result.stderr, /Only 0 frame/);
      } else if (mode === 'discovery') assert.match(result.stderr, /TimeoutError/);
      else if (mode === 'upgrade') assert.match(result.stderr, /timed out|timeout/i);
      else if (mode === 'start' || mode === 'stop-silent') assert.match(result.stderr, /CDP response timed out/);
      else assert.match(result.stderr, /CDP disconnected/);
      assert.deepEqual(readdirSync(dir), [], mode);
    } finally {
      child.kill('SIGKILL');
      for (const ws of wss.clients) ws.terminate();
      for (const socket of sockets) socket.destroy();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
