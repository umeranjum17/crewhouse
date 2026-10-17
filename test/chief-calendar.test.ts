// P7: Chief keeps the person's calendar himself instead of handing it to a helper; his read runs on the emulated
// Google in test/google-emulator.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, task, until } from './lab.ts';

test('Chief without Calendar asks to connect it: one connect ask, still no helper task', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer');
  const r = await crew.post('chief', 'what is on this week [tool crew_connect {"app":"calendar"}]') as { task?: number };
  assert.ok(r?.task, 'the question becomes a task');
  await until('connect ask', () => task(db, r.task!).state === 'needs_you');
  const asks = crew.snapshot().asks.filter((a: any) => a.state === 'open');
  assert.equal(asks.length, 1, 'one ask');
  assert.equal(asks[0].kind, 'connect', 'it asks to connect the calendar');
  assert.deepEqual(db.all('SELECT DISTINCT bot FROM tasks').map((t) => t.bot), ['chief'], 'no helper task');
  done();
});
