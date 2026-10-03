// CH-6: one house-wide per-task token ceiling, checked where usage is summed.
// A task that reaches it stops with plain words; ordinary jobs never notice it.
// Runs on the stub model: no account, no network, no quota.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup as lab, settled } from './lab.ts';

test('a task that reaches the per-task ceiling stops with plain words', { timeout: 60_000 }, async () => {
  process.env.CREWHOUSE_TASK_TOKENS = '1';
  try {
    const { db, crew } = lab();
    crew.onboard('Owner');
    crew.recruit('scribe', 'Scribe', 'person');
    const { task } = (await crew.assign('scribe', 'Draft an email to the team about Friday demo day', 'chief'))!;
    await settled(db, task);
    const t = db.get('SELECT state, result, tokens FROM tasks WHERE id = ?', task)!;
    assert.equal(t.state, 'failed', 'the runaway task stops instead of spending on');
    assert.ok(t.tokens >= 1, 'the summed usage is what tripped it');
    assert.match(t.result, /stopped this task to limit its AI use/, 'plain words, written by crewd');
    assert.doesNotMatch(t.result, /\d/, 'no numbers reach the person');
  } finally {
    delete process.env.CREWHOUSE_TASK_TOKENS;
  }
});
