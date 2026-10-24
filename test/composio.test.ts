// Connect apps: one sign-in through the engine's own Composio OAuth, on the stub engine (no account, no network). The
// stand-in sign-in finishes at once; the failed path is forced by the test. Nothing here proves a connected app works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const { crew, db, cfg } = setup();
  crew.onboard('Umer');
  writeFileSync(join(cfg.crewDir, 'bots/chief/AGENTS.md'), 'Use crew_connect for Gmail. No links in chat.\n'); // an older installed job
  await crew.composio.connect();
  await until('Composio signed in', () => crew.composio.on());
  const id = (await crew.post('chief', 'Connect Gmail through Composio, read-only. ask permission'))!.task;
  await holding(crew, 'chief');
  assert.equal(crew.snapshot().asks.length, 0, 'Connect Gmail reaches Chief instead of the native inline-how-to card');
  const run = { bot: 'chief', task: id, key: task(db, id).session }, host = crew.toolHost();
  const offer = (await host.tools(run)).find((t) => t.name === 'crew_connect')!;
  assert.ok(offer, 'other native apps remain available');
  const apps = (offer.parameters as any).properties.app.enum as string[];
  assert.ok(Array.isArray(apps), 'native connect advertises an explicit app allowlist');
  assert.ok(apps.includes('calendar'));
  assert.ok(!apps.some((a) => a.startsWith('gmail')), 'no native Gmail grant is advertised');
  assert.match(offer.description, /Composio/);
  assert.ok(offer.description.includes('MCP.composio.$api'), 'the native offer redirects to the schema API too');
  const system = (crew.runtime as any).specOf(run.key).system;
  assert.match(system, /Composio is on/);
  assert.match(system, /read-only access for a read request/);
  assert.match(system, /Show the Composio connection link/);
  assert.ok(system.includes('return await MCP.composio.$api("COMPOSIO_MANAGE_CONNECTIONS", {schema: true});'), 'Chief gets the exact schema discovery call, not an engine file path');
  assert.match(system, /not a shell command/);
  assert.match(system, /never read engine files/);
  assert.match(system, /composio__COMPOSIO_MANAGE_CONNECTIONS/);
  assert.match(system, /returned schema/);
  assert.match(system, /even though ordinary replies omit links/);
  assert.match(system, /wait for consent/);
  assert.match(system, /do not request send, modify or delete access/);
  await release(crew, 'chief');
  await settled(db, id);
  // A previously advertised tool call, or an old Chief job file, cannot open a broader native grant.
  const stale = (await crew.post('chief', 'Read Gmail through Composio [tool crew_connect {"app":"gmail"}] [tool crew_connect {"app":"gmailwrite"}] [tool crew_connect {"app":"gmailsend"}]'))!.task;
  await release(crew, 'chief');
  await settled(db, stale);
  assert.equal(crew.snapshot().asks.length, 0, 'no native Gmail connect card');
  assert.match(task(db, stale).result, /Composio/);
  assert.match(task(db, stale).result, /read.only/i);
  const redirect = (crew.runtime as any).transcript(task(db, stale).session);
  assert.ok(redirect.includes('MCP.composio.$api'), 'stale native calls get the exact discovery call');
  assert.match(redirect, /read-only access/);
  assert.match(redirect, /Next step, now, before any other tool: in code-mode exec/, 'the connect result leads with the single next step');
  assert.doesNotMatch(redirect, /crew_read:|read:|node_modules\/openclaw/, 'no engine file read or read approval was needed');
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

// The recorded run (test/fixtures/connect-apps-run4-events.json: Chief on MiniMax, Composio signed in, "what is the subject of
// my latest email"): he called crew_connect for gmail, composio and google, got "no app called" twice and the Composio note
// buried in the first, then never called a Composio tool. Every one of those calls must now return the same single next step.
test('replaying the recorded Gmail run: each crew_connect call Chief made returns the one next step, never "no app called"', async () => {
  const events = JSON.parse(readFileSync(new URL('./fixtures/connect-apps-run4-events.json', import.meta.url), 'utf8')) as { kind: string, data: { tool?: string, input?: string } }[];
  const calls = events.filter((e) => e.kind === 'run.call' && e.data.tool === 'crew_connect').map((e) => e.data.input!);
  assert.deepEqual(calls, ['{"app":"gmail"}', '{"app":"composio"}', '{"app":"google"}'], 'the fixture is the recorded run');
  const { crew, db } = setup();
  crew.onboard('Umer');
  await crew.composio.connect();
  await until('Composio signed in', () => crew.composio.on());
  for (const input of calls) {
    const id = (await crew.post('chief', `What is the subject line of my most recent email in Gmail? [tool crew_connect ${input}]`))!.task;
    await settled(db, id);
    const said = (crew.runtime as any).transcript(task(db, id).session);
    assert.doesNotMatch(said, /no app called/, input);
    assert.match(said, /Next step, now, before any other tool: in code-mode exec/, input);
    assert.ok(said.includes('MCP.composio.$api('), input);
    assert.equal(crew.snapshot().asks.length, 0, 'no card for the person');
  }
});
