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
  const { task: t } = (await crew.post('scout', 'The school wants the trip form back. Sort it: the reply on a card in front of me, and ask permission before anything more. '
    + `[tool crew_write {"path":"files/reply-trip-form.md","content":"${reply}"}] `
    + '[tool crew_draft {"path":"files/reply-trip-form.md","channel":"email","subject":"Ayaan’s trip form — Friday","to":"the school office"}] '
    + '[tool crew_outcome {"worked": true, "seen": "The reply to the school office is a draft on your card; posting it is yours."}]'))!;
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

test('the receipt for an answered reply reads later: what, where, why, and that nothing was sent', async () => {
  const { db, crew, done } = setup();
  const { task: t } = (await crew.post('scout', 'The school wants the trip form back. Draft the reply on a card, with why it matters. '
    + `[tool crew_write {"path":"files/reply-trip-form.md","content":"${reply}"}] `
    + '[tool crew_remember {"text":"Answer the school, not the shops"}] '
    + '[tool crew_draft {"path":"files/reply-trip-form.md","channel":"email","subject":"Ayaan’s trip form — Friday","to":"the school office","why":"Answer the school, not the shops"}] '
    + '[tool crew_outcome {"worked": true, "seen": "The reply is a draft on your card."}]'))!;
  await until('the draft card', () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND kind = 'propose' AND state = 'open'"));
  const ask = db.get("SELECT * FROM asks WHERE bot = 'scout' AND kind = 'propose' AND state = 'open'")!;
  assert.equal(JSON.parse(ask.detail).draft.why, 'Answer the school, not the shops', 'the card carries the line the person is remembered saying, so they read their own words before the yes');
  // The person changes the words before the yes: their version is what the receipt quotes.
  const mine = `${reply}\n\n(Friday is fine for me too.)`;
  await crew.answer(ask.id, { answer: 'allow', text: mine });
  await settled(db, t);
  const got = JSON.parse(db.get("SELECT * FROM events WHERE kind = 'draft.approved' AND json_extract(data, '$.task') = ?", t)!.data);
  assert.equal(got.to, 'the school office');
  assert.equal(got.subject, 'Ayaan’s trip form — Friday');
  assert.equal(got.why, 'Answer the school, not the shops');
  assert.equal(got.edited, true, 'the receipt knows the person changed the words');
  assert.match(got.body, /Friday is fine for me too/, 'the receipt carries their words, not the helper’s');
  assert.ok(crew.botPage('scout').trail.some((e: any) => e.kind === 'draft.approved'), 'it is in the trail, so it is readable after the fact');
  const { receipt } = await import('../web/src/adapter.ts');
  const line = receipt('draft.approved', got);
  assert.match(line, /school office/);
  assert.match(line, /nothing was sent/);
  assert.match(line, /because you said “Answer the school, not the shops”/);
  assert.doesNotMatch(line, /files\/|\.md\b|claude|token/i, 'plain words a person can read weeks later');
  assert.match(receipt('draft.rejected', got), /Didn't send that email/, 'a no is a receipt too');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'mail.sent'")!.n, 0, 'still nothing went out');
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

test('a school form on its site: the lines are free to type, and the submit card names the form and every line', async () => {
  const { db, crew, done } = setup();
  const { task: t } = (await crew.post('scout', 'ask permission: fill the school trip form'))!;
  await until('working', () => crew.sessionOf('scout'));
  const live = (crew as any).live.get('scout');
  live.page = 'https://school.example/forms/trip';
  live.snapshot = tripForm;
  for (const [ref, value] of [['e5', 'Ayaan Ali'], ['e6', 'Umer Ali'], ['e7', 'packed']] as const) {
    assert.equal(await (crew as any).gate('scout', 'browser', { args: ['fill', ref, value] }), undefined, 'typing a line asks nothing by itself');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE bot = 'scout' AND state = 'open'")!.n, 0);
  }
  const gated = (crew as any).gate('scout', 'browser', { args: ['click', 'e9'] });
  await until('asked', () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'"));
  const ask = db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'")!;
  const card = crew.snapshot().asks.find((a: any) => a.id === ask.id)!;
  assert.equal(card.detail.effect, 'send');
  assert.equal(card.detail.fill, true, 'a form card fills, it does not press');
  assert.equal(card.detail.words, 'Scout wants to fill in 3 lines on the claim form at school.example.');
  assert.equal(card.detail.preview.head, 'What Scout will fill in on school.example');
  assert.deepEqual(card.detail.preview.body.split('\n'), ["Pupil's full name: Ayaan Ali", 'Parent or carer: Umer Ali', 'Lunch: packed or school: packed'],
    'every line, the label as the page writes it and the value from the call');
  assert.equal(JSON.parse(ask.detail).key, undefined, 'submitting carries no key: asked every time');
  assert.equal(card.detail.always, undefined, 'and the card offers no Always OK');
  await crew.answer(ask.id, { answer: 'allow' });
  assert.equal(await gated, undefined, 'the yes submits the form');
  await release(crew, 'scout', 'I submitted the trip form on the school’s page.');
  await settled(db, t);
  assert.equal(state(db, t), 'unsure', 'it acted in the world and never saw the school receive it');
  assert.match(lastSaid(db, 'scout')!, /Not sure it worked:/);
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

test('the meals cart goes to the checkout only through its card: the order as the page writes it, asked every time', async () => {
  const { db, crew, done } = setup();
  const { task: t } = (await crew.post('scout', 'ask permission: place the grocery order for this week’s list'))!;
  await until('working', () => crew.sessionOf('scout'));
  const live = (crew as any).live.get('scout');
  live.page = 'https://www.grocer.example/cart';
  live.snapshot = basket;
  const open = () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'");
  const buy = (crew as any).gate('scout', 'browser', { args: ['click', 'e8'] });
  await until('asked', open);
  assert.equal(state(db, t), 'needs_you', 'nothing is bought while the card waits');
  const card = crew.snapshot().asks.find((a: any) => a.id === open()!.id)!;
  assert.equal(card.detail.effect, 'spend');
  assert.equal(card.detail.words,
    'Scout wants to place this order at grocer.example: Basmati rice 10 lb, Whole milk (1 gal) x2, Garlic, 2 kg. Total $18.30.',
    'the items and the total, read from the page, never the model’s words');
  assert.equal(card.detail.preview.head, 'The order at grocer.example');
  assert.match(card.detail.preview.body, /Basmati rice 10 lb/);
  assert.match(card.detail.preview.body, /Total \$18\.30/);
  assert.doesNotMatch(JSON.stringify(card.detail), /cart/, 'the host only, never the page address');
  assert.equal(JSON.parse(open()!.detail).key, undefined, 'a checkout carries no key: asked every time');
  assert.equal(card.detail.always, undefined, 'so the card offers no Always OK');
  await crew.answer(open()!.id, { answer: 'deny' });
  assert.equal((await buy).block, true, 'not now buys nothing');
  await release(crew, 'scout', 'I left the basket at the checkout; placing the order is yours.');
  await settled(db, t);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'run.allowed' AND json_extract(data, '$.task') = ?", t)!.n, 0,
    'the no kept the order unplaced');
  assert.doesNotMatch(lastSaid(db, 'scout')!, /placed|ordered/i, 'nothing says the order went in');
  done();
});

const payment = `### Page state
- Page URL: https://www.grocer.example/checkout/payment
- Page Snapshot:
\`\`\`yaml
- main [ref=e1]:
  - heading "Pay now" [level=1] [ref=e2]
  - textbox "Card number" [ref=e3]: 4242 4242 4242 4242
  - button "Place order" [ref=e4]
\`\`\``;

test('one yes buys that whole order: the payment page and the click that places it ask nothing more', async () => {
  const { db, crew, done } = setup();
  const { task: t } = (await crew.post('scout', 'ask permission: place the grocery order for this week’s list'))!;
  crew.setMoneyCap(100); // the person's own limit, above both totals, so the second card is about the total and nothing else
  await until('working', () => crew.sessionOf('scout'));
  const live = (crew as any).live.get('scout');
  const open = () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'");
  live.page = 'https://www.grocer.example/cart';
  live.snapshot = basket;
  const toPay = (crew as any).gate('scout', 'browser', { args: ['click', 'e8'] });
  await until('asked', open);
  assert.match(crew.snapshot().asks.find((a: any) => a.id === open()!.id)!.detail.preview.body, /Total \$18\.30/);
  await crew.answer(open()!.id, { answer: 'allow' });
  assert.equal(await toPay, undefined, 'the yes carries the order to the payment page');

  // The payment page shows no total of its own: the same order, further along, so the click that places it is free.
  live.page = 'https://www.grocer.example/checkout/payment';
  live.snapshot = payment;
  assert.equal(await (crew as any).gate('scout', 'browser', { args: ['click', 'e4'] }), undefined, 'placing it is the same order');
  assert.equal(open(), undefined, 'one purchase, one card');

  // A different total on the same shop is a different order: that asks again.
  live.page = 'https://www.grocer.example/cart';
  live.snapshot = basket.replace('$18.30', '$24.10');
  const again = (crew as any).gate('scout', 'browser', { args: ['click', 'e8'] });
  await until('asked again', open);
  assert.match(crew.snapshot().asks.find((a: any) => a.id === open()!.id)!.detail.words, /Total \$24\.10/, 'more money asks again');
  await crew.answer(open()!.id, { answer: 'deny' });
  assert.equal((await again).block, true);
  await release(crew, 'scout', 'I placed the first order.');
  await settled(db, t);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'money.spent' AND json_extract(data, '$.amount') = 18.3", )!.n, 1,
    'the money was counted once, when the person said yes');
  done();
});
