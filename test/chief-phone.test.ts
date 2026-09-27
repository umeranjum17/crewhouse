import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './lab.ts';
import { asksForPhone, inlineHowTo } from '../src/crew.ts';
import { systemPrompt } from '../src/bots.ts';
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
