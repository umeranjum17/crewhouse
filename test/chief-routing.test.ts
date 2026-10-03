import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setup, holding, release, settled, until, task } from './lab.ts';
import { startServer } from '../src/server.ts';
import { Crew } from '../src/crew.ts';
import { effectOf } from '../src/policy.ts';

const chiefLines = (db: any, id: number) => db.all("SELECT * FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ?", id);

test('public helper destinations and caller flags cannot bypass Chief; internal delegation remains trusted', async () => {
  const { cfg, db, crew } = setup();
  crew.onboard('Test'); crew.recruit('scout', 'Scout', 'person');
  const server = await startServer({ ...cfg, port: 0, linkPort: 0, relay: '' }, db, crew);
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    const res = await fetch(`${url}/api/bots/scout/messages`, { method: 'POST', headers: { 'x-crewhouse': '1', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'ask permission: About these sources', internal: true, by: 'chief' }) });
    assert.equal(res.status, 200);
    const { task: id } = await res.json();
    assert.equal(task(db, id).bot, 'chief');
    assert.match(task(db, id).body, /About Scout's work/);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM messages WHERE bot = 'scout' AND author = 'person'")!.n, 0);
    await holding(crew, 'chief');
    const assign = (crew as any).crewTools('chief').find((t: any) => t.name === 'crew_assign');
    const result = JSON.parse(await assign.run({ bot: 'scout', task: 'ask permission: find sources' }));
    await holding(crew, 'scout');
    assert.equal(task(db, result.task).bot, 'scout');
    assert.equal(task(db, result.task).origin, 'chief');
    assert.equal(task(db, result.task).parent, id);
    assert.equal(task(db, result.task).root, id, 'the phone writer correlates this exact Chief request, not the latest helper');
    const line = db.get("SELECT * FROM messages WHERE bot = 'chief' AND author = 'person' AND task_id = ?", id);
    assert.ok(line); assert.equal(line.text, 'ask permission: About these sources');
    await release(crew, 'chief', 'Report received.'); await settled(db, id);
    await release(crew, 'scout', 'Sources checked.'); await settled(db, result.task);
    assert.ok(chiefLines(db, result.task).some((m: any) => /report/.test(m.text)));
    crew.say('chief', 'bot', 'Which source did you mean?', result.task);
    const next = (await crew.post('chief', 'Make a new report'))!.task;
    assert.equal(task(db, next).bot, 'chief'); assert.equal(task(db, next).root, next);
    assert.equal(task(db, next).body, 'Make a new report', 'a short new job is not swallowed as a helper answer');
    const hello = crew.onboard('Test', 'Write the introduction', 'scribe')!.task;
    assert.equal(task(db, hello).bot, 'chief'); assert.match(task(db, hello).body, /helper context: scribe/);
    const steer = await crew.steer('scout', 'About the evidence');
    assert.ok(steer); assert.equal(task(db, steer.task).bot, 'chief');
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

test('Chief carries progress, routine sources, failures and uncertainty on the actual task identity', async () => {
  const { db, crew } = setup(); crew.onboard('Test'); crew.recruit('scout', 'Scout', 'person');
  const { task: id } = crew.assign('scout', 'ask permission: check evidence', 'chief');
  await holding(crew, 'scout');
  const report = (crew as any).crewTools('scout').find((t: any) => t.name === 'crew_report');
  await report.run({ text: 'Not yet. The insurer schedule is missing.' });
  await until('Chief translated progress', () => chiefLines(db, id).some((m: any) => /schedule is missing/.test(m.text)));
  db.run("UPDATE tasks SET origin = 'routine', routine = 999 WHERE id = ?", id);
  await release(crew, 'scout', 'The controlled notice expires Friday; the receipt is missing. Source: https://example.test/notice');
  await settled(db, id);
  assert.match(chiefLines(db, id).at(-1).text, /https:\/\/example.test\/notice/);
  const uncertain = crew.assign('scout', 'ask permission: check result', 'chief').task;
  await holding(crew, 'scout');
  db.run("UPDATE tasks SET acted = 'controlled fixture', outcome = NULL WHERE id = ?", uncertain);
  await release(crew, 'scout', 'I intended to finish.'); await settled(db, uncertain);
  assert.equal(task(db, uncertain).state, 'unsure');
  assert.match(chiefLines(db, uncertain).at(-1).text, /cannot confirm/);
  const failed = crew.assign('scout', 'ask permission: check a missing input', 'chief').task;
  await holding(crew, 'scout');
  (crew as any).setTask(task(db, failed), 'failed', 'The input was unavailable.');
  await until('Chief translated failure', () => chiefLines(db, failed).some((m: any) => /could not complete[\s\S]*input was unavailable/.test(m.text)));
});

test('an informational helper question waits on Chief and can be resumed only without protected asks', async () => {
  const { db, crew } = setup(); crew.onboard('Test'); crew.recruit('scout', 'Scout', 'person');
  const id = crew.assign('scout', 'ask permission: which receipt', 'chief').task;
  await holding(crew, 'scout');
  await release(crew, 'scout', 'Which controlled receipt should I compare?');
  await until('waiting on Chief', () => task(db, id).state === 'needs_you');
  await settled(db, id);
  assert.ok(chiefLines(db, id).some((m: any) => /Chief will read the information/.test(m.text)));
  assert.ok(db.get("SELECT id FROM tasks WHERE bot = 'chief' AND parent = ?", id));
  const resumed = crew.assign('scout', 'Use the controlled September receipt; ask permission before continuing', 'chief');
  assert.equal(resumed.task, id);
  await holding(crew, 'scout');
  const ask = (crew as any).openAsk('scout', task(db, id), 'Connect Gmail', { app: 'gmail' }, 'connect');
  const queued = crew.assign('scout', 'Approved', 'chief');
  assert.notEqual(queued.task, id, 'Chief cannot resume a protected human ask');
  assert.equal(db.get('SELECT state FROM asks WHERE id = ?', ask)!.state, 'open');
});

test('all protected asks retain identity and context; typed Approved authorizes nothing', async () => {
  const { db, crew } = setup(); crew.onboard('Test'); crew.recruit('scout', 'Scout', 'person');
  const id = crew.assign('scout', 'ask permission: inspect the schedule', 'chief').task;
  await holding(crew, 'scout');
  const open = (title: string, detail: any, kind: string) => (crew as any).openAsk('scout', task(db, id), title, detail, kind);
  const connect = open('Connect Google Calendar', { app: 'calendar' }, 'connect');
  const propose = open('Keep this skill?', { preview: { body: 'A controlled proposal' } }, 'propose');
  const spend = open('Press “Buy” on the controlled shop', { effect: 'spend' }, 'permission');
  const asks = crew.snapshot().asks;
  assert.ok([connect, propose, spend].every(id => asks.some(a => a.id === id)));
  assert.equal(asks.find(a => a.id === connect)!.app, 'Google Calendar');
  assert.equal(asks.find(a => a.id === spend)!.app, null, 'a host is not a verified app name');
  assert.equal(asks.find(a => a.id === spend)!.why, 'ask permission: inspect the schedule');
  assert.match(asks.find(a => a.id === spend)!.chief, /Give your decision to Chief[\s\S]*Helper: Scout[\s\S]*Buy[\s\S]*recommends no action/);
  await crew.post('chief', 'Approved');
  assert.equal(db.get('SELECT state FROM asks WHERE id = ?', spend)!.state, 'open');
  await assert.rejects(crew.answer(spend, { answer: 'allow' }), /unavailable/);
  await crew.answer(spend, { answer: 'deny' });
  assert.equal(db.get('SELECT state FROM asks WHERE id = ?', spend)!.state, 'answered');
  await crew.resetBot('scout');
  assert.ok(chiefLines(db, id).some((m: any) => m.text.includes(`Card ${connect} is closed`)));
  await assert.rejects(crew.answer(connect, { answer: 'allow' }), /already settled/);
});

test('a real file permission still waits for its exact card; retry cannot steal another task ask', async () => {
  const { cfg, db, crew } = setup(); crew.onboard('Test'); crew.recruit('scout', 'Scout', 'person');
  const id = crew.assign('scout', 'ask permission: copy the report', 'chief').task;
  await holding(crew, 'scout');
  const seen = { bot: 'Scout', space: join(cfg.crewDir, 'bots/scout'), secret: [] };
  const input = { path: join(cfg.crewDir, 'shared/report.txt'), content: 'controlled' };
  const effect = effectOf('write', input, seen);
  assert.equal(effect.kind, 'files');
  const old = (crew as any).openAsk('scout', { ...task(db, id), id: 999 }, (effect as any).words, { effect: 'files' });
  const decision = (crew as any).decide('scout', 'write', input, effect);
  await until('new task permission', () => db.get("SELECT id FROM asks WHERE task_id = ? AND state = 'open'", id));
  const ask = db.get("SELECT * FROM asks WHERE task_id = ? AND state = 'open'", id);
  assert.ok(ask); assert.notEqual(ask.id, old);
  assert.equal(db.get('SELECT state FROM asks WHERE id = ?', old)!.state, 'open');
  await crew.answer(ask.id, { answer: 'allow', scope: 'task' });
  assert.equal(await decision, undefined);
  assert.equal(db.get('SELECT answer FROM asks WHERE id = ?', ask.id)!.answer, 'allowed for this task');
  assert.equal(await (crew as any).decide('scout', 'write', input, effect), undefined, 'the actual scoped grant remains');
  const ended = (crew as any).openAsk('scout', task(db, id), 'Read a stale input', { effect: 'files' });
  db.run("UPDATE tasks SET state = 'done' WHERE id = ?", id);
  await assert.rejects(crew.answer(ended, { answer: 'allow' }), /no longer live/);
  assert.equal(db.get('SELECT state FROM asks WHERE id = ?', ended)!.state, 'withdrawn');
});

test('typed outward paths fail closed even with grants; no counterfeit queue or send receipt', async () => {
  const { cfg, db, crew } = setup(); crew.onboard('Test'); crew.recruit('scout', 'Scout', 'person');
  const id = crew.assign('scout', 'ask permission: inspect only', 'chief').task;
  await holding(crew, 'scout');
  for (const [tool, input, effect] of [
    ['calendar', { args: ['add', 'Controlled meeting'] }, { kind: 'send', words: 'Add an event', key: 'send:calendar' }],
    ['calendar', { args: ['cancel', 'fixture'] }, { kind: 'delete', words: 'Delete event', key: 'delete:calendar' }],
    ['browser', { args: ['click', '@1'] }, { kind: 'safe' }],
    ['fixture_app', {}, { kind: 'send', words: 'Send the controlled message' }],
    ['fixture_paid', {}, { kind: 'spend', words: 'Buy the fixture', cost: 1 }],
  ] as any[]) {
    (crew as any).granted.add(`scout\n${id}\n${effect.words}`);
    if (effect.key) (crew as any).taskGrants.set(id, [effect.key]);
    const result = await (crew as any).decide('scout', tool, input, effect);
    assert.equal(result.block, true, tool);
    assert.match(result.reason, /unavailable.*nothing was queued or sent/);
  }
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE task_id = ?", id)!.n, 0);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind IN ('send.done','send.queued')")!.n, 0);
  assert.ok(db.all("SELECT data FROM events WHERE kind = 'run.tool' AND json_extract(data, '$.task') = ?", id).every(e => JSON.parse(e.data).words.startsWith('Requested step (not confirmed):')));
  assert.equal(await (crew as any).decide('scout', 'read', { path: join(cfg.crewDir, 'bots/scout/files/report.txt') }, { kind: 'safe' }), undefined);
});

test('restart preserves live rank3 and taskless connection asks, and names withdrawn request identity', async () => {
  const { cfg, db, crew } = setup(); crew.onboard('Test'); crew.recruit('scout', 'Scout', 'person');
  const live = (crew as any).openAsk('scout', undefined, 'Connect Gmail', { app: 'gmail' }, 'connect');
  const proposal = (crew as any).openAsk('scout', undefined, 'Keep a skill', { preview: { body: 'controlled' } }, 'propose');
  const id = crew.assign('scout', 'ask permission: finished fixture', 'chief').task;
  await holding(crew, 'scout');
  const stale = (crew as any).openAsk('scout', task(db, id), 'Read an old file', { effect: 'files' });
  db.run("UPDATE tasks SET state = 'done' WHERE id = ?", id);
  await crew.stop();
  const restarted = new Crew(cfg, db);
  restarted.init();
  try {
    assert.ok([live, proposal].every(id => restarted.snapshot().asks.some(a => a.id === id)));
    assert.equal(db.get('SELECT state FROM asks WHERE id = ?', stale)!.state, 'withdrawn');
    assert.ok(chiefLines(db, id).some((m: any) => m.text.includes(`Card ${stale} is closed`)));
    await assert.rejects(restarted.answer(stale, { answer: 'allow' }), /already settled/);
  } finally { await restarted.stop(); }
});
