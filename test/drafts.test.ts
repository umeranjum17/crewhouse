import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, settled, until, release } from './lab.ts';

const call = (name: string, args: object) => `[tool ${name} ${JSON.stringify(args)}]`;

test('distinct drafts for the same place keep separate cards; the same words are offered once', async () => {
  const { crew, db, done } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Scribe', 'person');
  const draft = (path: string, content: string) => call('crew_write', { path, content })
    + call('crew_draft', { path, channel: 'post', to: 'my blog' });
  const first = 'Crewhouse helps with `drafts`.\n\nI use ChatGPT with GPT-5 and choose what to post.';
  const second = 'Crewhouse leaves me in charge.\n\nHere is another way to say it.';
  await settled(db, (await crew.post('scribe', draft('files/one.md', first)
    + draft('files/retry.md', first) + draft('files/two.md', second)))!.task);
  const cards = crew.snapshot().asks.filter((a: any) => a.kind === 'propose' && a.detail.draft);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((a: any) => a.detail.preview.body).sort(), [first, second].sort());
  assert.ok(cards.every((a: any) => a.detail.draft.to === 'my blog'));
  assert.equal(new Set(cards.map((a: any) => a.detail.draft.sha)).size, 2);
  done();
});

test('a draft link is https and short: anything else is an error and files no card', async () => {
  const { crew, db, done } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Scribe', 'person');
  const ask = async (link: string) => {
    const { task } = (await crew.post('scribe', call('crew_write', { path: 'files/d.md', content: 'Words for you.' })
      + call('crew_draft', { path: 'files/d.md', channel: 'text', to: 'Sara', link })))!;
    await settled(db, task);
    return task;
  };
  for (const bad of ['javascript:alert(1)', 'http://shop.example/refund', `https://shop.example/${'x'.repeat(495)}`]) {
    const t = await ask(bad);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE bot = 'scribe'")!.n, 0, `${bad.slice(0, 30)}: no card at all`);
    assert.match(String(db.get('SELECT result FROM tasks WHERE id = ?', t)?.result ?? ''),
      /error: a draft link must be an https address/, 'the model reads the real cause');
  }
  await ask('https://shop.example/refunds/98765');
  const card = db.get("SELECT * FROM asks WHERE bot = 'scribe' AND state = 'open'")!;
  assert.equal(JSON.parse(card.detail).draft.link, 'https://shop.example/refunds/98765', 'the card carries the link the person opens');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE bot = 'scribe'")!.n, 1);
  done();
});

test('what the person decided on drafts reaches the next job, in plain words', async () => {
  const { crew, db, done } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Scribe', 'person');
  for (const [to, how] of [['Sara', 'as written'], ['the dentist', 'after an edit'], ['the landlord', 'rejected']] as const) {
    const { task } = (await crew.post('scribe', `Draft it. ${call('crew_write', { path: `files/${to}.md`, content: `Hello ${to}.` })} `
      + call('crew_draft', { path: `files/${to}.md`, channel: 'text', to })))!;
    await until(`the draft for ${to}`, () => db.get("SELECT * FROM asks WHERE bot = 'scribe' AND kind = 'propose' AND state = 'open'"));
    const id = db.get("SELECT id FROM asks WHERE bot = 'scribe' AND kind = 'propose' AND state = 'open'")!.id;
    await crew.answer(id, how === 'rejected' ? { answer: 'deny' }
      : { answer: 'allow', scope: 'once', ...(how === 'after an edit' ? { text: `Hello ${to}. In my own words.` } : {}) });
    await settled(db, task);
  }
  const { task: next } = (await crew.post('scribe', 'Another note for the landlord. Write it fresh.'))!;
  await settled(db, next);
  const said = String((crew.runtime as any).specOf(`agent:m1:crewhouse:scribe:${next}`)?.message ?? '');
  const record = said.split('\n').find((l) => l.includes('already decided on drafts')) ?? '';
  assert.match(record, /Sara — approved as written/, 'an approved draft is on the record');
  assert.match(record, /the dentist — approved after they changed it/, 'an edit is recorded as theirs');
  assert.match(record, /the landlord — they said no/, 'a rejection is on the record too');
  assert.doesNotMatch(record.slice(12), /https|\{|json|\.ts|\bnull\b/i, 'the record is plain words, no machinery');
  done();
});

test('watch offers on the same host name each routine and keep each page', async () => {
  const { crew, db, done } = setup();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  const watch = (page: string, name?: string) => call('crew_routine', {
    when: 'every Monday 9:00', task: 'Tell me what changed', watch: `https://github.com/${page}`, name,
  });
  await settled(db, (await crew.post('scout', watch('one/feed', 'First feed')
    + watch('two/feed', 'Second feed') + watch('one/feed', 'First feed')))!.task);
  const cards = () => crew.snapshot().asks.filter((a: any) => a.detail.routine);
  assert.equal(cards().length, 2);
  for (const name of ['First feed', 'Second feed']) {
    const card = cards().find((a: any) => a.detail.routine.name === name)!;
    assert.ok(card);
    assert.ok(card.detail.preview.body.includes(`Keeps an eye on ${name}`));
    assert.ok(card.detail.words.includes(`Keeps an eye on ${name}`));
  }
  // Without names, the visible titles match: the page itself still distinguishes the offers.
  await settled(db, (await crew.post('scout', watch('three/feed') + watch('four/feed') + watch('three/feed')))!.task);
  assert.equal(cards().length, 4);
  assert.ok(cards().filter((a: any) => !a.detail.routine.name)
    .every((a: any) => a.detail.preview.body.includes('Keeps an eye on github.com')));
  done();
});
