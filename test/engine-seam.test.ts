// The engine seam: the app talks to the engine only through AgentRuntime. One contract both adapters pass, and a
// guard that nothing outside src/openclaw (bar the one picker, src/engines.ts) reaches the engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StubRuntime } from '../src/stub-runtime.ts';
import type { AgentRuntime } from '../src/runtime.ts';
import { faked } from './kit-fake.ts';

test('nothing outside src/openclaw imports the engine, except the picker', () => {
  const src = join(import.meta.dirname, '..', 'src');
  const leaks = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.startsWith('openclaw/') && f !== 'engines.ts')
    .filter((f) => /from '(@byokit\/openclaw|@openclaw\/|(\.\.?\/)+openclaw\/)/.test(readFileSync(join(src, f), 'utf8')));
  assert.deepEqual(leaks, []);
});

for (const [name, make] of [
  ['StubRuntime', async () => ({ runtime: new StubRuntime() as AgentRuntime, started: Promise.resolve(), done: async () => {} })],
  ['OpenClawRuntime', async () => { const f = faked(); return { runtime: f.runtime as AgentRuntime, started: f.started, done: f.done }; }],
] as const) {
  test(`${name} keeps the AgentRuntime contract`, { timeout: 60_000 }, async () => {
    const { runtime, started, done } = await make();
    try {
      await started;
      if (name === 'StubRuntime') await runtime.start({ tools: () => [], gate: async () => ({ allow: true }), call: async () => '' });
      assert.ok(runtime.identity.name && runtime.identity.version, 'it names its engine and version');
      assert.equal(typeof await runtime.signedIn('chatgpt'), 'boolean');
      assert.ok(Array.isArray(await runtime.learned()), 'the learned list is an array');
      await runtime.abort('agent:m1:crewhouse:nobody:0');
      for (const m of ['captureLearned', 'restoreLearned', 'starterSkills', 'setStarter', 'searchSkills', 'runCollectionReview', 'migrate', 'confirm'] as const)
        assert.ok(runtime[m] === undefined || typeof runtime[m] === 'function', `${m} is a method or absent`);
    } finally { await runtime.stop(); await done(); }
  });
}
