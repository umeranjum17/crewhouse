// The watch jobs on Home: Scout listens for the person's name, watches the neighbours and writes the month in brief.
// All three are read-only promises that start only through their routine card, stay quiet on a quiet day, and say so
// when a watched page fails twice. The name watch is ready on the web alone; the briefs need the documents tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';

const { setup: lab, until, settled, release, lastSaid, task } = await import('./lab.ts');
const { toolBin } = await import('../src/tools.ts');

function setup(markitdown = false) {
  const { db, crew, cfg, done } = lab();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  if (markitdown) {
    mkdirSync(toolBin(cfg), { recursive: true });
    writeFileSync(join(toolBin(cfg), 'markitdown'), '#!/bin/sh\necho "fake $0 $*"\n');
    chmodSync(join(toolBin(cfg), 'markitdown'), 0o755);
  }
  return { db, crew, cfg, done };
}
const name = (crew: any) => crew.snapshot().ideas.find((i: any) => /your name and anything you told me/.test(i.promise));
const neighbours = (crew: any) => crew.snapshot().ideas.find((i: any) => /watch their pages and newsletters/.test(i.promise));
const month = (crew: any) => crew.snapshot().ideas.find((i: any) => /short story of what happened/.test(i.promise));
const offer = (crew: any, card: string) => (crew as any).post('scout', `set this up for me ${card}`);

test('Home lists the three watches ready on the web alone; extra ready promises queue behind the six-row cap', () => {
  const { crew, cfg, done } = setup();
  assert.equal(name(crew).bot, 'scout');
  assert.equal(name(crew).group, 'life', 'an everyday job, beside the money ones');
  assert.deepEqual(name(crew).needs, [], 'listening needs no account: the row is ready to hand over');
  assert.deepEqual(neighbours(crew).needs, [], 'their pages are public; the brief is a document crewd writes itself');

  // The month brief is also a promise Scout can keep — but Scout's ready promises already fill the six-row cap, so it
  // queues until the list has room. The cap is engine-side (docs/ui-contract.md); this PR changes no engine logic.
  assert.equal(month(crew), undefined, 'queued by the cap');

  // With the documents tool ready too, the PDF promise returns and takes the slot the month brief was waiting for.
  mkdirSync(toolBin(cfg), { recursive: true });
  writeFileSync(join(toolBin(cfg), 'markitdown'), '#!/bin/sh\necho "fake $0 $*"\n');
  chmodSync(join(toolBin(cfg), 'markitdown'), 0o755);
  const ideas = crew.snapshot().ideas;
  assert.ok(name(crew), 'the name watch keeps its place on the list');
  assert.equal(ideas.filter((i: any) => !i.needs.length).length, 6, 'the cap holds at six runnable promises');
  assert.equal(ideas.find((i: any) => /watch their pages and newsletters|short story/.test(i.promise)), undefined,
    'the briefs wait for the list to have room');
  done();
});

test('the name watch starts only through the routine card, and a quiet day costs nothing', async () => {
  const { db, crew, done } = setup();
  let up = true;
  const site = createServer((_q, res) => {
    if (!up) return void res.writeHead(500).end();
    res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body><p>Quiet page. Nothing about Ada today.</p></body></html>');
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(site.address() as any).port}/`;
  try {
    const { task: t } = await offer(crew, `[tool crew_routine ${JSON.stringify({ when: 'every day 9:00', watch: url,
      task: 'listen for Ada Ali, Ada, and @adaali; say one source-linked line when something shows up' })}]`);
    await until('the card', () => db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'"));
    const card = db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'")!;
    const preview = JSON.parse(card.detail).preview.body as string;
    assert.match(preview, /Keeps an eye on 127\.0\.0\.1/, 'the page it reads, by host only');
    assert.match(preview, /Tells you only when the page changes/, 'a watch is a quiet check-in');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM routines WHERE bot = 'scout'")!.n, 0, 'nothing runs until the person says yes');
    await crew.answer(card.id, { answer: 'allow' });
    await settled(db, t);
    const r = db.get("SELECT * FROM routines WHERE bot = 'scout'")!;
    assert.equal(r.quiet, 1, 'the watch stays quiet');
    assert.equal(r.member, 1, 'and it belongs to the person the job was for');

    // A quiet day: crewd reads the page itself, nothing changed, no AI, no line. (History is newest first.)
    const looks = (n: number) => until(`look ${n}`, () => crew.routines().find((x: any) => x.id === r.id)!.history.length >= n);
    const last = () => crew.routines().find((x: any) => x.id === r.id)!.history[0].watch;
    const prompts = () => db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'run.prompted'")!.n;
    const before = prompts(); // the offer itself ran once; a quiet watch adds no more
    const saidAtStart = db.get("SELECT COUNT(*) AS n FROM messages WHERE bot = 'scout' AND author = 'bot'")!.n;
    crew.runRoutine(r.id);
    await looks(1);
    assert.equal(last(), 'started');
    crew.runRoutine(r.id);
    await looks(2);
    assert.equal(last(), 'same');
    assert.equal(prompts(), before, 'nothing changed, so nothing was woken and no AI was used');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM messages WHERE bot = 'scout' AND author = 'bot'")!.n, saidAtStart,
      'no line lands on a quiet day');

    // A page that fails twice speaks up — crewd's own line — and says so again when it is back.
    const lines = () => db.all("SELECT text FROM messages WHERE bot = 'scout' AND author = 'bot'").slice(saidAtStart).map((m: any) => m.text);
    up = false;
    crew.runRoutine(r.id);
    await looks(3);
    assert.equal(last(), 'unreachable');
    assert.deepEqual(lines(), [], 'one failure stays quiet');
    crew.runRoutine(r.id);
    await looks(4);
    assert.equal(last(), 'unreachable', 'the second miss in a row');
    assert.equal(lines().length, 1, 'one line for the outage, not one per run');
    assert.match(lines()[0], /twice now/, 'the failure, said plainly, after the second miss');
    up = true;
    crew.runRoutine(r.id);
    await looks(5);
    assert.equal(last(), 'same');
    assert.equal(lines().length, 2);
    assert.match(lines()[1], /opens again/, 'and it says when the page is back');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'alert'")!.n, 2, 'both lines reach the phone');
    done();
  } finally { site.close(); }
});

test('a watch drawn with JavaScript is offered as a quiet browser look, and starts through its card too', async () => {
  const { db, crew, done } = setup();
  const { task: t } = await offer(crew, `[tool crew_routine ${JSON.stringify({ when: 'every day 9:00', quiet: true,
    task: 'open the thread list in your own browser and look for Ada Ali; say one source-linked line when something shows up' })}]`);
  await until('the card', () => db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'"));
  const preview = JSON.parse(db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'")!.detail).preview.body as string;
  assert.match(preview, /Tells you only when something changed/);
  assert.doesNotMatch(preview, /Keeps an eye on/, 'no page to watch: it is the helper opening the page itself');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM routines WHERE bot = 'scout'")!.n, 0);
  await crew.answer(db.get("SELECT id FROM asks WHERE kind = 'propose' AND state = 'open'")!.id, { answer: 'allow' });
  await settled(db, t);
  const r = db.get("SELECT * FROM routines WHERE bot = 'scout'")!;
  assert.equal(r.quiet, 1);
  assert.match(r.body, /your own browser/);
  done();
});

test('the neighbours and the month in brief start through their cards: the brief speaks, it is not a quiet check-in', async () => {
  const { db, crew, done } = setup();
  const week = `[tool crew_routine ${JSON.stringify({ when: 'every Monday 8:00', quiet: true,
    task: 'look at their pages; if something changed, write the weekly brief: what changed, what it means, what to do about it, as a document' })}]`;
  const { task: t1 } = await offer(crew, `watch the other bakery ${week}`);
  await until('the neighbours card', () => db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'"));
  const weekPreview = JSON.parse(db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'")!.detail).preview.body as string;
  assert.match(weekPreview, /Tells you only when something changed/, 'a weekly brief lands only when something changed');
  await crew.answer(db.get("SELECT id FROM asks WHERE kind = 'propose' AND state = 'open'")!.id, { answer: 'allow' });
  await settled(db, t1);
  assert.equal(db.get("SELECT quiet FROM routines WHERE bot = 'scout'")!.quiet, 1);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE kind = 'propose' AND state = 'open'")!.n, 0, 'the first card is answered');

  const monthly = `[tool crew_routine ${JSON.stringify({ when: 'every Monday 7:00', name: 'The month in brief',
    task: 'read the month back over what the household cares about and write the brief with a link for every claim, as a document' })}]`;
  const { task: t2 } = await offer(crew, `write me the month in brief every month ${monthly}`);
  await until('the brief card', () => db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'"));
  const briefCard = db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'")!;
  const briefPreview = JSON.parse(briefCard.detail).preview.body as string;
  assert.match(briefPreview, /Tells you each time it runs/, 'a brief that arrives silently is not a brief');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM routines WHERE bot = 'scout' AND quiet = 0")!.n, 0, 'and nothing runs before the yes');
  await crew.answer(briefCard.id, { answer: 'allow' });
  await settled(db, t2);
  const r = db.get("SELECT * FROM routines WHERE bot = 'scout' ORDER BY id DESC LIMIT 1")!;
  assert.equal(r.quiet, 0, 'the brief speaks every time');
  assert.match(r.body, /link for every claim/);
  done();
});
