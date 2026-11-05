// The engine seam: the app talks to the engine only through AgentRuntime. One contract both adapters pass, and a
// guard that nothing outside src/openclaw (bar the one picker, src/engines.ts) reaches the engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { pickRuntime } from '../src/engines.ts';
import { PiRuntime } from '../src/pi/runtime.ts';
import { StubRuntime } from '../src/stub-runtime.ts';
import type { AgentRuntime } from '../src/runtime.ts';
import { faked } from './kit-fake.ts';

test('nothing outside src/openclaw imports the engine, except the picker', () => {
  const src = join(import.meta.dirname, '..', 'src');
  const leaks = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.startsWith('openclaw/') && f !== 'engines.ts')
    .filter((f) => /from '(@byokit\/openclaw|@openclaw\/|(\.\.?\/)+openclaw\/)/.test(readFileSync(join(src, f), 'utf8')));
  assert.deepEqual(leaks, []);
});

test('only the Pi adapter names the Pi kit, and Pi runs only when it is asked for', () => {
  const src = join(import.meta.dirname, '..', 'src');
  assert.deepEqual(readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && f !== 'pi/runtime.ts' && readFileSync(join(src, f), 'utf8').includes('@byokit/pi')), []);
  const was = process.env.CREWHOUSE_ENGINE;
  try {
    delete process.env.CREWHOUSE_ENGINE;
    assert.equal(loadConfig().engine, 'openclaw', 'the flag is off unless it is set');
    process.env.CREWHOUSE_ENGINE = 'pi';
    assert.equal(pickRuntime(loadConfig()).identity.name, 'Pi');
  } finally { if (was === undefined) delete process.env.CREWHOUSE_ENGINE; else process.env.CREWHOUSE_ENGINE = was; }
});

for (const [name, make] of [
  ['StubRuntime', async () => ({ runtime: new StubRuntime() as AgentRuntime, started: Promise.resolve(), done: async () => {} })],
  ['OpenClawRuntime', async () => { const f = faked(); return { runtime: f.runtime as AgentRuntime, started: f.started, done: f.done }; }],
  ['PiRuntime', async () => ({ runtime: new PiRuntime(loadConfig()) as AgentRuntime, started: Promise.resolve(), done: async () => {} })],
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
