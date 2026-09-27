import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled } from './lab.ts';
import { asksForPhone, inlineHowTo } from '../src/crew.ts';
import { botDir, systemPrompt } from '../src/bots.ts';
import { phoneOffer, lines } from '../web/src/adapter.ts';

const phrases = ['pair my phone', 'pair my computer with you', 'connect my phone', 'add my phone', 'use crewhouse on my phone', 'install on my phone'];

test('Chief offers every phone phrasing to the owner, never another member', async () => {
  const { crew, db, cfg } = setup();
  const offer = { qr: 'byokit-link:1:one-use-ticket', typed: '23456-789AB', expires: Date.now() + 120_000, urls: ['ws://127.0.0.1/link'] };
  let minted = 0;
  crew.phoneLink = { offer: async () => { minted++; return { ...offer, expires: Date.now() + 120_000 }; }, status: () => ({ asking: [] }) as any };
  assert.match(readFileSync(join(cfg.repoDir, 'templates/chief/AGENTS.md'), 'utf8'), /## About Crewhouse/);
  assert.match(systemPrompt(cfg, 'chief', true), /Settings > Phones > Add a phone/);
  crew.onboard('Owner');
  const member = crew.addMember('Another person');
  crew.onboard('Another person', member.id);
  for (const phrase of phrases) {
    assert.equal(asksForPhone(phrase), true, phrase);
    await crew.post('chief', phrase, undefined, 1);
    const page = crew.botPage('chief', 1);
    assert.equal(page.phoneOffer.qr, offer.qr);
    assert.equal(page.phoneOffer.typed, offer.typed);
    assert.ok(page.phoneOffer.expires > Date.now());
    assert.equal(page.messages.at(-1)!.id, page.phoneOffer.message);
    assert.equal(page.messages.at(-1)!.text, 'Open Crewhouse on your phone and scan this, or type the code.');
    assert.equal(phoneOffer(page, 1)?.message, page.messages.at(-1)!.id, 'phone card attaches to this reply');
    assert.equal(phoneOffer(page, member.id), null, 'another member never gets the card');
    assert.ok(!JSON.stringify(page.messages).includes(offer.qr), 'ticket is not in chat text');
    await crew.post('chief', phrase, undefined, member.id);
    const other = crew.botPage('chief', member.id);
    assert.equal(other.phoneOffer, null);
    assert.match(other.messages.at(-1)!.text, /Ask the owner/);
    assert.ok(!JSON.stringify(other).includes(offer.qr));
  }
  assert.equal(minted, phrases.length);
  const page = crew.botPage('chief', 1);
  const renewed = await crew.refreshPhone(page.phoneOffer.message, 1);
  assert.equal(renewed.message, page.phoneOffer.message);
  assert.notEqual(renewed.token, page.phoneOffer.token);
  await assert.rejects(crew.refreshPhone(page.phoneOffer.message, member.id), /owner/);
  await assert.rejects(crew.refreshPhone(0, 1), /no longer showing/);
  assert.ok(!JSON.stringify(crew.snapshot(member.id)).includes(offer.qr), 'ticket never enters public state');
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

test('a delivered video comes over in slices for its member, and nobody else', async () => {
  const { crew, db, cfg } = setup();
  crew.onboard('Owner');
  crew.recruit('reel', 'Reel', 'system');
  const r = crew.assign('reel', 'make a short demo', 'chief');
  await settled(db, r.task);
  mkdirSync(join(botDir(cfg, 'reel'), 'files'), { recursive: true });
  writeFileSync(join(botDir(cfg, 'reel'), 'files', 'demo.mp4'), Buffer.alloc(700_000, 7));
  db.event('file.delivered', 'reel', { task: r.task, path: 'files/demo.mp4', size: 700_000 });
  const first = await crew.videoSlice('reel', 'files/demo.mp4', 0, 1);
  assert.equal(first.size, 700_000);
  assert.equal(Buffer.from(first.data, 'base64').length, 600_000, 'one link frame\'s worth at a time');
  assert.equal(first.more, true);
  const last = await crew.videoSlice('reel', 'files/demo.mp4', 600_000, 1);
  assert.equal(last.more, false);
  assert.equal(Buffer.from(last.data, 'base64').length, 100_000);
  await assert.rejects(crew.videoSlice('reel', 'files/demo.mp4', 0, 2), /delivered to you/);
  await assert.rejects(crew.videoSlice('reel', 'files/notes.txt', 0, 1), /delivered to you/, 'only what was delivered, whatever it is');
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
