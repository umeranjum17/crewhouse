// The gateway-upgrade migration (spec §6), part 3: recovery —
// a locked keyring-only login offers recovery words and upgrades to dual
// wrap, and a refused start leaves the live gateway intact with a kit retry.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { KeystoreError, osKeyringSeal } from '@byokit/secrets';
import { Accounts } from '../src/accounts.ts';
import { host, house, legacyAuth, sealed } from './migrate-house.ts';

test('a locked keyring-only login gives recovery words, retries and upgrades to dual wrap', { timeout: 240_000 }, async () => {
  const { root, stateDir, legacy } = await house();
  const entries = new Map<string, string>();
  let locked = false;
  const keyring = {
    get(name: string) { if (locked) throw new KeystoreError('unavailable', 'Locked'); return entries.get(name) ?? null; },
    set(name: string, value: string) { entries.set(name, value); },
    delete(name: string) { return entries.delete(name); },
  };
  const service = 'test-keyring-upgrade';
  const old = new OpenClawRuntime(stateDir, '', { authSeal: osKeyringSeal({ service, keyring, fallback: false }) });
  const runtime = new OpenClawRuntime(stateDir, '', { authSeal: osKeyringSeal({ service, keyring, dualWrap: true, stateDir: join(root, 'keys') }) });
  const accounts = new Accounts(runtime);
  const snapshot = join(stateDir, 'openclaw/auth-store.sealed');
  try {
    writeFileSync(legacy, legacyAuth());
    await old.migrate(legacy);
    const original = readFileSync(snapshot);
    assert.equal(original[4], 1);
    locked = true;
    await runtime.kit.prepare();
    assert.equal(runtime.kit.state.phase, 'locked');
    await runtime.start(host);
    assert.equal(runtime.kit.state.phase, 'locked');
    assert.match(accounts.view('chatgpt')!.error!, /Unlock.*try again/);
    await accounts.login('chatgpt');
    await accounts.finished('chatgpt');
    assert.deepEqual(readFileSync(snapshot), original, 'a locked retry preserves the original');
    sealed(stateDir);
    locked = false;
    await accounts.login('chatgpt');
    await accounts.finished('chatgpt');
    assert.equal(await accounts.signedIn('chatgpt'), true, 'retry restores the login without a new wizard');
    await runtime.stop();
    sealed(stateDir);
    assert.equal(readFileSync(snapshot)[4], 3);
    locked = true;
    await runtime.start(host);
    assert.equal(await runtime.signedIn('chatgpt'), true, 'the host wrap works after locking again');
  } finally { await runtime.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('a refused start preserves the live gateway and offers a kit retry without signing in again', { timeout: 240_000 }, async () => {
  const { stateDir, legacy, runtime, stop } = await house();
  const retry = new OpenClawRuntime(stateDir);
  const accounts = new Accounts(retry);
  const engine = join(stateDir, 'openclaw');
  try {
    writeFileSync(legacy, legacyAuth());
    await runtime.migrate(legacy);
    await runtime.start(host);
    assert.equal(await runtime.signedIn('chatgpt'), true);
    const guards = ['gateway.pid', 'auth-store.lock/pid', 'auth-store.sealed'];
    const before = guards.map((file) => readFileSync(join(engine, file)));
    const intact = async () => {
      guards.forEach((file, i) => assert.deepEqual(readFileSync(join(engine, file)), before[i], file));
      assert.ok(existsSync(join(engine, 'state/agents/m1/agent/openclaw-agent.sqlite')));
      assert.equal(await runtime.signedIn('chatgpt'), true, 'the live owner keeps its login');
    };
    await assert.rejects(retry.start(host), { code: 'engine-already-running' });
    assert.equal(retry.kit.state.why, 'engine-already-running');
    assert.match(accounts.view('chatgpt')!.error!, /in use.*other session stops/);
    await intact();
    await accounts.login('chatgpt');
    await accounts.finished('chatgpt');
    await retry.stop();
    await intact();
    await assert.rejects(retry.start(host), { code: 'engine-already-running' });
    await runtime.stop();
    sealed(stateDir);
    await accounts.login('chatgpt');
    await accounts.finished('chatgpt');
    assert.equal(await accounts.signedIn('chatgpt'), true, 'retry restores the saved login without a wizard');
    await retry.stop();
    sealed(stateDir);
  } finally { accounts.stop(); await retry.stop(); await stop(); }
});
