// Connect apps: one sign-in through the engine's own Composio OAuth, on the stub engine (no account, no network). The
// stand-in sign-in finishes at once; the failed path is forced by the test. Nothing here proves a connected app works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, until } from './lab.ts';
import { effectOf } from '../src/policy.ts';

test('Connect apps: the person signs in once and the state turns on; a failed callback says so in plain words', async () => {
  const s = setup();
  const runtime = s.crew.runtime as any;
  assert.deepEqual(s.crew.composio.status(), { state: 'off' });

  const opened = await s.crew.composio.connect();
  assert.match(opened.url ?? '', /^https:\/\/connect\.composio\.dev\//, 'the page the person opens is the engine\'s own');
  await until('Composio signed in', () => s.crew.composio.status().state === 'on');
  assert.equal(s.crew.composio.on(), true, 'the on state survives a restart: it is stored, not held in memory');

  await s.crew.composio.disconnect();
  assert.deepEqual(s.crew.composio.status(), { state: 'off' });

  // The engine's callback fails: the sheet gets the plain words, never the engine's error text.
  runtime.composioDone = async () => { throw Object.assign(new Error('token exchange: secret detail'), { code: 'oauth' }); };
  await s.crew.composio.connect();
  await until('failed words', () => s.crew.composio.status().state === 'failed');
  const failed = s.crew.composio.status();
  assert.match(failed.error ?? '', /didn't finish signing you in/);
  assert.doesNotMatch(failed.error ?? '', /secret detail|oauth/);
  assert.equal(s.crew.composio.on(), false);
});

test('a Composio tool call always asks the person: no standing answer, whichever tool it is', () => {
  const seen = { bot: 'Chief', space: '/tmp/chief', secret: [] } as any;
  for (const tool of ['composio__GMAIL_SEND_EMAIL', 'composio__COMPOSIO_SEARCH_TOOLS']) {
    const e = effectOf(tool, { q: 'x' }, seen) as any;
    assert.equal(e.kind, 'send');
    assert.equal(e.key, undefined, 'no key: a Composio call never takes a standing answer');
    assert.match(e.words, /wants to use your Composio apps/);
  }
});
