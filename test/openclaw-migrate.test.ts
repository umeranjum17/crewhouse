// The gateway-upgrade migration (spec §6), through the real entry points on the real pinned engine:
// a preserved sign-in survives the upgrade (import, the gateway confirms it, then crewhouse's copy retires),
// and a failed import leaves the original intact and recoverable — a retry succeeds without a second login.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { startModelStub } from './openclaw-stub.ts';
import { faked } from './kit-fake.ts';

const legacyAuth = (extra: Record<string, unknown> = {}) => JSON.stringify({
  'openai-codex': { type: 'oauth', provider: 'openai-codex', access: 'a-preserved', refresh: 'r-preserved', expires: Date.now() + 30 * 86_400_000 },
  ...extra,
}, null, 2);

async function house() {
  const root = mkdtempSync(join(tmpdir(), 'crewhouse-migrate-'));
  const stateDir = join(root, 'state');
  const legacy = join(root, 'people', '1', 'engine', 'auth.json');
  mkdirSync(join(legacy, '..'), { recursive: true });
  const runtime = new OpenClawRuntime(stateDir);
  const stop = async () => { await runtime.stop().catch(() => {}); rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); };
  return { root, stateDir, legacy, runtime, stop };
}

const host = { tools: () => [], gate: async () => ({ allow: true }) as const, call: async () => 'done' };


test('ChatGPT uses the canonical gateway auth provider for status, logout and migration confirmation', async () => {
  const { legacy, stop } = await house();
  const f = faked({}, { 'models.authStatus': () => ({ providers: [{ provider: 'openai' }] }) });
  try {
    await f.started;
    writeFileSync(legacy, legacyAuth());
    assert.equal(await f.runtime.signedIn('chatgpt'), true);
    await f.runtime.signOut('chatgpt');
    assert.deepEqual(f.fake.calls.find((c) => c.method === 'models.authLogout')?.params, { provider: 'openai', agentId: 'm1' });
    assert.equal(await f.runtime.confirm(legacy), true);
    assert.ok(existsSync(`${legacy}.moved-to-engine`));
  } finally { await f.done(); await stop(); }
});

test('existing gateway config gains the subscription runtime rule and Crewhouse\'s tool fence', async () => {
  const { stateDir, runtime, stop } = await house();
  try {
    await runtime.kit.prepare();
    const path = join(stateDir, 'openclaw/openclaw.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    config.agents.defaults.modelPolicy = { allow: ['anthropic/*'] };
    writeFileSync(path, JSON.stringify(config));
    await runtime.kit.prepare();
    const updated = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(updated.agents.defaults.modelPolicy.allow, [], 'an explicit model map never narrows the family\'s providers');
    assert.equal(updated.agents.defaults.models['openai/*'].agentRuntime.id, 'openclaw');
    assert.deepEqual(updated.tools.exec, { security: 'deny', ask: 'always' });
    assert.equal(updated.plugins.entries.codex.enabled, false);
  } finally { await stop(); }
});

test('a previously retired legacy import repairs through doctor without touching other accounts or deny', { timeout: 240_000 }, async () => {
  const { stateDir, legacy, runtime, stop } = await house();
  const other = { type: 'token', provider: 'anthropic', token: 'synthetic-other' };
  try {
    writeFileSync(legacy, legacyAuth({ anthropic: other }));
    await runtime.kit.prepare();
    const agentDir = join(stateDir, 'openclaw/state/agents/m1/agent');
    mkdirSync(agentDir, { recursive: true });
    copyFileSync(legacy, join(agentDir, 'auth.json')); // the old shipped migration, before the repair
    const { entry, env } = runtime.kit.doctorContext();
    assert.equal(spawnSync(process.execPath, [entry, 'doctor', '--fix', '--yes', '--non-interactive'],
      { env, cwd: env.HOME, timeout: 120_000, stdio: 'pipe' }).status, 0);
    renameSync(legacy, `${legacy}.moved-to-engine`);
    await runtime.start(host);
    assert.equal(await runtime.signedIn('chatgpt'), false, 'legacy recognition is not canonical route access');
    const denied = await runtime.run({ key: 'agent:m1:crewhouse:chief:before', bot: 'chief', task: 1,
      account: 'chatgpt', cwd: '', system: 'Be brief.', message: 'Hello', builtins: [] }, () => {});
    assert.ok(!denied.ok && 'message' in denied);
    assert.match(denied.message, /No route-compatible authentication source/);
    await runtime.stop();
    assert.equal(await runtime.migrate(legacy), true, 'the retained original is repaired offline');
    await runtime.start(host);
    assert.equal(await runtime.signedIn('chatgpt'), true);
    assert.equal(await runtime.confirm(legacy), true);
    assert.equal(await runtime.migrate(legacy), false, 'confirmed repairs are not repeated on restart');
    const db = new DatabaseSync(join(agentDir, 'openclaw-agent.sqlite'));
    const profiles = JSON.parse((db.prepare('SELECT store_json FROM auth_profile_store').get() as { store_json: string }).store_json).profiles;
    db.close();
    assert.equal(profiles['openai:default'].provider, 'openai');
    assert.equal(profiles['openai:default'].access, 'a-preserved');
    assert.deepEqual(profiles['anthropic:default'], other);
    const cfg = ((await runtime.kit.call('config.get', {})) as any).config;
    assert.deepEqual(cfg.tools.exec, { security: 'deny', ask: 'always' });
    assert.equal(cfg.plugins.entries.codex.enabled, false);
    assert.ok(existsSync(`${legacy}.moved-to-engine`), 'the original recovery bytes remain');
  } finally { await stop(); }
});

test('a preserved sign-in survives the upgrade, a failed import stays recoverable', { timeout: 600_000 }, async () => {
  // The upgrade: crewhouse's copy is retired only after the gateway itself reports the member signed in.
  {
    const { legacy, runtime, stop } = await house();
    const stub = await startModelStub();
    try {
      writeFileSync(legacy, legacyAuth());
      assert.equal(await runtime.migrate(legacy), true, 'the import ran once the engine was in place');
      assert.ok(existsSync(legacy), 'crewhouse\u2019s copy is not retired before the gateway confirms the import');
      await runtime.start(host);
      assert.equal(await runtime.confirm(legacy), true, 'the gateway reports the preserved sign-in');
      assert.ok(!existsSync(legacy), 'only a confirmed import retires crewhouse\u2019s copy');
      assert.ok(readFileSync(`${legacy}.moved-to-engine`, 'utf8').includes('a-preserved'), 'the retire is a rename, not a rewrite');
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
