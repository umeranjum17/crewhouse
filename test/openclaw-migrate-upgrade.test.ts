// The gateway-upgrade migration (spec §6), part 2: the upgrade itself —
// a preserved sign-in survives (import, gateway confirms, crewhouse copy
// retires; a failed import stays recoverable), and an upgraded house keeps
// its device identity while the old plugin folder falls away.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';
import { test } from 'node:test';
import { startModelStub } from './openclaw-stub.ts';
import { host, house, legacyAuth, retired, sealed } from './migrate-house.ts';

test('a preserved sign-in survives the upgrade, a failed import stays recoverable', { timeout: 600_000 }, async () => {
  // The upgrade: crewhouse's copy is retired only after the gateway itself reports the member signed in.
  {
    const { stateDir, legacy, runtime, stop } = await house();
    const stub = await startModelStub();
    try {
      writeFileSync(legacy, legacyAuth());
      assert.equal(await runtime.migrate(legacy), true, 'the import ran once the engine was in place');
      sealed(stateDir);
      assert.ok(existsSync(legacy), 'crewhouse’s copy is not retired before the gateway confirms the import');
      await runtime.start(host);
      assert.equal(await runtime.confirm(legacy), true, 'the gateway reports the preserved sign-in');
      assert.ok(!existsSync(legacy), 'only a confirmed import retires crewhouse’s copy');
      retired(legacy);
      assert.equal(await runtime.signedIn('chatgpt'), true, 'the gateway reports the canonical provider signed in — no second login asked');
      const db = new DatabaseSync(join(runtime.stateDir, 'openclaw/state/agents/m1/agent/openclaw-agent.sqlite'));
      const stored = JSON.parse((db.prepare('SELECT store_json FROM auth_profile_store').get() as { store_json: string }).store_json).profiles;
      db.close();
      assert.deepEqual(Object.keys(stored), ['openai:default']);
      assert.equal(stored['openai:default'].provider, 'openai');
      assert.equal(stored['openai:default'].access, 'a-preserved');
      assert.equal(stored['openai:default'].refresh, 'r-preserved');
      const config = await runtime.kit.call('config.get', {}) as any;
      assert.equal(config.config.agents.defaults.models['openai/*'].agentRuntime.id, 'openclaw');
      assert.deepEqual(config.config.agents.defaults.modelPolicy.allow, [], 'other members’ models remain selectable');
      await runtime.configureModelProvider(stub.url, 'stub-m1');
      const end = await runtime.run({ key: 'agent:m1:crewhouse:chief:migration', bot: 'chief', task: 1,
        account: 'chatgpt', cwd: '', system: 'Be brief.', message: 'Hello', builtins: [] }, () => {});
      assert.ok(end.ok && end.text.includes('Hello'), JSON.stringify(end));
      assert.ok(stub.calls.length > 0, 'real agent RPC reached the local scripted model');
      await runtime.stop();
      sealed(stateDir);
      await runtime.start(host);
      assert.equal(await runtime.signedIn('chatgpt'), true, 'the sealed store restores the same sign-in');
      const resumed = await runtime.run({ key: 'agent:m1:crewhouse:chief:restored', bot: 'chief', task: 2,
        account: 'chatgpt', cwd: '', system: 'Be brief.', message: 'Hello', builtins: [] }, () => {});
      assert.ok(resumed.ok && resumed.text.includes('Hello'), JSON.stringify(resumed));
    } finally { await stop(); await stub.close(); }
  }
  // A failed import (the engine was never up to confirm) leaves the original intact; the retry then succeeds.
  {
    const { legacy, runtime, stop } = await house();
    try {
      writeFileSync(legacy, legacyAuth());
      await runtime.migrate(legacy);
      assert.equal(await runtime.confirm(legacy), false, 'nothing is confirmed while the gateway is down');
      assert.ok(existsSync(legacy), 'the original sign-in survives a failed import');
      await runtime.start(host);
      assert.equal(await runtime.confirm(legacy), true, 'the retry succeeds');
      assert.equal(await runtime.signedIn('chatgpt'), true, 'still the one preserved sign-in, never a second login');
    } finally { await stop(); }
  }
  // A doctor run that imports nothing (an auth the engine cannot read) is never a confirmed migration.
  {
    const { legacy, runtime, stop } = await house();
    try {
      writeFileSync(legacy, JSON.stringify({ openai: { type: 'nonsense', provider: 'openai' } }));
      await runtime.migrate(legacy);
      await runtime.start(host);
      assert.equal(await runtime.confirm(legacy), false, 'an import that never lands is not confirmed');
      assert.ok(existsSync(legacy), 'the original sign-in is intact when the import fails');
      assert.ok(!existsSync(`${legacy}.moved-to-engine`), 'nothing was retired');
      await runtime.stop();
      sealed(runtime.stateDir);
      writeFileSync(legacy, legacyAuth());
      assert.equal(await runtime.migrate(legacy), true, 'a failed import is retried through the kit');
      await runtime.start(host);
      assert.equal(await runtime.confirm(legacy), true, 'the repaired source imports without signing in again');
      retired(legacy);
    } finally { await stop(); }
  }
});

test('an upgraded house starts: its device identity and old plugin folder carry over', { timeout: 240_000 }, async () => {
  const { stateDir, runtime, stop } = await house();
  try {
    // What the previous engine adapter left in every existing state: its own identity file shape and plugin path.
    const engine = join(stateDir, 'openclaw');
    mkdirSync(engine, { recursive: true });
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(join(engine, 'device.json'), JSON.stringify({
      deviceId: createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)).digest('hex'),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }), privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }), { mode: 0o600 });
    writeFileSync(join(engine, 'openclaw.json'), JSON.stringify({ plugins: { load: { paths: [join(stateDir, 'gone/src/openclaw/plugin')] }, allow: ['crewhouse'] } }));
    await runtime.kit.prepare();
    const config = JSON.parse(readFileSync(join(engine, 'openclaw.json'), 'utf8'));
    assert.deepEqual(config.plugins.load.paths, [join(engine, 'plugin')], 'only the bridge plugin loads; the old folder is gone');
    await runtime.start(host);
    const health = await runtime.kit.call('health', {}) as { ok: boolean; plugins: { loaded: string[] } };
    assert.ok(health.ok && health.plugins.loaded.includes('crewhouse'));
  } finally { await stop(); }
});
