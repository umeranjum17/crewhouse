// The chat piece contract: one call, crew_piece, puts a line, card, form or picker in the chat, and the person's answer comes
// back as that same call's result, in the same turn. The stub engine, no network and no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../web/src/adapter.ts';
import type { StubRuntime } from '../src/stub-runtime.ts';
process.env.CREWHOUSE_HOLD_MS ??= '1500'; // a piece holds the call this long, then the turn parks
const { setup, settled, task, delegated, until } = await import('./lab.ts');

const call = (p: object) => `[tool crew_piece ${JSON.stringify(p)}]`;
const CARD = { kind: 'card', title: 'Keep Tuesday free?', text: 'The dentist can move.', yes: 'Keep it' };
const FORM = { kind: 'form', title: 'Where should the parcel go?', fields: [{ id: 'city', label: 'City' }, { id: 'size', label: 'Size', options: ['Small', 'Large'] }, { id: 'gift', label: 'A gift', tick: true }, { id: 'note', label: 'Note', optional: true }] };
const PICK = { kind: 'picker', title: 'Which day?', choices: [{ id: 'tue', label: 'Tuesday', note: 'after 3' }, { id: 'wed', label: 'Wednesday' }] };
const open = (db: any, title: string) => until(`the card “${title}”`, () => db.get("SELECT id FROM asks WHERE state = 'open' AND kind = 'piece' AND title = ?", title)).then(() => db.get("SELECT id FROM asks WHERE state = 'open' AND title = ?", title).id as number);
const said = (crew: any, db: any, id: number) => (crew.runtime as StubRuntime).transcript(task(db, id).session);

test('a card, a form and a picker each hand their answer back to the same turn, as a structured result', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer');
  const id = (crew as any).addTask('chief', [CARD, FORM, PICK].map(call).join(' '), 'person').task;

  await crew.answer(await open(db, CARD.title), { answer: 'allow', scope: 'once' });
  const form = await open(db, FORM.title);
  await assert.rejects(crew.answer(form, { answer: 'allow', fields: { size: 'Small' } }), /fill in City/);
  await assert.rejects(crew.answer(form, { answer: 'allow', fields: { city: 'Lahore', size: 'Huge' } }), /fill in Size/, 'a value off the list never reaches the bot');
  await crew.answer(form, { answer: 'allow', fields: { city: 'Lahore', size: 'Small', gift: true } });
  const pick = await open(db, PICK.title);
  await assert.rejects(crew.answer(pick, { answer: 'allow', pick: 'fri' }), /pick one of the choices/);
  await crew.answer(pick, { answer: 'allow', pick: 'tue' });
  await until('the job to finish', () => task(db, id).state === 'done');
  assert.equal(db.all("SELECT 1 FROM events WHERE kind = 'run.prompted' AND json_extract(data, '$.task') = ?", id).length, 1, 'one turn, never a new prompt');
  assert.deepEqual(said(crew, db, id).trim().split('\n').map((l: string) => JSON.parse(l.replace('crew_piece: ', ''))), [
    { answered: true },
    { answered: true, values: { city: 'Lahore', size: 'Small', gift: true, note: '' } },
    { answered: true, picked: { id: 'tue', label: 'Tuesday' } }]);
  const receipts = A.answeredReceipts(crew.snapshot()).map((r) => r.line.split(' · ')[0]);
  assert.deepEqual(receipts, ['Keep it: Keep Tuesday free?', 'City: Lahore, Size: Small, A gift: yes', 'Picked: Tuesday']);
  done();
});

test('a line is said with nothing to answer, and so is a kind crewd does not know', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer');
  const id = (crew as any).addTask('chief', `${call({ kind: 'line', title: 'The parcel left today.' })} ${call({ kind: 'slider', title: 'How warm?', text: 'Pick a number.' })}`, 'person').task;
  await settled(db, id);
  const lines = db.all("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot'").map((m: any) => m.text);
  assert.ok(lines.includes('The parcel left today.'));
  assert.ok(lines.includes('How warm?\nPick a number.'));
  assert.equal(db.get("SELECT count(*) AS n FROM asks WHERE kind = 'piece'")?.n, 0);
  assert.match(said(crew, db, id), /"shown":"line"/);
  done();
});

test('a helper asks through Chief, a no comes back as a no, and a parked piece keeps its answer for the next call', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer');
  crew.recruit('reel', 'Reel', 'person');
  const id = delegated(crew, 'reel', `${call(CARD)} ${call(PICK)}`).task;

  const card = await open(db, CARD.title), state = crew.snapshot(), c = A.cards(state).find((x) => x.id === card)!;
  assert.equal(c.helper, 'chief', 'only Chief asks the person');
  assert.equal(c.by, 'reel', 'the card still says who wants it');
  assert.equal(A.crew(state).find((h) => h.id === 'reel')!.status, 'Waiting for Chief');
  await crew.answer(card, { answer: 'deny' });

  const pick = await open(db, PICK.title);
  await until('the turn to park', () => db.get("SELECT 1 FROM events WHERE kind = 'ask.parked' AND json_extract(data, '$.ask') = ?", pick));
  await until('the parked reply', () => /"asked":true/.test(said(crew, db, id)));
  assert.match(said(crew, db, id), /"answered":false/);
  assert.equal(task(db, id).state, 'needs_you', 'a parked piece holds the job for the person');
  (crew as any).close('reel'); // as a restart leaves it: nothing is running, and the card stays open
  await crew.answer(pick, { answer: 'allow', pick: 'wed' });
  await until('the resumed call to read the answer', () => /"picked":\{"id":"wed","label":"Wednesday"\}/.test(said(crew, db, id)));
  assert.equal(db.get("SELECT count(*) AS n FROM asks WHERE kind = 'piece' AND title = ?", PICK.title)?.n, 1, 'the same call again finds the answer, and opens no second card');
  done();
});

test('a kind this app does not know yet stays plain words with one way out', () => {
  const state = { bots: [{ id: 'chief', display: 'Chief' }], tasks: [] };
  const c = A.card({ id: 9, kind: 'piece', bot: 'chief', title: 'How warm?', at: 1, detail: { bot: 'chief', piece: { kind: 'slider', text: 'Pick a number.' } } }, state);
  assert.equal(c.words, 'How warm?');
  assert.deepEqual(c.lines, ['Pick a number.']);
  assert.deepEqual(c.choices, [{ label: 'OK', body: { answer: 'deny' } }]);
});
