// D34: Chief's month-in-brief must be sourced from the person's delivered work.
// Two delivered documents, then Chief is asked for a month in brief: his turn reads
// crew_status, which must carry both finished titles with their delivered files.
// The record is on demand through the tool: the per-turn prompt must not grow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, settled, task } from './lab.ts';

const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
const doc = (name: string) => ({ name, blocks: [{ heading: name }, { text: 'Finished work.' }] });

test("Chief's recap reads the person's delivered work through crew_status", async () => {
  const { crew, db, done } = setup();
  crew.onboard('Umer');
  crew.recruit('scout', 'Scout', 'person');
  const dinner = crew.assign('scout', `two weeknight dinners ${call('crew_document', doc('Two simple weeknight dinners'))}`, 'chief').task;
  const papers = crew.assign('scout', `sort the paperwork ${call('crew_document', doc('Paperwork triage'))}`, 'chief').task;
  await settled(db, dinner);
  await settled(db, papers);
  assert.equal(task(db, dinner).state, 'done');
  assert.equal(task(db, papers).state, 'done');

  const recap = (await crew.post('chief', `Chief, give me our month in brief ${call('crew_status', {})}`))!.task;
  assert.equal(task(db, recap).bot, 'chief');
  await settled(db, recap);
  const key = `agent:m1:crewhouse:chief:${recap}`;
  const seen = (crew.runtime as any).transcript(key) ?? '';
  assert.match(seen, /crew_status/, 'the recap turn consults crew_status');
  assert.match(seen, /Two simple weeknight dinners/, 'crew_status carries the delivered dinner work');
  assert.match(seen, /Paperwork triage/, 'crew_status carries the delivered paperwork');
  const prompt = (crew.runtime as any).specOf(key)?.message ?? '';
  assert.doesNotMatch(prompt, /Finished work/, 'the finished record is on demand through the tool, not in every per-turn prompt');
  done();
});
