// The weekly tidy stays quiet on a fresh household: a refused collection review posts no
// "left untouched" message when the member has no learned skills to leave untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup as lab } from './lab.ts';

const said = (db: any) => db.all("SELECT text FROM messages WHERE bot = 'chief'").map((m: any) => m.text).join('\n');

test('a refused tidy posts nothing on a fresh household, and explains itself once there is learning', async () => {
  const { db, crew, done } = lab();
  crew.onboard('sir');
  const runtime = crew.runtime as any;
  runtime.runCollectionReview = async () => { throw new Error('the collection review is not enabled'); };
  runtime.learned = async () => [];
  await (crew as any).weeklyCuration();
  assert.doesNotMatch(said(db), /untouched/, 'a new household hears nothing about learned skills');
  assert.equal(db.all("SELECT * FROM events WHERE kind = 'learn.curated'").length, 1, 'the refusal is still recorded');
  runtime.learned = async () => [{ id: '1', skill: 'fare-check', at: Date.now(), state: 'applied' }];
  await (crew as any).weeklyCuration();
  assert.match(said(db), /untouched/, 'a household with learned skills hears why the tidy was skipped');
  done();
});
