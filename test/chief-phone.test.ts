import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled } from './lab.ts';
import { asksForPhone, inlineHowTo } from '../src/crew.ts';
import { botDir, systemPrompt } from '../src/bots.ts';
import { phoneOffer, lines } from '../web/src/adapter.ts';

const phrases = ['pair my phone', 'pair my computer with you', 'connect my phone', 'add my phone', 'use crewhouse on my phone', 'install on my phone'];

test('Chief offers every phone phrasing to the person', async () => {
  const { crew, db, cfg } = setup();
  const offer = { qr: 'byokit-link:1:one-use-ticket', typed: '23456-789AB', expires: Date.now() + 120_000, urls: ['ws://127.0.0.1/link'] };
  let minted = 0;
  crew.phoneLink = { offer: async () => { minted++; return { ...offer, expires: Date.now() + 120_000 }; }, status: () => ({ asking: [] }) as any };
  assert.match(readFileSync(join(cfg.repoDir, 'templates/chief/AGENTS.md'), 'utf8'), /## About Crewhouse/);
  assert.match(systemPrompt(cfg, 'chief', true), /Settings > Phones > Add a phone/);
  crew.onboard('Owner');
  for (const phrase of phrases) {
    assert.equal(asksForPhone(phrase), true, phrase);
    await crew.post('chief', phrase, undefined);
    const page = crew.botPage('chief');
    assert.equal(page.phoneOffer.qr, offer.qr);
    assert.equal(page.phoneOffer.typed, offer.typed);
    assert.ok(page.phoneOffer.expires > Date.now());
    assert.equal(page.messages.at(-1)!.id, page.phoneOffer.message);
    assert.equal(page.messages.at(-1)!.text, 'Open Crewhouse on your phone and scan this, or type the code.');
    assert.equal(phoneOffer(page)?.message, page.messages.at(-1)!.id, 'phone card attaches to this reply');
    assert.ok(!JSON.stringify(page.messages).includes(offer.qr), 'ticket is not in chat text');
  }
  assert.equal(minted, phrases.length);
  const page = crew.botPage('chief');
  const renewed = await crew.refreshPhone(page.phoneOffer.message);
  assert.equal(renewed.message, page.phoneOffer.message);
  assert.notEqual(renewed.token, page.phoneOffer.token);
  await assert.rejects(crew.refreshPhone(0), /no longer showing/);
  assert.ok(!JSON.stringify(crew.snapshot()).includes(offer.qr), 'ticket never enters public state');
});

test('a Chief hand-off in a helper chat carries its task title, for the collapsed Chief asked line', async () => {
  const { crew, db } = setup();
  crew.onboard('Owner');
  crew.recruit('scribe', 'Scribe', 'system');
  const r = crew.assign('scribe', 'The person says: plan dinners for four.\nDone means: a plan document with the full cooking steps.', 'chief', undefined, 'Plan the dinners');
  await settled(db, r.task);
  const m = crew.botPage('scribe').messages.find((x: any) => x.author === 'chief')!;
  assert.equal(m.title, 'Plan the dinners');
  const [l] = lines({ messages: [m] }, 'scribe');
  assert.equal(l.text, 'Chief asked: Plan the dinners');
  assert.match(l.detail!, /Done means/);
});

test('a delivered video comes over in slices, and undelivered files stay closed', async () => {
  const { crew, db, cfg } = setup();
  crew.onboard('Owner');
  crew.recruit('reel', 'Reel', 'system');
  const r = crew.assign('reel', 'make a short demo', 'chief');
  await settled(db, r.task);
  mkdirSync(join(botDir(cfg, 'reel'), 'files'), { recursive: true });
  writeFileSync(join(botDir(cfg, 'reel'), 'files', 'demo.mp4'), Buffer.alloc(700_000, 7));
  db.event('file.delivered', 'reel', { task: r.task, path: 'files/demo.mp4', size: 700_000 });
  const first = await crew.fileSlice('reel', 'files/demo.mp4', 0);
  assert.equal(first.size, 700_000);
  assert.equal(Buffer.from(first.data, 'base64').length, 600_000, 'one link frame\'s worth at a time');
  assert.equal(first.more, true);
  const last = await crew.fileSlice('reel', 'files/demo.mp4', 600_000);
  assert.equal(last.more, false);
  assert.equal(Buffer.from(last.data, 'base64').length, 100_000);
  await assert.rejects(crew.fileSlice('reel', 'files/notes.txt', 0), /delivered to you/, 'only what was delivered, whatever it is');
});

test('delivered file slices preserve bytes, bounds and bot containment for every file kind', async () => {
  const { crew, db, cfg, root } = setup();
  crew.onboard('Owner');
  crew.recruit('scribe', 'Scribe', 'system');
  const { task } = crew.assign('scribe', 'Prepare the files', 'chief');
  await settled(db, task);
  const dir = join(botDir(cfg, 'scribe'), 'files');
  mkdirSync(dir, { recursive: true });
  const bytes = Buffer.from(Array.from({ length: 1_200_017 }, (_, i) => i % 251));
  for (const name of ['plan.docx', 'budget.xlsx', 'notes.txt', 'Other file.bin']) {
    const path = `files/${name}`;
    writeFileSync(join(dir, name), bytes);
    db.event('file.delivered', 'scribe', { task, path });
    const chunks = [];
    for (let after = 0; after < bytes.length; after += 600_000) {
      const slice = await crew.fileSlice('scribe', path, after);
      assert.equal(slice.size, bytes.length);
      assert.equal(slice.more, after + 600_000 < bytes.length);
      const chunk = Buffer.from(slice.data, 'base64');
      assert.ok(chunk.length <= 600_000);
      chunks.push(chunk);
    }
    assert.deepEqual(Buffer.concat(chunks), bytes, name);
    assert.deepEqual(await crew.fileSlice('scribe', path, bytes.length + 10), { size: bytes.length, more: false, data: '' });
    assert.equal((await crew.fileSlice('scribe', path, -1)).data, chunks[0].toString('base64'));
    await assert.rejects(crew.fileSlice('chief', path, 0), /delivered to you/);
  }
  await assert.rejects(crew.fileSlice('scribe', 'files/not-delivered.txt', 0), /delivered to you/);
  for (const path of ['files/../../outside.txt', 'files/missing.txt', 'files/directory', 'files/escape.txt'])
    db.event('file.delivered', 'scribe', { task, path });
  mkdirSync(join(dir, 'directory'));
  writeFileSync(join(root, 'outside.txt'), 'private');
  symlinkSync(join(root, 'outside.txt'), join(dir, 'escape.txt'));
  await assert.rejects(crew.fileSlice('scribe', 'files/../../outside.txt', 0), /outside/);
  for (const path of ['files/missing.txt', 'files/directory', 'files/escape.txt'])
    await assert.rejects(crew.fileSlice('scribe', path, 0), /no such file/);
});

test('Chief offers actions rather than directions for sign-in, apps and routines', async () => {
  const { crew, cfg } = setup();
  crew.onboard('Owner');
  assert.equal(inlineHowTo('how do I sign in to ChatGPT?'), 'signin');
  assert.equal(inlineHowTo('how do I connect Google Calendar?'), 'app');
  assert.equal(inlineHowTo('set a routine every weekday'), 'routine');
  for (const [request, reply] of [['how do I sign in to ChatGPT?', 'Sign in with ChatGPT.'], ['how do I connect Google Calendar?', 'Connect Google Calendar.']]) {
    await crew.post('chief', request);
    assert.equal(crew.botPage('chief').messages.at(-1)?.text, reply);
  }
  assert.ok(crew.snapshot().asks.some((a) => a.kind === 'connect' && a.detail.app === 'calendar'));
  assert.match(readFileSync(join(cfg.repoDir, 'templates/chief/AGENTS.md'), 'utf8'), /routine request offers its approval card/);
  assert.deepEqual(lines({ messages: [{ id: 1, author: 'bot', text: 'stub chief: done with "hi"' }] }, 'chief'), []);
});
