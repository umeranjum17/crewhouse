import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, settled } from './lab.ts';

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
