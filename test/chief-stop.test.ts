// Chief's chat while he works: the stop square's reset ends the job with a line that names it, and Try again on that
// line re-posts the person's own ask as a new job. Stub engine: no account, no network, no quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, holding, release, until, task } from './lab.ts';
import * as A from '../web/src/adapter.ts';

test("stopping Chief's job leaves a line that offers Try again with the person's ask, and Try again runs it", async () => {
  const { db, crew, done } = setup();
  const ask = 'ask permission to look into my renewals';
  const first = await crew.post('chief', ask) as { task: number };
  await holding(crew, 'chief');
  await crew.resetBot('chief');
  await until("Chief's stopped job to end", () => task(db, first.task)?.state === 'failed');
  const page = crew.botPage('chief');
  const stopped = [...page.messages].reverse().find((m) => m.author === 'bot' && m.task_id === first.task);
  assert.match(stopped?.text ?? '', /^I stopped /, 'the stop line belongs to the stopped job');
  assert.equal(A.lines(page, 'chief').find((l) => l.id === stopped?.id)?.retry, ask, 'the stop line offers Try again with the ask');
  // Try again sends the same words: a new job that runs on the same chat.
  const again = await crew.post('chief', ask) as { task: number };
  assert.notEqual(again.task, first.task);
  await holding(crew, 'chief');
  await release(crew, 'chief', 'Here it is.');
  await until('the retried job to finish', () => task(db, again.task)?.state === 'done');
  done();
});
