// The gateway-upgrade migration (spec §6), through the real entry points on the real pinned engine:
// a preserved sign-in survives the upgrade (import, the gateway confirms it, then crewhouse's copy retires),
// and a failed import leaves the original intact and recoverable — a retry succeeds without a second login.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';

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

test('ChatGPT uses the gateway auth provider for status, logout and migration confirmation', async () => {
  const { legacy, runtime, stop } = await house();
  const calls: { method: string; params: any }[] = [];
  const client = { request: async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === 'models.authStatus') return { providers: [{ provider: 'openai-codex' }] };
  } };
  // A scripted gateway response isolates the identity projection from doctor and network setup.
  (runtime as any).client = client;
  (runtime as any).agents.add(1);
  try {
    writeFileSync(legacy, legacyAuth());
    assert.equal(await runtime.signedIn(1, 'chatgpt'), true);
    await runtime.signOut(1, 'chatgpt');
    assert.deepEqual(calls.find((c) => c.method === 'models.authLogout')?.params, { provider: 'openai-codex', agentId: 'm1' });
    assert.equal(await runtime.confirm(1, legacy), true);
    assert.ok(existsSync(`${legacy}.moved-to-engine`));
  } finally { await stop(); }
});

test('a preserved sign-in survives the upgrade, a failed import stays recoverable', { timeout: 600_000 }, async () => {
  // The upgrade: crewhouse's copy is retired only after the gateway itself reports the member signed in.
  {
    const { legacy, runtime, stop } = await house();
    try {
      writeFileSync(legacy, legacyAuth());
      assert.equal(await runtime.migrate(1, legacy), true, 'the import ran once the engine was in place');
      assert.ok(existsSync(legacy), 'crewhouse\u2019s copy is not retired before the gateway confirms the import');
      await runtime.start(host);
      assert.equal(await runtime.confirm(1, legacy), true, 'the gateway reports the preserved sign-in');
      assert.ok(!existsSync(legacy), 'only a confirmed import retires crewhouse\u2019s copy');
      assert.ok(readFileSync(`${legacy}.moved-to-engine`, 'utf8').includes('a-preserved'), 'the retire is a rename, not a rewrite');
      assert.equal(await runtime.signedIn(1, 'chatgpt'), true, 'the gateway reports the member signed in — no second login asked');
    } finally { await stop(); }
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
