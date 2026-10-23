// A second helper checks the scout's answer before the person sees it: the card names the checked answer and what the check found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, until, task, delegated } from './lab.ts';

const said = (db: any, id: number) => db.all("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ?", id).map((m: any) => m.text as string);

test('a scout job waits for Verifier Vera, and Chief says which answer was checked and what she found', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer');
  const rae = crew.recruit('scout', undefined, 'person');
  const first = (crew as any).addTask(rae.id, 'Find out what a ticket costs. Source: example.com', 'chief').task;
  await until('Vera checked it', () => task(db, first).result?.includes('checked by Verifier Vera'));
  const vera = crew.bot('verifier-vera')!, check = db.get("SELECT * FROM tasks WHERE bot = ?", vera.id)!;
  assert.equal(check.origin, 'chief');
  assert.match(check.body, /Challenge this answer and cite what you checked[\s\S]*Find out what a ticket costs[\s\S]*The answer from Research Rae:\nstub/);
  const lines = said(db, first);
  assert.equal(lines.length, 1, 'one card line, after the check, never the unchecked answer alone');
  assert.match(lines[0], /Research Rae's answer was checked by Verifier Vera\. Holds: the sources the answer names say what it says\./);
  assert.deepEqual(said(db, check.id), [], 'the check itself is not relayed, and is not checked in turn');
  assert.equal(db.all("SELECT 1 FROM events WHERE kind = 'check.started'").length, 1);
  done();
});

test('a check that finds a wrong figure says so on the card, and a team job is left alone', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer');
  const rae = crew.recruit('scout', undefined, 'person');
  const first = (crew as any).addTask(rae.id, 'Find out the fare [bad-figure]', 'chief').task;
  await until('the finding', () => said(db, first).length);
  assert.match(said(db, first)[0], /checked by Verifier Vera\. Does not hold: one figure is not in the source the answer names\./);
  const parent = (crew as any).addTask('chief', 'Plan the trip', 'person').task;
  const team = delegated(crew, rae.id, 'Find the best fare', undefined, parent).task;
  await until('the team job done', () => task(db, team).state === 'done');
  assert.equal(db.all("SELECT 1 FROM events WHERE kind = 'check.started'").length, 1, 'only the first job was checked');
  done();
});
