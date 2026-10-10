// CH-6: one house-wide per-task token ceiling, checked where usage is summed.
// A task that reaches it stops with plain words; ordinary jobs never notice it.
// A run the engine goes silent in stops by itself too: Chief says so once, and the next message runs. A helper gone
// quiet is Chief's to ask about (Stop / Take over / Leave it in his thread), its live line says what the rail says,
// and a Stop gets one line from Chief with the helper free again on the rail and in the office counts.
// Runs on the stub model: no account, no network, no quota.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup as lab, settled, holding, release } from './lab.ts';
import * as A from '../web/src/adapter.ts';

test('a task that reaches the per-task ceiling stops with plain words', { timeout: 60_000 }, async () => {
  process.env.CREWHOUSE_TASK_TOKENS = '1';
  try {
    const { db, crew } = lab();
    crew.onboard('Owner');
    crew.recruit('scribe', 'Scribe', 'person');
    const { task } = (await crew.post('scribe', 'Draft an email to the team about Friday demo day'))!;
    await settled(db, task);
    const t = db.get('SELECT state, result, tokens FROM tasks WHERE id = ?', task)!;
    assert.equal(t.state, 'failed', 'the runaway task stops instead of spending on');
    assert.ok(t.tokens >= 1, 'the summed usage is what tripped it');
    assert.match(t.result, /getting long/, 'plain words, written by crewd');
    assert.doesNotMatch(t.result, /\d/, 'no numbers reach the person');
  } finally {
    delete process.env.CREWHOUSE_TASK_TOKENS;
  }
});

test('a run that hangs ends itself: Chief says so once, and the next message carries on', { timeout: 60_000 }, async () => {
  process.env.CREWHOUSE_HUNG_MS = '1000';
  try {
    const { db, crew } = lab();
    crew.onboard('Umer');
    const { task } = (await crew.post('chief', 'ask permission to plan my week'))!;
    await holding(crew, 'chief'); // the stub model never answers: the run hangs
    await settled(db, task); // crewd's own clock ends it; nobody pressed Stop
    assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', task)!.state, 'failed');
    const lines = () => db.all("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND text LIKE '%stalled%'").map((m) => m.text);
    assert.deepEqual(lines(), ['“ask permission to plan my week” stalled, so I stopped it. Anything made so far is kept, and your next message carries on.']);
    const next = (await crew.post('chief', 'carry on please'))!.task;
    await release(crew, 'chief', 'Carrying on with your week.'); // the stub holds on the earlier words; this time the model answers
    await settled(db, next);
    assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', next)!.state, 'done', 'the next message runs, not queued behind the hung one');
    assert.match((crew.runtime as any).specOf(`agent:m1:crewhouse:chief:${next}`).message, /stalled, so I stopped it/, 'and Chief sees where it left off');
    (crew as any).tick();
    assert.equal(lines().length, 1, 'said once');
  } finally {
    delete process.env.CREWHOUSE_HUNG_MS;
  }
});

test('a helper gone quiet: Chief asks, the live line agrees with the rail, and Stop gets one line from Chief', { timeout: 60_000 }, async () => {
  const { db, crew } = lab();
  crew.onboard('Umer');
  crew.recruit('scout', 'Scout', 'person');
  const { task } = (await crew.post('scout', 'ask permission to find flights for next week'))!;
  await holding(crew, 'scout');
  // Ten minutes without a word from the run, as crewd's own clock would see it (the hung bound is not reached: the
  // engine itself is still in its turn).
  db.run("UPDATE events SET at = at - 600000 WHERE json_extract(data, '$.task') = ?", task);
  db.run('UPDATE tasks SET updated_at = updated_at - 600000 WHERE id = ?', task);
  let state = crew.snapshot(), team = A.crew(state), v = A.office(state);
  const scout = () => v.crew.find((c) => c.id === 'scout')!;
  assert.equal(A.statusOf(scout(), v).word, 'Gone quiet');
  assert.deepEqual(A.stuckIn(team, 'chief').map((x) => x.id), ['scout'], '(a) Stop / Take over / Leave it is in Chief\'s thread');
  assert.deepEqual(A.stuckIn(team, 'scout').map((x) => x.id), ['scout'], 'and in Scout\'s own');
  const ln = A.liveLine({ id: 'scout', name: 'Scout', crew: team, tasks: state.tasks, events: state.events, heard: [], writing: new Map() });
  assert.equal(ln?.state, 'working');
  assert.equal(A.goneQuiet(ln, team, 'scout'), true, '(b) the live line reads "Gone quiet" like the rail, not "still working"');

  const alerts = () => db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'alert'")!.n;
  const before = alerts();
  await crew.resetBot('scout');
  const said = db.all("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND text LIKE 'I stopped%'").map((m) => m.text);
  assert.deepEqual(said, ['I stopped Scout\'s “ask permission to find flights for next week”, as you asked. Anything made so far is kept, and your next message carries on.'], '(c) one plain line');
  assert.equal(alerts(), before, 'the person pressed Stop: no alert');
  state = crew.snapshot(); team = A.crew(state); v = A.office(state);
  assert.deepEqual([A.statusOf(scout(), v).word, A.groupOf(scout(), v)], ['Free', 'free'], 'the rail and the office counts agree: free');
  assert.deepEqual(A.stuckIn(team, 'chief'), [], 'nothing left to ask about');
});
