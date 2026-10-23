// Connect apps: one sign-in through the engine's own Composio OAuth, on the stub engine (no account, no network). The
// stand-in sign-in finishes at once; the failed path is forced by the test. Nothing here proves a connected app works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, until, holding, release, settled, task } from './lab.ts';

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

test('Composio on removes native Gmail offers and rejects stale calls; off restores the native card', async () => {
  const { crew, db } = setup();
  crew.onboard('Umer');
  await crew.composio.connect();
  await until('Composio signed in', () => crew.composio.on());
  const id = (await crew.post('chief', 'Read Gmail through Composio, read-only. ask permission'))!.task;
  await holding(crew, 'chief');
  const run = { bot: 'chief', task: id, key: task(db, id).session }, host = crew.toolHost();
  const offer = (await host.tools(run)).find((t) => t.name === 'crew_connect')!;
  assert.ok(offer, 'other native apps remain available');
  const apps = (offer.parameters as any).properties.app.enum as string[];
  assert.ok(Array.isArray(apps), 'native connect advertises an explicit app allowlist');
  assert.ok(apps.includes('calendar'));
  assert.ok(!apps.some((a) => a.startsWith('gmail')), 'no native Gmail grant is advertised');
  assert.match(offer.description, /Composio/);
  const system = (crew.runtime as any).specOf(run.key).system;
  assert.match(system, /Composio is on/);
  assert.match(system, /read-only access for a read request/);
  assert.match(system, /Show the Composio connection link/);
  await release(crew, 'chief');
  await settled(db, id);
  // A previously advertised tool call, or an old Chief job file, cannot open a broader native grant.
  const stale = (await crew.post('chief', 'Read Gmail through Composio [tool crew_connect {"app":"gmail"}] [tool crew_connect {"app":"gmailwrite"}] [tool crew_connect {"app":"gmailsend"}]'))!.task;
  await release(crew, 'chief');
  await settled(db, stale);
  assert.equal(crew.snapshot().asks.length, 0, 'no native Gmail connect card');
  assert.match(task(db, stale).result, /Composio/);
  assert.match(task(db, stale).result, /read.only/i);
  await crew.composio.disconnect();
  const native = (await crew.post('chief', 'Read Gmail [tool crew_connect {"app":"gmail"}]'))!.task;
  await until('native Gmail connect card', () => task(db, native).state === 'needs_you');
  const asks = crew.snapshot().asks.filter((a: any) => a.state === 'open');
  assert.equal(asks.length, 1);
  assert.equal(asks[0].kind, 'connect');
  assert.equal(asks[0].detail.app, 'gmail');
});

test('Composio reads finish without cards or an action outcome; writes, mixed and unknown names still ask', async () => {
  const { crew, db } = setup();
  crew.onboard('Umer');
  await crew.composio.connect();
  await until('Composio signed in', () => crew.composio.on());
  const id = (await crew.post('chief', 'ask permission while checking app policy'))!.task;
  await holding(crew, 'chief');
  const run = { bot: 'chief', task: id, key: task(db, id).session }, host = crew.toolHost();
  const cases: [string, boolean][] = [
    ...['FETCH_EMAILS', 'LIST_MESSAGES', 'GET_MESSAGE', 'SEARCH_MESSAGES', 'READ_EMAIL', 'FIND_EMAIL'].map((name): [string, boolean] => [`GMAIL_${name}`, true]),
    ['COMPOSIO_SEARCH_TOOLS', true], ['GMAIL_GET_LABELS', true], ['FETCH', true],
    ...['SEND', 'DELETE', 'CREATE', 'UPDATE', 'MODIFY', 'LABEL', 'TRASH', 'FORWARD', 'REPLY', 'SHARE'].map((verb): [string, boolean] => [`GMAIL_GET_MESSAGE_${verb}`, false]),
    ...['SEND_EMAIL', 'DELETE_MESSAGE', 'CREATE_DRAFT', 'UPDATE_DRAFT', 'MODIFY_MESSAGE', 'LABEL_MESSAGE', 'TRASH_MESSAGE', 'FORWARD_EMAIL', 'REPLY_EMAIL', 'SHARE_MESSAGE', 'ARCHIVE_MESSAGE', 'UNKNOWN', 'FETCH_AND_DELETE', 'DELETE_AND_FETCH', 'GET_AND_SEND', 'LIST_THEN_UPDATE', 'READ_AND_UNKNOWN', 'MARK_AS_READ', 'GET_MESSAGE_AND_ARCHIVE', 'GET_MESSAGE_THEN_EXECUTE', 'FETCHING_EMAILS', 'GETMESSAGE', ''].map((name): [string, boolean] => [`GMAIL_${name}`, false]),
    ['GMAIL_UNKNOWN_READ_EMAIL', false], ['GMAIL_READ_EMAIL_SEND', false], ['FETCH_AND_DELETE', false], ['GMAIL_GET_MESSAGE.send', false], ['GMAIL_get_message', false], ['UNKNOWN', false],
  ];
  for (const [name, safe] of cases) {
    const tool = `composio__${name}`, pending = host.gate(run, tool, {});
    if (!safe) {
      await until(`${name} asks`, () => db.get("SELECT 1 FROM asks WHERE state = 'open'"));
      const ask = crew.snapshot().asks[0];
      assert.equal(ask.detail.effect, 'send', name);
      assert.equal(ask.detail.always, undefined, 'no standing answer');
      await crew.answer(ask.id, { answer: 'deny' });
    }
    assert.equal((await pending).allow, safe, name);
    assert.equal(task(db, id).acted, null, 'reads and refused writes never mark the job as acted');
  }
  assert.equal(db.all('SELECT * FROM asks').length, cases.filter(([, safe]) => !safe).length, 'only non-read calls ask');
  await release(crew, 'chief', 'The read-only policy check finished. No app action was performed.');
  await settled(db, id);
  assert.equal(task(db, id).state, 'done', 'reads need no crew_outcome to finish');
  assert.equal(task(db, id).outcome, null);
  const write = (await crew.post('chief', 'ask permission while checking write policy'))!.task;
  await holding(crew, 'chief');
  for (let i = 0; i < 2; i++) {
    const pending = host.gate({ bot: 'chief', task: write, key: task(db, write).session }, 'composio__GMAIL_SEND_EMAIL', {});
    await until('each write asks', () => crew.snapshot().asks.length);
    const ask = crew.snapshot().asks[0];
    assert.equal(ask.detail.always, undefined);
    await assert.rejects(crew.answer(ask.id, { answer: 'allow', scope: 'always' }), /allow once/);
    await crew.answer(ask.id, { answer: 'allow', scope: 'once' });
    assert.equal((await pending).allow, true);
  }
  assert.ok(task(db, write).acted, 'an approved write still requires an outcome');
  await release(crew, 'chief', 'The gate was checked; no app operation was executed.');
  await settled(db, write);
  assert.equal(task(db, write).state, 'unsure', 'no write outcome was confirmed');
  await crew.composio.disconnect();
  const off = (await crew.post('chief', 'ask permission while disconnected'))!.task;
  await holding(crew, 'chief');
  assert.equal((await host.gate({ bot: 'chief', task: off, key: task(db, off).session }, 'composio__GMAIL_FETCH_EMAILS', {})).allow, false, 'safe names do not bypass sign-in admission');
  await release(crew, 'chief', 'No connected app was accessed.');
});
