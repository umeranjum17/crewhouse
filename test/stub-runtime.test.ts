import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StubRuntime } from '../src/stub-runtime.ts';

test('fast fixture still gates tool calls and uses task-member run', async () => {
  const stub = new StubRuntime();
  let called = 0;
  await stub.start({ tools: () => [], gate: async () => ({ allow: true }), call: async (run) => { called++; assert.equal(run.member, 2); return 'yes'; } });
  const end = await stub.run({ key: 'test', member: 2, bot: 'scout', task: 1, cwd: '.', system: '', message: '[tool crew_report {"text":"hi"}]', builtins: [] }, () => {});
  assert.deepEqual(end, { ok: true, text: 'stub scout: crew_report said yes' });
  assert.equal(called, 1);
  await stub.stop();
});
