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

const DAY = (n: number) => { const t = new Date(); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const BUTTONS = { kind: 'buttons', title: 'When should the reminder go?', choices: [{ id: 'tom', label: 'Tomorrow at 9' }, { id: 'fri', label: 'Friday at 9' }] };
const DATE = { kind: 'date', title: 'Which day?', times: ['9:00', '10:30'] };
const SHEET = { kind: 'sheet', page: 'Refund policy', title: 'Read the refund policy?', text: 'About two minutes.', body: '## Returns\n\nWithin 30 days of delivery.' };
const LIST = { kind: 'list', title: 'Flights', text: 'These five leave first.', rows: [{ title: 'BA117', sub: 'Gate B32', link: 'https://www.ba.com/x' }, { title: 'EK202', link: 'http://insecure.example' }, { title: '' }] };

test('buttons, a date and a sheet answer the same turn; a list is said in the chat and asks nothing', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer');
  const id = (crew as any).addTask('chief', [LIST, BUTTONS, DATE, SHEET].map(call).join(' '), 'person').task;
  const buttons = await open(db, BUTTONS.title);
  assert.equal(db.get("SELECT count(*) AS n FROM asks WHERE kind = 'piece' AND title = 'Flights'")?.n, 0, 'a list waits for nothing');
  const row: any = db.get("SELECT text, ui FROM messages WHERE bot = 'chief' AND author = 'bot' AND ui IS NOT NULL");
  assert.equal(row.text, 'These five leave first.');
  assert.deepEqual(JSON.parse(row.ui).list.rows, [{ title: 'BA117', sub: 'Gate B32', link: 'https://www.ba.com/x' }, { title: 'EK202', sub: '' }], 'a link that is not https is dropped, a row with no title too');
  const line = A.lines(crew.botPage('chief'), 'chief', crew.snapshot()).find((l) => l.list)!, shown = line.list!;
  assert.deepEqual(shown.rows.map((r) => r.host ?? ''), ['ba.com', ''], 'a link shows its host');
  await assert.rejects(crew.answer(buttons, { answer: 'allow', pick: 'sat' }), /pick one of the choices/);
  await crew.answer(buttons, { answer: 'allow', pick: 'fri' });
  const date = await open(db, DATE.title);
  await assert.rejects(crew.answer(date, { answer: 'allow', day: DAY(-1), time: '9:00' }), /pick a day from today on/);
  await assert.rejects(crew.answer(date, { answer: 'allow', day: '2026-02-30', time: '9:00' }), /pick a day from today on/);
  await assert.rejects(crew.answer(date, { answer: 'allow', day: DAY(3) }), /pick one of the times/);
  await crew.answer(date, { answer: 'allow', day: DAY(3), time: '10:30' });
  const sheet = await open(db, SHEET.title), c = A.cards(crew.snapshot()).find((x) => x.id === sheet)!;
  assert.deepEqual(c.pieceUi, { kind: 'sheet', minutes: 1, page: 'Refund policy', parts: [{ head: 'Returns' }, { text: 'Within 30 days of delivery.' }] }, 'the sheet opens a page named in its own words, not the question');
  await crew.answer(sheet, { answer: 'allow' });
  await until('the job to finish', () => task(db, id).state === 'done');
  assert.deepEqual(said(crew, db, id).trim().split('\n').map((l: string) => JSON.parse(l.replace('crew_piece: ', ''))), [
    { ok: true, shown: 'list' },
    { answered: true, picked: { id: 'fri', label: 'Friday at 9' } },
    { answered: true, day: DAY(3), time: '10:30' },
    { answered: true }]);
  assert.deepEqual(A.answeredReceipts(crew.snapshot()).map((r) => r.line.split(' · ')[0]), ['Picked: Friday at 9', `Picked: ${new Date(`${DAY(3)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} at 10:30`, 'Got it: Read the refund policy?']);
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
