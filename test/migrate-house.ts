// Shared fixtures for the gateway-upgrade migration suite (spec §6): a scratch
// house per test, the canned host every gateway boots against, and the two
// end-state witnesses (sealed store, retired crewhouse copy).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';

export const legacyAuth = (extra: Record<string, unknown> = {}) => JSON.stringify({
  'openai-codex': { type: 'oauth', provider: 'openai-codex', access: 'a-preserved', refresh: 'r-preserved', expires: Date.now() + 30 * 86_400_000 },
  ...extra,
}, null, 2);

export async function house() {
  const root = mkdtempSync(join(tmpdir(), 'crewhouse-migrate-'));
  const stateDir = join(root, 'state');
  const legacy = join(root, 'people', '1', 'engine', 'auth.json');
  mkdirSync(join(legacy, '..'), { recursive: true });
  const runtime = new OpenClawRuntime(stateDir);
  const stop = async () => { try { if (existsSync(join(stateDir, 'openclaw'))) await runtime.stop(); } finally { rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); } };
  return { root, stateDir, legacy, runtime, stop };
}

export const host = { tools: () => [], gate: async () => ({ allow: true }) as const, call: async () => 'done' };

export function sealed(stateDir: string) {
  const engine = join(stateDir, 'openclaw');
  const file = readFileSync(join(engine, 'auth-store.sealed'));
  assert.equal(file.subarray(0, 4).toString(), 'BKS1');
  assert.ok(!file.includes(Buffer.from('a-preserved')), 'credentials never appear in the sealed bytes');
  for (const dir of ['state', 'home']) assert.ok(!existsSync(join(engine, dir)), `${dir} plaintext is gone`);
}

export function retired(legacy: string) {
  for (const path of [legacy, `${legacy}.moved-to-engine`, `${legacy}.moved-to-engine.sealed`])
    assert.ok(!existsSync(path), 'confirmed credential sources are gone');
  assert.equal(readFileSync(`${legacy}.moved-to-engine.canonicalized`, 'utf8'), '', 'only an empty marker remains');
}
