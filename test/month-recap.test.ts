// D34: Chief's month-in-brief turn must see the household's delivered work.
// Two delivered documents, then Chief is asked for a month in brief: his model
// prompt must carry both finished titles, and never another member's work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, settled, task } from './lab.ts';

const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
const doc = (name: string) => ({ name, blocks: [{ heading: name }, { text: 'Finished work.' }] });

test("Chief's recap turn reads the asking member's delivered work, not another member's", async () => {
  const { crew, db, done } = setup();
  crew.onboard('Umer');
  crew.recruit('scout', 'Scout', 'person');
  const dinner = crew.assign('scout', `two weeknight dinners ${call('crew_document', doc('Two simple weeknight dinners'))}`, 'chief').task;
  const papers = crew.assign('scout', `sort the paperwork ${call('crew_document', doc('Paperwork triage'))}`, 'chief').task;
  await settled(db, dinner);
  await settled(db, papers);
  assert.equal(task(db, dinner).state, 'done');
  assert.equal(task(db, papers).state, 'done');

  const sam = crew.addMember('Sam').id as number;
  const theirs = (await crew.post('scout', `a private list ${call('crew_document', doc('Sam secret list'))}`, undefined, sam))!.task;
  await settled(db, theirs);
  assert.equal(task(db, theirs).state, 'done');

  // Later chatter pushes the delivery lines out of Chief's short chat-history window.
  for (const sum of ['2 + 3', '4 + 5', '6 + 7']) {
    const q = (await crew.post('chief', `Chief, what is ${sum}?`))!.task;
    assert.equal(task(db, q).bot, 'chief');
    await settled(db, q);
  }

  const recap = (await crew.post('chief', 'Chief, give me our month in brief'))!.task;
  assert.equal(task(db, recap).bot, 'chief');
  await settled(db, recap);
  const seen = (crew.runtime as any).specOf(`agent:m1:crewhouse:chief:${recap}`)?.message ?? '';
  assert.match(seen, /Two simple weeknight dinners/, 'the recap turn can read the delivered dinner work');
  assert.match(seen, /Paperwork triage/, 'the recap turn can read the delivered paperwork');
  assert.doesNotMatch(seen, /Sam secret list/, 'never another member’s work');
  done();
});
