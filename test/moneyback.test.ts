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
  assert.match(unclaimed(crew).ask, /money owed to us/);
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
    + `[tool write {"path":"files/claim-pa-88231.md","content":"${pack}"}] `
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
