// The gateway-upgrade migration (spec §6), through the real entry points on the real pinned engine:
// a preserved sign-in survives the upgrade (import, the gateway confirms it, then crewhouse's copy retires),
// and a failed import leaves the original intact and recoverable — a retry succeeds without a second login.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { startModelStub } from './openclaw-stub.ts';

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
  const { legacy, runtime, stop } = await house();
  const calls: { method: string; params: any }[] = [];
  const client = { request: async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === 'models.authStatus') return { providers: [{ provider: 'openai' }] };
  } };
  // A scripted gateway response isolates the identity projection from doctor and network setup.
  (runtime as any).client = client;
  (runtime as any).agents.add(1);
  try {
    writeFileSync(legacy, legacyAuth());
    assert.equal(await runtime.signedIn(1, 'chatgpt'), true);
    await runtime.signOut(1, 'chatgpt');
    assert.deepEqual(calls.find((c) => c.method === 'models.authLogout')?.params, { provider: 'openai', agentId: 'm1' });
    assert.equal(await runtime.confirm(1, legacy), true);
    assert.ok(existsSync(`${legacy}.moved-to-engine`));
  } finally { await stop(); }
});

test('existing gateway config gains only the subscription runtime rule', async () => {
  const { stateDir, runtime, stop } = await house();
  try {
    const gateway = (runtime as any).gateway;
    await gateway.prepare();
    const path = join(stateDir, 'openclaw/openclaw.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    config.agents.defaults.modelPolicy = { allow: ['anthropic/*'] };
    writeFileSync(path, JSON.stringify(config));
    await gateway.prepare();
    const updated = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(updated.agents.defaults.modelPolicy.allow, ['anthropic/*', 'openai/*']);
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
    const gateway = (runtime as any).gateway;
    await gateway.prepare();
    const agentDir = join(stateDir, 'openclaw/state/agents/m1/agent');
    mkdirSync(agentDir, { recursive: true });
    copyFileSync(legacy, join(agentDir, 'auth.json')); // the old shipped migration, before the repair
    const { entry, env } = gateway.doctorContext();
    assert.equal(spawnSync(process.execPath, [entry, 'doctor', '--fix', '--yes', '--non-interactive'],
      { env, cwd: env.HOME, timeout: 120_000, stdio: 'pipe' }).status, 0);
    renameSync(legacy, `${legacy}.moved-to-engine`);
    await runtime.start(host);
    assert.equal(await runtime.signedIn(1, 'chatgpt'), false, 'legacy recognition is not canonical route access');
    const denied = await runtime.run({ key: 'agent:m1:crewhouse:chief:before', member: 1, bot: 'chief', task: 1,
      account: 'chatgpt', cwd: '', system: 'Be brief.', message: 'Hello', builtins: [] }, () => {});
    assert.ok(!denied.ok && 'message' in denied);
    assert.match(denied.message, /No route-compatible authentication source/);
    await runtime.stop();
    assert.equal(await runtime.migrate(1, legacy), true, 'the retained original is repaired offline');
    await runtime.start(host);
    assert.equal(await runtime.signedIn(1, 'chatgpt'), true);
    assert.equal(await runtime.confirm(1, legacy), true);
    assert.equal(await runtime.migrate(1, legacy), false, 'confirmed repairs are not repeated on restart');
    const db = new DatabaseSync(join(agentDir, 'openclaw-agent.sqlite'));
    const profiles = JSON.parse((db.prepare('SELECT store_json FROM auth_profile_store').get() as { store_json: string }).store_json).profiles;
    db.close();
    assert.equal(profiles['openai:default'].provider, 'openai');
    assert.equal(profiles['openai:default'].access, 'a-preserved');
    assert.deepEqual(profiles['anthropic:default'], other);
    const cfg = (await (runtime as any).client.request('config.get')).config;
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
      assert.equal(await runtime.migrate(1, legacy), true, 'the import ran once the engine was in place');
      assert.ok(existsSync(legacy), 'crewhouse\u2019s copy is not retired before the gateway confirms the import');
      await runtime.start(host);
      assert.equal(await runtime.confirm(1, legacy), true, 'the gateway reports the preserved sign-in');
      assert.ok(!existsSync(legacy), 'only a confirmed import retires crewhouse\u2019s copy');
      assert.ok(readFileSync(`${legacy}.moved-to-engine`, 'utf8').includes('a-preserved'), 'the retire is a rename, not a rewrite');
      assert.equal(await runtime.signedIn(1, 'chatgpt'), true, 'the gateway reports the canonical provider signed in — no second login asked');
      const db = new DatabaseSync(join(runtime.stateDir, 'openclaw/state/agents/m1/agent/openclaw-agent.sqlite'));
      const stored = JSON.parse((db.prepare('SELECT store_json FROM auth_profile_store').get() as { store_json: string }).store_json).profiles;
      db.close();
      assert.deepEqual(Object.keys(stored), ['openai:default']);
      assert.equal(stored['openai:default'].provider, 'openai');
      assert.equal(stored['openai:default'].access, 'a-preserved');
      assert.equal(stored['openai:default'].refresh, 'r-preserved');
      const config = await (runtime as any).client.request('config.get');
      assert.equal(config.config.agents.defaults.models['openai/*'].agentRuntime.id, 'openclaw');
      assert.deepEqual(config.config.agents.defaults.modelPolicy.allow, [], 'other members’ models remain selectable');
      await runtime.configureModelProvider(stub.url, 'stub-m1');
      const end = await runtime.run({ key: 'agent:m1:crewhouse:chief:migration', member: 1, bot: 'chief', task: 1,
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
      await runtime.migrate(1, legacy);
      assert.equal(await runtime.confirm(1, legacy), false, 'nothing is confirmed while the gateway is down');
      assert.ok(existsSync(legacy), 'the original sign-in survives a failed import');
      await runtime.start(host);
      assert.equal(await runtime.confirm(1, legacy), true, 'the retry succeeds');
      assert.equal(await runtime.signedIn(1, 'chatgpt'), true, 'still the one preserved sign-in, never a second login');
    } finally { await stop(); }
  }
  // A doctor run that imports nothing (an auth the engine cannot read) is never a confirmed migration.
  {
    const { legacy, runtime, stop } = await house();
    try {
      writeFileSync(legacy, JSON.stringify({ openai: { type: 'nonsense', provider: 'openai' } }));
      await runtime.migrate(1, legacy);
      await runtime.start(host);
      assert.equal(await runtime.confirm(1, legacy), false, 'an import that never lands is not confirmed');
      assert.ok(existsSync(legacy), 'the original sign-in is intact when the import fails');
      assert.ok(!existsSync(`${legacy}.moved-to-engine`), 'nothing was retired');
    } finally { await stop(); }
  }
});
