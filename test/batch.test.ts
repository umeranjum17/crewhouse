// Batch researcher to spreadsheet: one question fanned out over many items in parallel, merged into one
// workbook. Sub-runs reuse the run path (same member, same task, same gate); the spreadsheet is delivered once,
// to the asking member only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pool, MAX_ITEMS, MAX_PARALLEL, subMessage } from '../src/batch.ts';
import { setup, settled, task } from './lab.ts';

const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
const batchKey = (member: number, bot: string, t: number, i: number) => `agent:m${member}:crewhouse:${bot}:${t}:batch:${i}`;
const specOf = (crew: any, key: string) => (crew.runtime as any).specOf(key);
const transcript = (crew: any, key: string) => (crew.runtime as any).transcript(key);

function scouted() {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  return { cfg, db, crew, done };
}

test('crew_batch belongs to helpers, never to Chief: his per-turn prompt does not grow', async () => {
  const { crew, done } = scouted();
  try {
    assert.ok(!(crew as any).crewTools('chief').some((t: any) => t.name === 'crew_batch'));
    assert.ok((crew as any).crewTools('scout').some((t: any) => t.name === 'crew_batch'));
  } finally { done(); }
});

test('one question over three items: three parallel sessions, one merged answer, one spreadsheet for the asker', async () => {
  const { cfg, db, crew, done } = scouted();
  try {
    const items = ['Bluebird Cafe', 'Narrowfare Books', 'Fareboard Deli'];
    const question = 'What is the lunch soup price today, with sources?';
    const id = (await crew.post('scout', `compare soups ${call('crew_batch', { question, items })}`))!.task;
    await settled(db, id);
    assert.equal(task(db, id).state, 'done');

    // Three sub-runs, one member's own sessions, same task, distinct keys.
    for (const [i, item] of items.entries()) {
      const spec = specOf(crew, batchKey(1, 'scout', id, i));
      assert.ok(spec, `item ${i} ran its own session`);
      assert.equal(spec.member, 1);
      assert.equal(spec.task, id);
      assert.ok(spec.message.includes(item) && spec.message.includes(question), 'the item hears its item and the one question');
    }
    assert.equal(specOf(crew, batchKey(1, 'scout', id, 3)), undefined, 'no fourth session');

    // The parent got one JSON array back, in item order.
    const parent = transcript(crew, `agent:m1:crewhouse:scout:${id}`);
    const returned = JSON.parse(/crew_batch: (\{.*\})$/m.exec(parent)![1]);
    assert.deepEqual(returned.answers.map((a: any) => a.item), items);
    assert.ok(returned.answers.every((a: any) => a.ok));

    // ...which it puts into a single workbook, delivered to its own member only.
    const sheet = { name: 'Soup compare', sheets: [{ name: 'Soups', columns: [{ header: 'Place' }, { header: 'Soup' }, { header: 'Source' }],
      rows: items.map((p) => [p, 'tomato', 'menu']) }] };
    const wb = (await crew.post('scout', `now the sheet ${call('crew_workbook', sheet)}`))!.task;
    await settled(db, wb);
    assert.equal(task(db, wb).state, 'done');
    const delivered = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data));
    assert.equal(delivered.length, 1, 'one spreadsheet per job, not one per item');
    const sam = crew.addMember('Sam').id as number;
    await assert.rejects(() => crew.workbookView('scout', delivered[0].path, sam), /not delivered to you/);
  } finally { done(); }
});

test('a batch item cannot start another batch: nesting is refused, never fanned out', async () => {
  const { db, crew, done } = scouted();
  try {
    // A batch already running for this task is exactly what a sub-run's own call would find: refuse it.
    const id = (await crew.post('scout', `compare ${call('crew_batch', { question: 'soup prices', items: ['Solo'] })}`))!.task;
    (crew as any).batching.add(id);
    await settled(db, id);
    assert.equal(task(db, id).state, 'done', 'a refused batch is a result the model reads, never a crashed run');
    assert.match(transcript(crew, `agent:m1:crewhouse:scout:${id}`), /cannot start another batch/);
    assert.equal(specOf(crew, batchKey(1, 'scout', id, 0)), undefined, 'no sub-run started from the nested call');
  } finally { done(); }
});

test('a resting account stops later waves early and says so in plain words', async () => {
  const { db, crew, done } = scouted();
  try {
    const items = Array.from({ length: 10 }, (_, i) => `Place ${i + 1}`);
    const id = (await crew.post('scout', `compare ${call('crew_batch', { question: 'hit the limit on prices today', items })}`))!.task;
    await settled(db, id);
    assert.equal(task(db, id).state, 'done', 'a tired account is a result the model reads, never a crashed run');
    assert.ok(specOf(crew, batchKey(1, 'scout', id, 7)), 'the first wave of eight ran');
    assert.equal(specOf(crew, batchKey(1, 'scout', id, 8)), undefined, 'the second wave never started');
    const parent = transcript(crew, `agent:m1:crewhouse:scout:${id}`);
    const returned = JSON.parse(/crew_batch: (\{.*\})$/m.exec(parent)![1]);
    assert.ok(returned.answers.slice(0, 8).every((a: any) => !a.ok));
    assert.match(returned.note, /resting/);
    assert.ok((crew as any).accounts.restingUntil(1, 'chatgpt') > Date.now(), 'the account rests like any other tired turn');
  } finally { done(); }
});

test('at most 24 items per job: the rest are named, not silently dropped', async () => {
  const { db, crew, done } = scouted();
  try {
    const items = Array.from({ length: 30 }, (_, i) => `Place ${i + 1}`);
    const id = (await crew.post('scout', `compare ${call('crew_batch', { question: 'soup prices', items })}`))!.task;
    await settled(db, id);
    assert.ok(specOf(crew, batchKey(1, 'scout', id, MAX_ITEMS - 1)));
    assert.equal(specOf(crew, batchKey(1, 'scout', id, MAX_ITEMS)), undefined);
    const parent = transcript(crew, `agent:m1:crewhouse:scout:${id}`);
    assert.match(parent, new RegExp(`only the first ${MAX_ITEMS} of 30 items`));
  } finally { done(); }
});

test('an empty question or item list is a plain error, not a run of nothing', async () => {
  const { db, crew, done } = scouted();
  try {
    const id = (await crew.post('scout', `compare ${call('crew_batch', { question: '', items: [] })}`))!.task;
    await settled(db, id);
    assert.equal(task(db, id).state, 'done');
    assert.match(transcript(crew, `agent:m1:crewhouse:scout:${id}`), /error: (say the one question|list the items)/);
    assert.equal(specOf(crew, batchKey(1, 'scout', id, 0)), undefined, 'nothing ran');
  } finally { done(); }
});

test('the pool never runs more than eight at once and keeps input order', async () => {
  let flying = 0, widest = 0;
  const out = await pool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], MAX_PARALLEL, async (n) => {
    flying++;
    widest = Math.max(widest, flying);
    await new Promise((r) => setImmediate(r));
    flying--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  assert.ok(widest <= MAX_PARALLEL && widest > 1, `widest wave was ${widest}`);
});

test('each item prompt carries its item, the shared question, and a sources line', () => {
  const m = subMessage('What costs what?', 'Bluebird Cafe');
  assert.ok(m.includes('Bluebird Cafe') && m.includes('What costs what?') && m.includes('Sources:'));
});
