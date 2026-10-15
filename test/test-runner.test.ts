// Run the ordinary producer against a private on-disk test project, not a mocked filesystem or child process.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { temp } from './tmp.ts';

test('test CLI owns only its fresh root and reserves the deepest socket, including maximum PID bytes', () => {
  const lab = temp('runner');
  const project = join(lab, 'project');
  const deep = join(lab, 'é'.repeat(80)); // UTF-8 bytes and a physically deep private TMPDIR
  mkdirSync(join(project, 'test'), { recursive: true });
  mkdirSync(deep);
  const stale = join(deep, 'cw-test-2147483647-unrelated');
  mkdirSync(stale);
  writeFileSync(join(stale, 'sentinel'), 'untouched');
  const allocator = pathToFileURL(resolve(import.meta.dirname, '../scripts/test-root.mjs')).href;
  writeFileSync(join(project, 'test', 'socket.test.ts'), `
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, connect } from 'node:net';
import { mkdirSync, readFileSync, lstatSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { testRoot } from ${JSON.stringify(allocator)};
const scratch = tmpdir(), root = dirname(scratch);
assert.equal(lstatSync(root).mode & 0o777, 0o700);
assert.equal(process.env.HOME, join(root, 'h'));
const digits = process.platform === 'linux' ? readFileSync('/proc/sys/kernel/pid_max', 'utf8').trim().length : 10;
const actualDigits = root.match(/c-(\\d+)-/)![1].length;
for (const suffix of ['/org.chromium.Chromium.XXXXXX/SingletonSocket', '/crewhouse-firstwords-XXXXXX/state/openclaw/bridge.sock']) {
  const socket = scratch + suffix;
  assert.ok(Buffer.byteLength(socket) + digits - actualDigits + 1 <= (process.platform === 'darwin' ? 104 : 108));
  mkdirSync(dirname(socket), { recursive: true });
  const server = createServer(s => s.end('bound'));
  server.listen(socket); await once(server, 'listening');
  const client = connect(socket); let reply = ''; client.on('data', d => reply += d); await once(client, 'close');
  assert.equal(reply, 'bound'); await new Promise<void>(r => server.close(() => r()));
  console.log('SOCKET_BOUND', Buffer.byteLength(socket) + 1);
}
// Native exclusive allocation never adopts an existing root, even one with the same process PID.
const a = testRoot(), b = testRoot(); assert.notEqual(a.root, b.root); b.cleanup();
renameSync(a.root, a.root + '-held'); mkdirSync(a.root, { mode: 0o700 });
writeFileSync(join(a.root, 'sentinel'), 'replacement');
assert.throws(a.cleanup, /Refusing to clean replaced test root/);
assert.equal(readFileSync(join(a.root, 'sentinel'), 'utf8'), 'replacement');
rmSync(a.root, { recursive: true }); rmSync(a.root + '-held', { recursive: true });
console.log('OWNED_ROOT', root);
`);
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: deep };
  delete env.NODE_TEST_CONTEXT; // this is a new CLI invocation, not the outer test runner's IPC child
  const out = spawnSync(process.execPath, [resolve(import.meta.dirname, '../scripts/test.mjs')], {
    cwd: project, env, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(out.error, undefined);
  assert.equal(readFileSync(join(stale, 'sentinel'), 'utf8'), 'untouched');
  assert.deepEqual(readdirSync(deep), ['cw-test-2147483647-unrelated']);
  assert.equal((out.stdout.match(/SOCKET_BOUND/g) || []).length, 2, out.stdout + out.stderr);
  const root = out.stdout.match(/OWNED_ROOT (.+)/)![1];
  assert.equal(existsSync(root), false, 'only this invocation’s root was removed after its child exited');
});
