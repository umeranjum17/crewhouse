// A helper job whose last turn says nothing after it made calls never closes "done" with a made-up "Done.": it is unsure.
// Stub engine: no account, no network, no quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, delegated, holding, release, settled, task } from './lab.ts';

test('a helper that ran a lookup and finished with no words is unsure, not done', async () => {
  const { db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const t = delegated(crew, 'quill', 'ask permission to look [tool memory_search {"query":"renewals"}]').task;
  await holding(crew, 'quill');
  await release(crew, 'quill', '');
  await settled(db, t);
  assert.equal(task(db, t).state, 'unsure');
  assert.match(task(db, t).result, /finished without an answer/);
  assert.notEqual(task(db, t).result, 'Done.');
  done();
});
