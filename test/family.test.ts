import { signInApp, setUpGoogle } from './connect-fixture.ts';
// The family skills on Home: Scout sorts the paper (letters and forms read, what's due on the calendar, replies only
// ever drafts) and plans the meals (the list, the shop day, the cart only through its checkout card). The machinery is
// the money jobs' own: draft cards, the form card that names every line, and the checkout card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { setup: lab, until, settled, release, lastSaid, task } = await import('./lab.ts');
const { toolBin } = await import('../src/tools.ts');
const state = (db: any, id: number) => task(db, id).state;

const fakeBin = (dir: string, ...names: string[]) => {
  mkdirSync(dir, { recursive: true });
  for (const b of names) { writeFileSync(join(dir, b), '#!/bin/sh\necho "fake $0 $*"\n'); chmodSync(join(dir, b), 0o755); }
};

function setup() {
  const { db, crew, cfg, done } = lab();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  fakeBin(toolBin(cfg), 'markitdown'); // the documents tool is ready on this machine
  return { db, crew, cfg, done };
}
const paper = (crew: any) => crew.snapshot().ideas.find((i: any) => /letters and forms/.test(i.promise));
const meals = (crew: any) => crew.snapshot().ideas.find((i: any) => /seven dinners/.test(i.promise));
const house = (crew: any) => setUpGoogle(crew.connections);
const connect = async (crew: any, ...ids: string[]) => { for (const id of ids) await signInApp(crew.connections, id); };

test('Home lists the family desk and the meals beside the money ones, each saying what it waits on', async () => {
  const { crew, cfg, done } = setup();
  assert.equal(paper(crew).bot, 'scout');
  assert.equal(paper(crew).group, 'life', 'an everyday job, beside the money ones');
  assert.deepEqual(paper(crew).needs, ['Google'], 'the mail and the calendar are the desk: without Google it says so');
  assert.equal(meals(crew).group, 'life');
  assert.deepEqual(meals(crew).needs, [], 'recipes and prices are read without an account, so the row is ready to hand over');
  await house(crew);
  assert.deepEqual(paper(crew).needs, ['Gmail', 'Google Calendar'], 'Google is on; now it waits on this person’s own apps');
  await connect(crew, 'gmail');
  assert.deepEqual(paper(crew).needs, ['Google Calendar']);
  await connect(crew, 'gmail', 'calendar');
  assert.deepEqual(paper(crew).needs, [], 'connected: the desk can be handed over');
  const ready = crew.snapshot().ideas;
  assert.ok(ready.slice(0, 6).some((i: any) => /letters and forms/.test(i.promise)), 'a job ready to hand over counts against the six');
  assert.ok(ready.slice(0, 6).some((i: any) => /seven dinners/.test(i.promise)));
  assert.match(meals(crew).promise, /you approve it like any purchase/, 'the cart is in the promise, priced as a purchase');
  done();
});

const reply = 'Hello, the signed trip form is in Ayaan’s bag this morning. He takes the packed-lunch option, and I can walk with the group if you are still short of adults.\\n\\nThank you,\\nUmer';

test('a reply to the school is a draft card: the yes approves it, nothing is sent, and the job says so', async () => {
  const { db, crew, done } = setup();
  const { task: t } = (await crew.assign('scout', 'The school wants the trip form back. Sort it: the reply on a card in front of me, and ask permission before anything more. '
    + `[tool crew_write {"path":"files/reply-trip-form.md","content":"${reply}"}] `
    + '[tool crew_draft {"path":"files/reply-trip-form.md","channel":"email","subject":"Ayaan’s trip form — Friday","to":"the school office"}] '
    + '[tool crew_outcome {"worked": true, "seen": "The reply to the school office is a draft on your card; posting it is yours."}]', 'chief'))!;
  await until('working', () => crew.sessionOf('scout'));
  await until('the draft card', () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND kind = 'propose' AND state = 'open'"));
  const ask = db.get("SELECT * FROM asks WHERE bot = 'scout' AND kind = 'propose' AND state = 'open'")!;
  assert.match(ask.title, /wrote your email/);
  assert.doesNotMatch(ask.title, /post it yourself/);
  const d = JSON.parse(ask.detail);
  assert.equal(d.draft.to, 'the school office');
  assert.match(d.preview.body, /trip form/, 'the card shows the whole reply before any yes');
  const view = crew.snapshot().asks.find((a: any) => a.id === ask.id)!;
  assert.equal(view.detail.yes, 'Approve', 'the yes approves the draft; it is never a send');
  await crew.answer(ask.id, { answer: 'allow' });
  await release(crew, 'scout', 'The reply is a draft on your card, and the form goes back in the bag today; posting the reply is yours.');
  await settled(db, t);
  assert.ok(db.get("SELECT 1 FROM events WHERE kind = 'draft.approved' AND json_extract(data, '$.task') = ?", t), 'the yes is kept as an approval, nothing more');
  assert.equal(state(db, t), 'done', 'a sorted desk is a finished job: the draft was the deliverable');
  assert.match(lastSaid(db, 'scout')!, /draft on your card/, 'the last line names the draft, never a send');
  assert.doesNotMatch(lastSaid(db, 'scout')!, /\bI (have )?(replied|sent)\b|sent it/i);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'mail.sent'")!.n, 0, 'nothing went out');
  assert.equal((await (crew as any).gate('scout', 'mail', { args: ['send'] })).block, true, 'the mail tool cannot send at all');
  done();
});

const tripForm = `### Page state
- Page URL: https://school.example/forms/trip
- Page Snapshot:
\`\`\`yaml
- main [ref=e1]:
  - heading "Friday trip — parent form" [level=1] [ref=e2]
  - text: "One form per child, please, by Thursday."
  - textbox "Pupil's full name" [ref=e5]
  - textbox "Parent or carer" [ref=e6]
  - textbox "Lunch: packed or school" [ref=e7]
  - button "Submit form" [ref=e9]
\`\`\``;

test('a school form remains a local draft; legacy card metadata names every line but cannot submit', async () => {
  const { db, crew, done } = setup();
  const t = crew.assign('scout', 'ask permission: prepare the school trip form', 'chief').task;
  await until('working', () => crew.sessionOf('scout'));
  const live = crew.sessionOf('scout')!;
  live.page = 'https://school.example/forms/trip'; live.snapshot = tripForm;
  for (const [ref, value] of [['e5', 'Ayaan Ali'], ['e6', 'Umer Ali'], ['e7', 'packed']]) {
    const result = await (crew as any).gate('scout', 'browser', { args: ['fill', ref, value] });
    assert.equal(result.block, true); assert.match(result.reason, /unavailable/);
  }
  live.fills = [{ label: "Pupil's full name", value: 'Ayaan Ali' }, { label: 'Parent or carer', value: 'Umer Ali' }, { label: 'Lunch: packed or school', value: 'packed' }];
  const e = (crew as any).press('scout', { kind: 'send', words: 'Submit the form' }, { args: ['click', 'e9'] });
  assert.equal(e.words, 'Scout wants to fill in 3 lines on the claim form at school.example.');
  assert.deepEqual(e.preview.body.split('\n'), ["Pupil's full name: Ayaan Ali", 'Parent or carer: Umer Ali', 'Lunch: packed or school: packed']);
  assert.equal((await (crew as any).gate('scout', 'browser', { args: ['click', 'e9'] })).block, true);
  const id = (crew as any).openAsk('scout', db.get('SELECT * FROM tasks WHERE id = ?', t), e.words, { effect: 'send', fill: true, preview: e.preview });
  assert.equal(crew.snapshot().asks.find(a => a.id === id)!.detail.always, undefined);
  await assert.rejects(crew.answer(id, { answer: 'allow' }), /unavailable/);
  await crew.answer(id, { answer: 'deny' });
  await settled(db, t);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'run.allowed' AND json_extract(data, '$.task') = ?", t)!.n, 0);
  done();
});

const basket = `### Page state
- Page URL: https://www.grocer.example/cart
- Page Snapshot:
\`\`\`yaml
- main [ref=e1]:
  - heading "Your basket" [level=1] [ref=e2]
  - listitem "Basmati rice 10 lb" [ref=e3]: $8.90
  - listitem "Whole milk (1 gal) x2" [ref=e4]: $5.20
  - listitem "Garlic, 2 kg" [ref=e5]: $4.20
  - text: "Item total: $18.30"
  - button "Place order" [ref=e8]
\`\`\``;

test('the meals checkout retains page-derived prices but uncovered purchase execution stays unavailable', async () => {
  const { db, crew, done } = setup();
  const t = crew.assign('scout', 'ask permission: prepare the grocery basket', 'chief').task;
  await until('working', () => crew.sessionOf('scout'));
  const live = crew.sessionOf('scout')!; live.page = 'https://www.grocer.example/cart'; live.snapshot = basket;
  const order = (crew as any).order('scout', { kind: 'spend', words: 'Place order' });
  assert.equal(order.effect.words, 'Scout wants to place this order at grocer.example: Basmati rice 10 lb, Whole milk (1 gal) x2, Garlic, 2 kg. Total $18.30.');
  assert.equal(order.effect.preview.head, 'The order at grocer.example');
  assert.match(order.effect.preview.body, /Total \$18\.30/);
  assert.equal(order.effect.key, undefined);
  const blocked = await (crew as any).gate('scout', 'browser', { args: ['click', 'e8'] });
  assert.equal(blocked.block, true); assert.match(blocked.reason, /unavailable/);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE bot = 'scout' AND state = 'open'")!.n, 0);
  await release(crew, 'scout', 'I prepared the basket; it was not ordered.'); await settled(db, t);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'money.spent'")!.n, 0);
  done();
});
