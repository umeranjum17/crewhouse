// The first money-back job: Scout's price-drop promise on Home, the watch that sees the price go under what the person
// paid, the claim press that asks with the page's own words, and no "money back" without the shop's page as evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';

process.env.CREWHOUSE_HOLD_MS ??= '5000'; // the press is answered by hand here; give the test room to reach the card
const { setup: lab, settled, release, until, lastSaid } = await import('./lab.ts');
const { toolBin } = await import('../src/tools.ts');
const task = (db: any, id: number) => db.get('SELECT * FROM tasks WHERE id = ?', id);
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
const row = (crew: any) => crew.snapshot().ideas.find((i: any) => /claim the money back/.test(i.promise));

const unclaimed = (crew: any) => crew.snapshot().ideas.find((i: any) => /unclaimed-money registers/.test(i.promise));

test('Home lists the unclaimed-money job too: it waits on nothing, because searching needs no sign-in', async () => {
  const { crew, done } = setup();
  assert.equal(unclaimed(crew).group, 'money', 'money back leads the list');
  assert.deepEqual(unclaimed(crew).needs, [], 'the registers are read without an account, so the row is ready to hand over');
  assert.match(unclaimed(crew).ask, /money owed to me/);
  done();
});

test('Home lists the price-drop job, and says what it waits on rather than dead-ending', async () => {
  const { crew, cfg, done } = setup();
  assert.match(row(crew).ask, /claim the difference back/);
  assert.equal(row(crew).group, 'money', 'money back leads the list');
  assert.deepEqual(row(crew).needs, ['Google'], 'Google is not on for the house: the row says what it needs first');
  writeFileSync(join(cfg.stateDir, 'apps.json'), JSON.stringify({ google: { id: 'crew.apps', secret: 'pasted' } }), { mode: 0o600 });
  assert.deepEqual(row(crew).needs, ['Gmail'], 'Google is on; now it waits on this person’s own Gmail');
  mkdirSync(join(cfg.stateDir, 'people', '1'), { recursive: true });
  writeFileSync(join(cfg.stateDir, 'people', '1', 'connections.json'), JSON.stringify({ gmail: { access: 'tok', expires: Date.now() + 3_600_000 } }));
  assert.deepEqual(row(crew).needs, [], 'connected: the job can be handed over');

  // The six-row cap counts the jobs they can hand over now; a job waiting on an app rides along beside them.
  const file = join(cfg.crewDir, 'bots', 'scout', 'bot.json');
  const many = Array.from({ length: 7 }, (_, n) => ({ needs: ['web'], promise: `Promise number ${n}.`, ask: `do number ${n} ` }));
  const waiting = { needs: ['notion'], promise: 'I’ll claim the money back when the price drops.', ask: 'watch my price ' };
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ideas: [...many, waiting] }, null, 2));
  const ideas = crew.snapshot().ideas;
  assert.equal(ideas.filter((i: any) => /Promise number/.test(i.promise)).length, 6, 'the cap holds at six runnable promises');
  assert.deepEqual(ideas.find((i: any) => /price drops/.test(i.promise))?.needs, ['Notion'], 'and the waiting one rides along, saying what it needs');
  done();
});

test('a helper asks for its own check-in: a watch when the page can be read, a quiet browser look when it cannot', async () => {
  const { db, crew, done } = setup();
  const offer = (extra: string) => (crew as any).post('scout', `keep an eye on it ${extra}`);
  const watchCard = `[tool crew_routine ${JSON.stringify({ when: 'every day 9:00', watch: 'https://shop.example/item', task: 'tell me when it goes under $999.00, the price paid' })}]`;
  const { task } = await offer(watchCard);
  await until('the card', () => db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'"));
  let card = db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'")!;
  assert.match(JSON.parse(card.detail).preview.body, /Keeps an eye on shop\.example/);
  assert.match(JSON.parse(card.detail).preview.body, /Tells you only when the page changes/);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM routines WHERE bot = 'scout' AND kind = 'task'")!.n, 0, 'nothing runs until the person says yes');
  await crew.answer(card.id, { answer: 'allow' });
  await settled(db, task);
  let r = db.get("SELECT * FROM routines WHERE bot = 'scout' AND kind = 'task'")!;
  assert.equal(r.quiet, 1, 'a watch is a quiet check-in');
  assert.equal(r.member, 1, 'and it belongs to the person the job was for');

  // The price is drawn with JavaScript, so the watch can't see it: the same helper asks for a quiet routine it reads itself.
  const quietCard = `[tool crew_routine ${JSON.stringify({ when: 'every day 9:00', quiet: true, task: 'open the page in your own browser and read the price; tell the person only if it went under $999.00' })}]`;
  const before = db.get("SELECT MAX(id) AS id FROM asks")!.id;
  const second = await offer(quietCard);
  await until('the second card', () => db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open' AND id > ?", before));
  card = db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open' AND id > ? ORDER BY id DESC LIMIT 1", before)!;
  assert.match(JSON.parse(card.detail).preview.body, /Tells you only when something changed/);
  assert.doesNotMatch(JSON.parse(card.detail).preview.body, /Keeps an eye on/, 'no page to watch: it is the helper opening the page itself');
  await crew.answer(card.id, { answer: 'allow' });
  await settled(db, second.task);
  r = db.get("SELECT * FROM routines WHERE bot = 'scout' AND kind = 'task' AND watch IS NULL")!;
  assert.equal(r.quiet, 1, 'a browser check-in speaks up only when something changed');
  assert.match(r.body, /your own browser/);
  done();
});

const register = `### Page state
- Page URL: https://unclaimed.example/claim/PA-88231
- Page Snapshot:
\`\`\`yaml
- main [ref=e1]:
  - heading "Claim for property PA-88231" [level=1] [ref=e2]
  - text: "Wages — Acme Corp — $1,240.00"
  - textbox "Owner's full name" [ref=e5]
  - textbox "Address the money was owed at" [ref=e6]
  - textbox "Email for this claim" [ref=e7]
  - button "Submit claim" [ref=e9]
\`\`\``;

test('filing a claim: the lines are free to type, and the submit card carries every one of them, signed in or not', async () => {
  const { db, crew, done } = setup();
  const { task: t } = (await crew.post('scout', 'ask permission: file the claim for property PA-88231'))!;
  await until('working', () => crew.sessionOf('scout'));
  const live = (crew as any).live.get('scout');
  live.page = 'https://unclaimed.example/claim/PA-88231';
  live.snapshot = register;
  for (const [ref, value] of [['e5', 'Ada Lovelace'], ['e6', '12 Lovelace Lane'], ['e7', 'ada@example.net']] as const) {
    assert.equal(await (crew as any).gate('scout', 'browser', { args: ['fill', ref, value] }), undefined, 'typing a line asks nothing by itself');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE bot = 'scout' AND state = 'open'")!.n, 0);
  }
  const gated = (crew as any).gate('scout', 'browser', { args: ['click', 'e9'] });
  await until('asked', () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'"));
  const ask = db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'")!;
  const card = crew.snapshot().asks.find((a: any) => a.id === ask.id)!;
  assert.equal(card.detail.effect, 'send');
  assert.equal(card.detail.fill, true, 'a form card fills, it does not press');
  assert.equal(card.detail.words, 'Scout wants to fill in 3 lines on the claim form at unclaimed.example.', 'no sign-in is claimed where there is none');
  assert.equal(card.detail.preview.head, 'What Scout will fill in on unclaimed.example');
  assert.deepEqual(card.detail.preview.body.split('\n'), ["Owner's full name: Ada Lovelace", 'Address the money was owed at: 12 Lovelace Lane', 'Email for this claim: ada@example.net'],
    'every line, the label as the page writes it and the value from the call');
  assert.equal(JSON.parse(ask.detail).key, undefined, 'filing carries no key: asked every time');
  assert.equal(card.detail.always, undefined, 'and the card offers no Always OK');
  await crew.answer(ask.id, { answer: 'allow' });
  assert.equal(await gated, undefined, 'the yes files the claim');
  await release(crew, 'scout', 'I filled the claim from the pack and the register’s page said it was received.');
  await settled(db, t);
  assert.equal(state(db, t), 'unsure', 'it acted in the world and never saw the state pay out');
  assert.match(lastSaid(db, 'scout')!, /Not sure it worked:/);
  assert.doesNotMatch(lastSaid(db, 'scout')!, /\bfiled\b|submitted/i, 'nothing says the claim was filed');
  done();
});

test('where the person signed the bot in, each line asks on its own card, and the words say the sign-in', async () => {
  const { db, crew, cfg, done } = setup();
  const file = join(cfg.crewDir, 'bots', 'scout', 'bot.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), signedIn: ['unclaimed.example'] }, null, 2));
  const { task: t } = (await crew.post('scout', 'ask permission: file the claim for property PA-88231'))!;
  await until('working', () => crew.sessionOf('scout'));
  const live = (crew as any).live.get('scout');
  live.page = 'https://unclaimed.example/claim/PA-88231';
  live.snapshot = register;
  const gated = (crew as any).gate('scout', 'browser', { args: ['fill', 'e5', 'Ada Lovelace'] });
  await until('asked', () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'"));
  const ask = db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'")!;
  const card = crew.snapshot().asks.find((a: any) => a.id === ask.id)!;
  assert.equal(card.detail.words, 'Scout wants to fill “Owner\'s full name” on unclaimed.example, a site you signed it in to.');
  assert.equal(card.detail.fill, true, 'a line card fills, it does not press');
  assert.equal(card.detail.preview.body, "Owner's full name: Ada Lovelace");
  assert.equal(JSON.parse(ask.detail).key, undefined);
  await crew.answer(ask.id, { answer: 'allow' });
  assert.equal(await gated, undefined);
  await release(crew, 'scout', 'I filled the first line; the rest waits for your OK, one card each.');
  await settled(db, t);
  done();
});

test('a claim that asks for an upload or a signature stops with the pack ready and never says filed', async () => {
  const { db, crew, done } = setup();
  const pack = 'Claim pack for property PA-88231: wages held by Acme Corp, $1,240.00, owed at 12 Lovelace Lane. Proof the register asks for: a passport. The form stops at Upload ID — that line is the person\'s.';
  const { task: t } = (await crew.post('scout', 'Get the claim for PA-88231 ready and ask permission before anything more. '
    + `[tool crew_write {"path":"files/claim-pa-88231.md","content":"${pack}"}] `
    + '[tool crew_deliver {"path":"files/claim-pa-88231.md"}] '
    + '[tool crew_outcome {"worked": false, "seen": "I stopped where the form asks for a passport upload. The pack is ready in files/claim-pa-88231.md; the upload line is yours to do."}]'))!;
  await until('working', () => crew.sessionOf('scout'));
  await release(crew, 'scout', 'The claim needs a passport upload, so I stopped with the pack ready; the upload line is yours.');
  await settled(db, t);
  assert.equal(state(db, t), 'unsure', 'stopped at the upload is not a claim filed');
  assert.match(task(db, t).result!, /pack is ready/, 'the exact line to act on, in the job’s own words');
  assert.ok(db.get("SELECT 1 FROM events WHERE kind = 'file.delivered' AND json_extract(data, '$.task') = ?", t), 'the pack is delivered');
  assert.match(lastSaid(db, 'scout')!, /Not sure it worked: .*pack is ready/, 'the job says what is left, in crewd’s own unsure words');
  assert.doesNotMatch(lastSaid(db, 'scout')!, /\bfiled\b/i, 'nothing says the claim was filed');
  done();
});

const shop = `### Page state
- Page URL: https://www.shop.example/order/98765/price-adjustment
- Page Snapshot:
\`\`\`yaml
- main [ref=e1]:
  - heading "Espresso machine" [level=1] [ref=e2]
  - text: "Paid on 12 March: $999.00"
  - text: "Today from this shop: $949.00"
  - text: "Item total: $949.00"
  - button "Request price adjustment" [ref=e7]
\`\`\``;

test('the watch sees the price go under what they paid; the claim press asks with the page’s own words, and the job ends not sure', async () => {
  let price = '$999.00';
  const site = createServer((_q, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(
    `<html><body><h1>Espresso machine</h1><p>Price today: ${price}</p></body></html>`));
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(site.address() as any).port}/item`;
  const { db, crew, cfg, done } = setup();
  try {
    // The person signed Scout in to the shop, and left an old standing answer for it: neither counts for a press.
    const file = join(cfg.crewDir, 'bots', 'scout', 'bot.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), signedIn: ['shop.example'], allow: ['send:shop.example'] }, null, 2));

    const r = crew.addRoutine({ bot: 'scout', schedule: 'every hour', watch: url,
      task: 'ask permission: tell me when it goes under $999.00, the price paid on 12 March' }, 'person');
    crew.runRoutine(r.id);
    await until('the first look', () => crew.routines().find((x) => x.id === r.id)!.history[0]?.watch === 'started');
    price = '$949.00';
    crew.runRoutine(r.id);
    await until('the price fell', () => crew.routines().find((x) => x.id === r.id)!.history[0]?.watch === 'changed');
    const t = crew.routines().find((x) => x.id === r.id)!.history[0]!.task!;
    assert.match(task(db, t).body, /Before: .*\$999\.00.*\nNow: .*\$949\.00/, 'the reading is compared with what they paid');
    await until('working', () => crew.sessionOf('scout'));

    const live = (crew as any).live.get('scout');
    live.page = 'https://www.shop.example/order/98765/price-adjustment';
    live.snapshot = shop;
    const open = () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'");
    const press = (crew as any).gate('scout', 'browser', { args: ['click', 'e7'] });
    await until('asked', open);
    const card = crew.snapshot().asks.find((a: any) => a.id === open()!.id)!;
    assert.equal(card.detail.effect, 'send');
    assert.equal(card.detail.words, 'Scout wants to press “Request price adjustment” on shop.example, a site you signed it in to. The page shows $949.00.');
    assert.equal(card.detail.preview.head, 'What Scout will press on shop.example');
    assert.match(card.detail.preview.body, /Paid on 12 March: \$999\.00\nToday from this shop: \$949\.00\nItem total: \$949\.00\nRequest price adjustment/);
    assert.match(card.detail.preview.body, /^You'd get \$50\.00 back\.\n/, "what they get back, from the page's two prices, first: the preview clamps");
    assert.doesNotMatch(JSON.stringify(card.detail), /98765|price-adjustment/, 'the host only, never the page address');
    assert.equal(JSON.parse(open()!.detail).key, undefined, 'a press carries no key: there is no standing answer for it');
    assert.equal(card.detail.always, undefined, 'so the card offers no “Always OK”');

    await crew.answer(open()!.id, { answer: 'allow' });
    assert.equal(await press, undefined, 'the yes lets the press through');
    await release(crew, 'scout', 'I pressed Request price adjustment on the shop’s page.');
    await settled(db, t);
    assert.equal(state(db, t), 'unsure', 'it acted in the world and never saw the money arrive');
    assert.match(lastSaid(db, 'chief')!, /Scout isn't sure .* worked/);
    assert.doesNotMatch(lastSaid(db, 'chief')!, /money back|refund|paid you/i, 'nothing says the money came back');
  } finally { site.close(); }
  done();
});

test('a press the page cannot name still asks, in the plain sentence', async () => {
  const { db, crew, cfg, done } = setup();
  const file = join(cfg.crewDir, 'bots', 'scout', 'bot.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), signedIn: ['shop.example'] }, null, 2));
  const { task: t } = (await crew.post('scout', 'ask permission: claim it'))!;
  await until('working', () => crew.sessionOf('scout'));
  const live = (crew as any).live.get('scout');
  live.page = 'https://www.shop.example/orders';
  live.snapshot = shop;
  const gated = (crew as any).gate('scout', 'browser', { args: ['click', 'button.primary'] });
  await until('asked', () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'"));
  assert.equal(db.get("SELECT title FROM asks WHERE bot = 'scout' AND state = 'open'")!.title, 'Scout wants to act as you on shop.example, a site you signed it in to.');
  await crew.answer(db.get("SELECT id FROM asks WHERE bot = 'scout' AND state = 'open'")!.id, { answer: 'deny' });
  assert.equal((await gated).block, true, 'not now keeps the press unpressed');

  // A page that never writes what they paid: the card names the button and says nothing about money.
  const first = db.get("SELECT MAX(id) AS id FROM asks")!.id;
  live.snapshot = shop.replace('Paid on 12 March: $999.00', 'Order 98765');
  const named = (crew as any).gate('scout', 'browser', { args: ['click', 'e7'] });
  await until('the named press', () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open' AND id > ?", first));
  const shown = crew.snapshot().asks.find((a: any) => a.id === db.get("SELECT MAX(id) AS id FROM asks WHERE state = 'open'")!.id)!;
  assert.match(shown.detail.preview.body, /Request price adjustment/, 'the button, as the page writes it');
  assert.doesNotMatch(JSON.stringify(shown.detail), /\bback\b|refund|save/i, 'one price only: the card says nothing about money');
  await crew.answer(shown.id, { answer: 'deny' });
  assert.equal((await named).block, true);
  await release(crew, 'scout', 'Not without the OK.');
  await settled(db, t);
  done();
});

// ---- the return-and-chase job: the same Home list, the same press card, a chase that is only ever a draft ----

const returns = (crew: any) => crew.snapshot().ideas.find((i: any) => /return this and get the refund/.test(i.ask));

const order = `### Page state
- Page URL: https://www.shop.example/orders/98765/return
- Page Snapshot:
\`\`\`yaml
- main [ref=e1]:
  - heading "Order 98765" [level=1] [ref=e2]
  - text: "Espresso machine — delivered 12 May"
  - text: "Returns are free within 30 days. Starting a return books a collection and tells the shop to expect the item."
  - button "Start return" [ref=e8]
\`\`\``;

test('Home lists the return job beside the other two: the web is enough, and every step says it asks first', async () => {
  const { crew, done } = setup();
  assert.equal(returns(crew).group, 'money', 'money back leads the list');
  assert.deepEqual(returns(crew).needs, [], 'a guest return waits on nothing: the shop page is read without an account');
  assert.match(returns(crew).promise, /Every step asks you first, on its own card/);
  assert.match(returns(crew).ask, /return this and get the refund/);
  done();
});

test('starting a return: the press asks first, on a card naming the button, the site and what it changes', async () => {
  const { db, crew, cfg, done } = setup();
  const file = join(cfg.crewDir, 'bots', 'scout', 'bot.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), signedIn: ['shop.example'] }, null, 2));
  const { task: t } = (await crew.post('scout', 'ask permission: start the return for order 98765'))!;
  await until('working', () => crew.sessionOf('scout'));
  const live = (crew as any).live.get('scout');
  live.page = 'https://www.shop.example/orders/98765/return';
  live.snapshot = order;
  const open = () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'");
  const press = (crew as any).gate('scout', 'browser', { args: ['click', 'e8'] });
  await until('asked', open);
  assert.equal(state(db, t), 'needs_you', 'the return is not started while the card waits');
  const card = crew.snapshot().asks.find((a: any) => a.id === open()!.id)!;
  assert.equal(card.detail.effect, 'send');
  assert.equal(card.detail.press, true, 'acting on a site, never a message ready to send');
  assert.equal(card.detail.words, 'Scout wants to press “Start return” on shop.example, a site you signed it in to.');
  assert.equal(card.detail.preview.head, 'What Scout will press on shop.example');
  assert.match(card.detail.preview.body, /Returns are free within 30 days/, "what it changes, in the page's own words");
  assert.match(card.detail.preview.body, /Start return/, 'the button, as the page writes it');
  assert.equal(JSON.parse(open()!.detail).key, undefined, 'a press carries no key: asked every time');
  assert.equal(card.detail.always, undefined, 'so the card offers no Always OK');
  await crew.answer(open()!.id, { answer: 'allow' });
  assert.equal(await press, undefined, 'the yes starts the return');

  // The next press on the same page is its own card again: no standing answer for acting as the person.
  const again = (crew as any).gate('scout', 'browser', { args: ['click', 'e8'] });
  await until('asked again', open);
  assert.notEqual(crew.snapshot().asks.find((a: any) => a.id === open()!.id), card, 'a new card, not the old one');
  await crew.answer(open()!.id, { answer: 'deny' });
  assert.equal((await again).block, true, 'the second yes was only ever for the first press');
  await release(crew, 'scout', 'The return is started; the rest waits on its own cards.');
  await settled(db, t);
  done();
});

test('the chase email is a draft in the person\u2019s name: the yes records the approval, and nothing is sent', async () => {
  const { db, crew, done } = setup();
  const chase = 'Subject: Order 98765 — returned 16 May, no refund yet.\n\nHello, my return reached you on 16 May, inside your own 30-day window. The order page still shows no refund. Please confirm the payment. Regards,';
  const { task: t } = (await crew.post('scout', 'The shop is past its own window. Write the chase email, put it in front of me, and ask permission before anything more. '
    + `[tool crew_write {"path":"files/chase-order-98765.md","content":"${chase.replace(/\n/g, '\\n')}"}] `
    + '[tool crew_draft {"path":"files/chase-order-98765.md","to":"the shop\u2019s support inbox"}] '
    + '[tool crew_outcome {"worked": false, "seen": "The chase email is a draft on your card; reading it and sending it is yours."}]'))!;
  await until('working', () => crew.sessionOf('scout'));
  await until('the draft card', () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND kind = 'propose' AND state = 'open'"));
  const ask = db.get("SELECT * FROM asks WHERE bot = 'scout' AND kind = 'propose' AND state = 'open'")!;
  assert.match(ask.title, /drafted something for the shop.s support inbox/);
  assert.match(ask.title, /Nothing is sent: you post it yourself/);
  const d = JSON.parse(ask.detail);
  assert.equal(d.draft.to, 'the shop\u2019s support inbox');
  assert.match(d.preview.body, /Order 98765/, 'the card shows the whole draft before any yes');
  const view = crew.snapshot().asks.find((a: any) => a.id === ask.id)!;
  assert.equal(view.detail.yes, 'Approve', 'the yes approves the draft; it is never a send');
  await crew.answer(ask.id, { answer: 'allow' });
  await release(crew, 'scout', 'The chase email is a draft on your card; sending it is yours.');
  await settled(db, t);
  assert.ok(db.get("SELECT 1 FROM events WHERE kind = 'draft.approved' AND json_extract(data, '$.task') = ?", t), 'the yes is kept as an approval, nothing more');
  assert.equal(state(db, t), 'unsure', 'a drafted chase is not a sent one: the job is not sure');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'mail.sent'")!.n, 0, 'nothing went out');
  assert.equal((await (crew as any).gate('scout', 'mail', { args: ['send'] })).block, true, 'the mail tool cannot send at all');
  done();
});

test('the order page not saying refunded ends the chase not sure, whatever else it says', async () => {
  const { db, crew, done } = setup();
  const { task: t } = (await crew.post('scout', 'ask permission: check the order page for order 98765 and tell me whether the refund has landed. '
    + '[tool crew_outcome {"worked": false, "seen": "The shop\u2019s order page says Return received and shows no refund, so I can\u2019t say the money is on its way."}]'))!;
  await until('working', () => crew.sessionOf('scout'));
  await release(crew, 'scout', 'The order page says Return received and shows no refund. I can\u2019t say the money is on its way.');
  await settled(db, t);
  assert.equal(state(db, t), 'unsure', 'without the page saying so, the job is not sure');
  assert.match(lastSaid(db, 'scout')!, /Not sure it worked: .*Return received/);
  assert.doesNotMatch(lastSaid(db, 'scout')!, /refund (is|has|was) (here|arrived|issued|on its way)|refunded|money is back/i,
    'the page never said refunded, so nothing does');
  done();
});

// ---- the renewal catch: the same Home list, the warning days ahead, a cancellation that is only ever a draft ----

const renewal = (crew: any) => crew.snapshot().ideas.find((i: any) => /renewed without me hearing/.test(i.ask));

const plan = `### Page state
- Page URL: https://www.stream.example/account/plan
- Page Snapshot:
\`\`\`yaml
- main [ref=e1]:
  - heading "Your plan" [level=1] [ref=e2]
  - text: "Family plan — renews 14 June"
  - text: "$18.99 monthly, charged to the card ending 4421"
  - button "Cancel subscription" [ref=e9]
\`\`\``;

test('Home lists the renewal job with the money-back three, and says what it waits on instead of dead-ending', async () => {
  const { crew, cfg, done } = setup();
  assert.equal(renewal(crew).group, 'money', 'money back leads the list');
  assert.match(renewal(crew).promise, /have the cancellation email ready/, 'the promise is a ready draft, never a cancellation already made');
  assert.match(renewal(crew).promise, /Every step asks you first, on its own card/);
  assert.deepEqual(renewal(crew).needs, ['Google'], 'Google is not on for the house: the row says what it needs first');
  writeFileSync(join(cfg.stateDir, 'apps.json'), JSON.stringify({ google: { id: 'crew.apps', secret: 'pasted' } }), { mode: 0o600 });
  assert.deepEqual(renewal(crew).needs, ['Gmail'], 'Google is on; now it waits on this person’s own Gmail');
  mkdirSync(join(cfg.stateDir, 'people', '1'), { recursive: true });
  writeFileSync(join(cfg.stateDir, 'people', '1', 'connections.json'), JSON.stringify({ gmail: { access: 'tok', expires: Date.now() + 3_600_000 } }));
  assert.deepEqual(renewal(crew).needs, [], 'Gmail connected: the job can be handed over');
  done();
});

test('a renewal caught ahead of the bill: the warning plus a cancellation email that stays a draft', async () => {
  const { db, crew, done } = setup();
  const letter = 'Subject: Family plan — please cancel before 14 June\n\nHello, my Family plan renews on 14 June at $18.99. Please cancel it from that date and confirm in writing that nothing further will be charged to my card. Regards, Umer';
  const { task: t } = (await crew.post('scout', 'ask permission: my streaming plan renews 14 June, write the cancellation and put it in front of me. '
    + `[tool crew_write {"path":"files/cancel-family-plan.md","content":"${letter.replace(/\n/g, '\\n')}"}] `
    + '[tool crew_draft {"path":"files/cancel-family-plan.md","to":"the streaming service’s support inbox"}] '
    + '[tool crew_outcome {"worked": false, "seen": "Your Family plan renews 14 June at $18.99, ten days ahead; the cancellation is a draft on your card, so reading it and sending it is yours."}]'))!;
  await until('working', () => crew.sessionOf('scout'));
  await until('the draft card', () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND kind = 'propose' AND state = 'open'"));
  const ask = db.get("SELECT * FROM asks WHERE bot = 'scout' AND kind = 'propose' AND state = 'open'")!;
  assert.match(ask.title, /drafted something for the streaming service.s support inbox/);
  assert.match(ask.title, /Nothing is sent: you post it yourself/);
  const d = JSON.parse(ask.detail);
  assert.match(d.preview.body, /renews on 14 June at \$18\.99/, 'the card holds the letter ahead of any yes');
  assert.match(d.preview.body, /confirm in writing/, 'it asks for the line that protects the person');
  const view = crew.snapshot().asks.find((a: any) => a.id === ask.id)!;
  assert.equal(view.detail.yes, 'Approve', 'the yes approves the draft; it is never a send');
  await crew.answer(ask.id, { answer: 'allow' });
  await release(crew, 'scout', 'Your plan renews 14 June at $18.99 — ten days ahead, so you hear it now; the cancellation email is a draft on your card.');
  await settled(db, t);
  assert.match(lastSaid(db, 'scout')!, /renews 14 June at \$18\.99/, 'the warning names the day and the money');
  assert.doesNotMatch(lastSaid(db, 'scout')!, /\bcancelled\b|no longer charged|you saved/i, 'a drafted cancellation is never reported as one made');
  assert.ok(db.get("SELECT 1 FROM events WHERE kind = 'draft.approved' AND json_extract(data, '$.task') = ?", t), 'the yes is kept as an approval, nothing more');
  assert.equal(state(db, t), 'unsure', 'nothing in the world was seen to change: the job is not sure');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'mail.sent'")!.n, 0, 'nothing went out');
  assert.equal((await (crew as any).gate('scout', 'mail', { args: ['send'] })).block, true, 'the mail tool cannot send at all');
  done();
});

test('cancelling inside the account is its own card every time, naming the button and what the page says', async () => {
  const { db, crew, cfg, done } = setup();
  const file = join(cfg.crewDir, 'bots', 'scout', 'bot.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), signedIn: ['stream.example'], allow: ['send:stream.example'] }, null, 2));
  const { task: t } = (await crew.post('scout', 'ask permission: cancel my streaming plan in my account'))!;
  await until('working', () => crew.sessionOf('scout'));
  const live = (crew as any).live.get('scout');
  live.page = 'https://www.stream.example/account/plan';
  live.snapshot = plan;
  const open = () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'");
  const cancel = (crew as any).gate('scout', 'browser', { args: ['click', 'e9'] });
  await until('asked', open);
  assert.equal(state(db, t), 'needs_you', 'nothing is cancelled while the card waits');
  const card = crew.snapshot().asks.find((a: any) => a.id === open()!.id)!;
  assert.equal(card.detail.effect, 'send');
  assert.equal(card.detail.press, true, 'acting on the account, never a message ready to send');
  assert.equal(card.detail.words, 'Scout wants to press “Cancel subscription” on stream.example, a site you signed it in to.');
  assert.equal(card.detail.preview.head, 'What Scout will press on stream.example');
  assert.match(card.detail.preview.body, /Family plan — renews 14 June/, "what it changes, in the page's own words");
  assert.match(card.detail.preview.body, /Cancel subscription$/, 'the button, as the page writes it');
  assert.equal(JSON.parse(open()!.detail).key, undefined, 'a cancellation carries no key: there is no standing answer for it');
  assert.equal(card.detail.always, undefined, 'so the card offers no Always OK, however friendly the site');
  await crew.answer(open()!.id, { answer: 'deny' });
  assert.equal((await cancel).block, true, 'not now keeps the plan running');

  // The person's word alone never cancels: the next press is a fresh card, asked again on the same page.
  const again = (crew as any).gate('scout', 'browser', { args: ['click', 'e9'] });
  await until('asked again', open);
  assert.notEqual(crew.snapshot().asks.find((a: any) => a.id === open()!.id)!.id, card.id, 'a new card, not the old one');
  await crew.answer(open()!.id, { answer: 'allow' });
  assert.equal(await again, undefined, 'the card’s yes is the only thing that presses');
  await release(crew, 'scout', 'I pressed Cancel subscription on your account page; the page has to say it stopped.');
  await settled(db, t);
  assert.equal(state(db, t), 'unsure', 'it acted in the world and never saw the plan cancelled');
  assert.doesNotMatch(lastSaid(db, 'scout')!, /\bcancelled\b.*(?:✓|done)|you.*(saved|stopped paying)/i, 'no claim that the plan is gone');
  done();
});
