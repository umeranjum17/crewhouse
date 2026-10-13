import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { until } from './lab.ts';

const repo = join(import.meta.dirname, '..');
const KEY = 'ab'.repeat(32);

async function answering(status: number, body: object) {
  const server = createServer((_req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

function install(withKey: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'launch-test-'));
  const opt = join(root, 'opt'), bin = join(root, 'bin'), state = join(root, 'state');
  mkdirSync(opt); mkdirSync(bin); mkdirSync(join(state, 'crewhouse'), { recursive: true });
  cpSync(join(repo, 'packaging', 'launch.mjs'), join(opt, 'launch.mjs'));
  symlinkSync(repo, join(opt, 'app'));
  writeFileSync(join(bin, 'xdg-open'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'xdg-open'), 0o755);
  if (withKey) writeFileSync(join(state, 'crewhouse', 'person.key'), KEY, { mode: 0o600 });
  return { root, opt, state, env: { PATH: bin, HOME: root, CREWHOUSE_CREW_DIR: join(root, 'Crewhouse'), XDG_STATE_HOME: state, CREWHOUSE_NO_SERVICE: '1' } };
}

function run(script: string, args: string[], env: Record<string, string>) {
  return new Promise<number>((resolve) => {
    execFile(process.execPath, [script, ...args], { env, timeout: 120_000 }, (err) => resolve(err ? Number(err.code) : 0));
  });
}

test('crewd’s own gate 403 counts as up, so the launcher starts nothing and opens nothing', async (t) => {
  const crewd = await answering(403, { error: 'Open Crewhouse from this computer’s app menu.', code: 'no-authority' });
  t.after(() => crewd.close());
  const fixture = install(true);
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const code = await run(join(fixture.opt, 'launch.mjs'), ['--no-open'], { ...fixture.env, CREWHOUSE_PORT: String(crewd.port) });
  assert.equal(code, 0);
});

test('a foreign 403 is not crewd: the launcher falls through to its trouble page, linked with the person key', async (t) => {
  const foreign = await answering(403, { error: 'forbidden elsewhere' });
  t.after(() => foreign.close());
  const fixture = install(true);
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const code = await run(join(fixture.opt, 'launch.mjs'), [], { ...fixture.env, CREWHOUSE_PORT: String(foreign.port) });
  assert.equal(code, 1);
  const page = join(fixture.state, 'crewhouse', 'trouble.html');
  assert.ok(readFileSync(page, 'utf8').includes(`href="http://127.0.0.1:${foreign.port}/#person=${KEY}"`));
  assert.equal(statSync(page).mode & 0o777, 0o600);
});

test('crewd answering with no person key in this state dir: the window opens the bare address, no crash', async (t) => {
  const crewd = await answering(403, { error: 'Open Crewhouse from this computer’s app menu.', code: 'no-authority' });
  t.after(() => crewd.close());
  const fixture = install(false);
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const opened = join(fixture.state, 'opened');
  writeFileSync(join(fixture.root, 'bin', 'xdg-open'), `#!/bin/sh\nprintf '%s' "$1" > ${opened}\n`);
  const code = await run(join(fixture.opt, 'launch.mjs'), [], { ...fixture.env, CREWHOUSE_PORT: String(crewd.port) });
  assert.equal(code, 0);
  await until('the window to open', () => existsSync(opened));
  assert.equal(readFileSync(opened, 'utf8'), `http://127.0.0.1:${crewd.port}`);
});
