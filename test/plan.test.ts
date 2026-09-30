// Chief's plan card: a job of several steps waits for the person's Go, "Change it" takes their words back to Chief,
// and Go approves nothing on the way (every send, spend or change still asks on its own card).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { setup, until, settled } = await import('./lab.ts');

const steps = ['Read reviews of strollers under $400', 'Pick the best five', 'Compare them in one sheet'];
const plan = (s: unknown = steps) => `[tool crew_assign ${JSON.stringify({ bot: 'scout', task: 'Find the best five strollers under $400', title: 'Five strollers', steps: s })}]`;
const card = (db: any) => db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'");
const helperTasks = (db: any) => db.all("SELECT * FROM tasks WHERE bot = 'scout' ORDER BY id");

test('a job of several steps shows Chief’s plan first and starts only on Go', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer');
  crew.recruit('scout', 'Scout', 'person');

  // The card: the steps in plain words, and nothing handed to Scout yet.
  await settled(db, crew.requestChief(`compare strollers ${plan()}`).task);
  const a = card(db);
  assert.equal(a.bot, 'chief');
  assert.equal(a.title, 'Here’s the plan for “Five strollers”. Scout starts when you say Go.');
  assert.equal(helperTasks(db).length, 0, 'nothing starts before Go');
  const view = crew.snapshot().asks.find((x: any) => x.id === a.id)!;
  assert.deepEqual(view.detail.plan, { bot: 'scout', steps }, 'the app sees the helper and the steps, not the request or an account');

  // Change it: the card closes, the person's own words show in Chief's thread, and Chief gets them with the plan.
  await crew.answer(a.id, { answer: 'deny', change: 'Only ones that fold with one hand' });
  assert.equal(db.get('SELECT answer FROM asks WHERE id = ?', a.id)!.answer, 'change it');
  const redo = db.get("SELECT * FROM tasks WHERE bot = 'chief' ORDER BY id DESC LIMIT 1")!;
  assert.match(redo.body, /They say: Only ones that fold with one hand/);
  assert.match(redo.body, /2\. Pick the best five/, 'Chief sees the plan the change is about');
  assert.equal(db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'person' ORDER BY id DESC LIMIT 1")!.text, 'Only ones that fold with one hand');
  await settled(db, redo.id);
  assert.equal(helperTasks(db).length, 0, 'a change starts nothing');

  // Not now: nothing starts.
  await settled(db, crew.requestChief(`again ${plan()}`).task);
  await crew.answer(card(db).id, { answer: 'deny' });
  assert.equal(helperTasks(db).length, 0);

  // Go: Scout gets the job with the plan, as Chief's hand-off, and no standing yes comes with it.
  const chief = crew.requestChief(`once more ${plan(steps.map((x, i) => `${i + 1}. ${x}`).join('\n'))}`).task;
  await settled(db, chief);
  const go = card(db);
  assert.deepEqual(JSON.parse(go.detail).plan.steps, steps, 'numbered lines in one string read as the same steps');
  await crew.answer(go.id, { answer: 'allow' });
  await until('Scout has the job', () => helperTasks(db).length === 1);
  const job = helperTasks(db)[0];
  assert.equal([job.origin, job.parent, job.title].join('|'), `chief|${chief}|Five strollers`);
  assert.match(job.body, /said Go to:\n1\. Read reviews of strollers under \$400\n2\. Pick the best five\n3\. Compare them in one sheet\nIt approves no send, purchase or change by itself/);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'bot.allowed'")!.n, 0, 'Go grants nothing');
  await settled(db, job.id);

  // One step is an ordinary hand-off, with no card.
  await settled(db, crew.requestChief(`quick one ${plan(['Look up one price'])}`).task);
  assert.equal(card(db), undefined);
  assert.equal(helperTasks(db).length, 2);
  done();
});
