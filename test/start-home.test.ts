// Exercise real startup, not a fabricated Config: missing masks must never reopen the installed crew.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { temp } from './tmp.ts';

const repo = join(import.meta.dirname, '..');

test('unmasked starts get private homes; owner paths and symlink aliases fail before startup', async (t) => {
  const root = temp('startup'), home = join(root, 'home');
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, TMPDIR: root, CREWHOUSE_PORT: '0', CREWHOUSE_LINK_PORT: '0' };
  for (const k of Object.keys(env)) if (/^(CREWHOUSE_(STATE_DIR|CREW_DIR|TOOLS_DIR|ENGINE_DIR|GOOGLE_CLIENT|RUN_HOME|RUN_MODE|ENGINE)$|XDG_)/.test(k)) delete env[k];
  // NODE_TEST_CONTEXT is deliberately absent too: a standalone lab, including one selecting stub after loadConfig, is safe.
  delete env.NODE_TEST_CONTEXT;
  const probe = (extra: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, ['--input-type=module', '-e',
    'import {loadConfig} from "./src/config.ts"; console.log(JSON.stringify(loadConfig()))'], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8', timeout: 30_000 });
  const configs = [{}, { CREWHOUSE_ENGINE: 'stub', CREWHOUSE_RUN_MODE: 'product' }, { NODE_TEST_CONTEXT: 'child-v8', CREWHOUSE_RUN_MODE: 'product' }, { CREWHOUSE_RUN_MODE: 'verify' }, { XDG_CONFIG_HOME: join(userInfo().homedir, '.config') }].map((extra) => {
    const r = probe(extra); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
  });
  assert.equal(new Set(configs.map(c => c.crewDir)).size, 5, 'each invocation has a fresh home');
  for (const c of configs) for (const field of ['stateDir', 'crewDir', 'toolsDir', 'engineDir', 'googleClient']) {
    assert.ok(c[field].startsWith(root + '/'), `${field} stays beneath the owned temporary root`);
    assert.notEqual(c[field], join(home, 'Crewhouse'));
  }
  const product = probe({ CREWHOUSE_RUN_MODE: 'product', XDG_CONFIG_HOME: join(root, 'product-config') });
  assert.equal(product.status, 0, product.stderr);
  assert.equal(JSON.parse(product.stdout).crewDir, join(home, 'Crewhouse'), 'product mode keeps its normal HOME');
  assert.equal(JSON.parse(product.stdout).googleClient, join(root, 'product-config/byokit/google-oauth-client.json'), 'product mode keeps its XDG config');
  const owner = userInfo().homedir;
  symlinkSync(join(owner, 'Crewhouse'), join(root, 'alias'));
  const missing = join(owner, 'Crewhouse', `__isolation_missing_${process.pid}`);
  assert.equal(existsSync(missing), false);
  symlinkSync(missing, join(root, 'missing-alias'));
  for (const extra of [
    { CREWHOUSE_CREW_DIR: join(owner, 'Crewhouse') },
    { CREWHOUSE_STATE_DIR: join(owner, '.local/state/crewhouse') },
    { CREWHOUSE_CREW_DIR: join(root, 'alias/bots') },
    { CREWHOUSE_CREW_DIR: join(root, 'missing-alias/bots') },
    { CREWHOUSE_TOOLS_DIR: join(owner, '.local/share/crewhouse/tools') },
    { CREWHOUSE_ENGINE_DIR: join(owner, '.local/share/crewhouse/engine'), CREWHOUSE_RUN_MODE: 'product', CREWHOUSE_ENGINE: 'stub' },
    { CREWHOUSE_GOOGLE_CLIENT: join(owner, '.config/byokit/google-oauth-client.json'), CREWHOUSE_RUN_MODE: 'product', NODE_TEST_CONTEXT: 'child-v8' },
    { CREWHOUSE_CREW_DIR: owner },
  ]) {
    const r = probe(extra);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /crewd: refusing isolated start.*owner/);
  }
  const child = spawn(process.execPath, ['src/main.ts'], { cwd: repo, env: { ...env, CREWHOUSE_ENGINE: 'stub', XDG_CONFIG_HOME: join(userInfo().homedir, '.config') } });
  let log = ''; child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; });
  for (const end = Date.now() + 60_000; !log.includes('crewd listening on'); await new Promise(r => setTimeout(r, 20))) {
    assert.equal(child.exitCode, null, log); assert.ok(Date.now() < end, log);
  }
  const url = /crewd listening on (http:\/\/[^ ]+)/.exec(log)![1];
  const state = /state: ([^)]+)/.exec(log)![1];
  assert.ok(state.startsWith(root + '/'), log);
  const r = await fetch(url + '/api/state', { headers: { 'x-crewhouse': '1', authorization: `Bearer ${readFileSync(join(state, 'person.key'), 'utf8')}` } });
  assert.equal(r.status, 200); assert.ok((await r.json()).person);
  assert.ok(!existsSync(join(home, 'Crewhouse')), 'startup never creates the inherited HOME crew');
  const unit = join(home, '.config/systemd/user/crewhouse.service');
  mkdirSync(join(unit, '..'), { recursive: true }); writeFileSync(unit, 'owner unit sentinel');
  const off = spawnSync(join(repo, 'crewhouse'), ['autostart', 'off'], { env: { ...env, CREWHOUSE_RUN_MODE: 'verify' }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(off.status, 0, off.stderr);
  assert.equal(readFileSync(unit, 'utf8'), 'owner unit sentinel', 'an isolated CLI never removes the login unit');
  const install = spawnSync(process.execPath, ['scripts/headless.mjs', 'setup'], { cwd: repo,
    env: { ...env, CREWHOUSE_RUN_MODE: 'verify', CREWHOUSE_RELAY_PUBLIC: 'http://127.0.0.1:7300' }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(install.status, 1, install.stdout);
  assert.match(install.stderr, /Lab\/test runs cannot install a login service/);
});

test('an isolated run removes the run home it created on exit or SIGTERM, never one it inherited', async () => {
  const scratch = temp('run-home');
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: scratch, CREWHOUSE_RUN_MODE: 'test' };
  delete env.CREWHOUSE_RUN_HOME; // the outer test runner exports its own run home; this run must create one
  const report = 'import {loadConfig} from "./src/config.ts"; loadConfig(); console.log(process.env.CREWHOUSE_RUN_HOME)';
  // The kit's engine is read-only on disk: a run home holding a locked tree must still be removed.
  const locked = 'import {chmodSync, mkdirSync} from "node:fs"; import {loadConfig} from "./src/config.ts"; loadConfig(); const sets = process.env.CREWHOUSE_RUN_HOME + "/engine/sets"; mkdirSync(sets, {recursive: true}); chmodSync(sets, 0o555); chmodSync(sets + "/..", 0o555); console.log(process.env.CREWHOUSE_RUN_HOME)';
  const exited = spawnSync(process.execPath, ['--input-type=module', '-e', locked], { cwd: repo, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(exited.status, 0, exited.stderr);
  const created = exited.stdout.trim();
  assert.ok(created.startsWith(scratch + '/crewhouse-run-'), created);
  assert.equal(existsSync(created), false, 'a normal exit removes the run home it created');
  assert.deepEqual(readdirSync(scratch), [], 'nothing from the run is left in the temporary directory');

  const child = spawn(process.execPath, ['--input-type=module', '-e', `${locked}; setInterval(() => {}, 1_000)`], { cwd: repo, env, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (b) => out += b);
  const ended = once(child, 'exit');
  for (const end = Date.now() + 30_000; !out.includes('\n'); await new Promise((r) => setTimeout(r, 20)) ) assert.ok(Date.now() < end, 'the probe never reported its run home');
  const running = out.trim();
  child.kill('SIGTERM');
  assert.deepEqual(await ended, [null, 'SIGTERM']);
  assert.equal(existsSync(running), false, 'SIGTERM removes the run home too');

  const inherited = join(scratch, 'inherited-home');
  mkdirSync(inherited);
  const kept = spawnSync(process.execPath, ['--input-type=module', '-e', report], { cwd: repo, env: { ...env, CREWHOUSE_RUN_HOME: inherited }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(kept.status, 0, kept.stderr);
  assert.equal(kept.stdout.trim(), inherited);
  assert.equal(existsSync(inherited), true, 'a run home set by someone else is never removed');

  // The launcher's config probe keeps the home it creates: crewd inherits it from the launcher.
  const handedOff = spawnSync(process.execPath, ['--input-type=module', '-e', report], { cwd: repo, env: { ...env, CREWHOUSE_KEEP_RUN_HOME: '1' }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(handedOff.status, 0, handedOff.stderr);
  assert.equal(existsSync(handedOff.stdout.trim()), true, 'the launcher probe hands its run home to crewd');
});
