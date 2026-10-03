import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Crew } from '../src/crew.ts';
import { setup, holding, release, settled, until, task } from './lab.ts';

const tools = (crew: Crew, bot: string) => (crew as any).crewTools(bot);

test('Chief delegates work, reads exact evidence, translates progress and ignores identical reports', async () => {
  const { db, crew } = setup(); crew.onboard('Test'); crew.recruit('scout', 'Scout', 'person');
  for (const tool of ['bash', 'write', 'edit', 'web_fetch', 'web_search', 'browser']) {
    assert.equal((await (crew as any).gate('chief', tool, {})).block, true, tool);
  }
  const id = crew.assign('scout', 'ask permission: check the controlled notice', 'chief').task;
  await holding(crew, 'scout');
  const report = tools(crew, 'scout').find((t: any) => t.name === 'crew_report');
  const text = 'The notice expires Friday. The receipt is missing. Source: https://example.test/notice';
  await report.run({ text });
  await until('Chief readback', () => db.get("SELECT 1 FROM messages WHERE bot = 'chief' AND task_id = ? AND author = 'bot'", id));
  const count = db.get("SELECT COUNT(*) AS n FROM tasks WHERE parent = ? AND origin = 'report'", id)!.n;
  await report.run({ text });
  assert.equal(db.get("SELECT COUNT(*) AS n FROM tasks WHERE parent = ? AND origin = 'report'", id)!.n, count);
  const review = db.get("SELECT * FROM tasks WHERE parent = ? AND origin = 'report'", id)!;
  assert.match((crew as any).runtime.specOf(review.session).message, /Read crew_status with task/);
  const line = db.get("SELECT text FROM messages WHERE bot = 'chief' AND task_id = ? AND author = 'bot' ORDER BY id DESC", id)!.text;
  assert.match(line, /Friday.*receipt is missing.*https:\/\/example.test\/notice/s);
  assert.notEqual(line, text, 'Chief supplies outcome framing; the helper does not address the person');
  await release(crew, 'scout', 'The notice needs the missing receipt.'); await settled(db, id);
});

test('a pending Chief review survives restart with its source task, history and session identity', async () => {
  const s = setup(); s.crew.onboard('Test'); s.crew.recruit('scout', 'Scout', 'person');
  const runtime = (s.crew as any).runtime, run = runtime.run.bind(runtime);
  runtime.run = (spec: any, on: any) => run(spec.bot === 'chief' && task(s.db, spec.task).origin === 'report'
    ? { ...spec, message: 'ask permission: delayed fixture review' } : spec, on);
  const id = s.crew.assign('scout', 'ask permission: check a notice', 'chief').task;
  await release(s.crew, 'scout', 'The notice expires Friday. Source: https://example.test/notice');
  await holding(s.crew, 'chief');
  const review = s.db.get("SELECT * FROM tasks WHERE parent = ? AND origin = 'report'", id)!;
  assert.equal(s.db.get("SELECT COUNT(*) AS n FROM messages WHERE bot = 'chief' AND task_id = ? AND author = 'bot'", id)!.n, 0);
  await s.crew.stop();
  const crew = new Crew(s.cfg, s.db); crew.init();
  try {
    await settled(s.db, review.id);
    assert.equal(task(s.db, review.id).session, review.session);
    assert.equal(task(s.db, review.id).parent, id);
    assert.match(s.db.get("SELECT text FROM messages WHERE bot = 'chief' AND task_id = ? AND author = 'bot' ORDER BY id DESC", id)!.text, /Friday.*https:\/\/example.test\/notice/s);
    const receipt = crew.botPage('chief').messages.find((m: any) => m.task_id === id && m.outcome)!;
    assert.equal(receipt.outcome.state, 'done');
    assert.equal(JSON.parse(s.db.get('SELECT data FROM events WHERE seq = ?', receipt.outcome.event)!.data).task, id);
    assert.ok(s.db.get("SELECT 1 FROM messages WHERE bot = 'scout' AND task_id = ? AND author = 'bot'", id), 'the internal history remains');
  } finally { await crew.stop(); }
});

test('Chief answers an informational blocker durably; restart cannot grant a held human decision', async () => {
  const s = setup(); s.crew.onboard('Test'); s.crew.recruit('scout', 'Scout', 'person');
  const id = s.crew.assign('scout', 'ask permission: compare receipts', 'chief').task;
  await release(s.crew, 'scout', 'Which controlled receipt should I compare?'); await settled(s.db, id);
  const session = task(s.db, id).session, root = task(s.db, id).root;
  await s.crew.stop();
  const first = new Crew(s.cfg, s.db); first.init();
  try { assert.equal(first.assign('scout', 'Use September; ask permission before continuing', 'chief').task, id); }
  finally { await first.stop(); } // stop before dispatch completes; the answer must not live only in memory
  const crew = new Crew(s.cfg, s.db); crew.init();
  try {
    await holding(crew, 'scout');
    assert.equal(task(s.db, id).session, session); assert.equal(task(s.db, id).root, root);
    assert.match((crew as any).runtime.specOf(session).message, /Use September.*grants no protected action/s);
    const ask = (crew as any).openAsk('scout', task(s.db, id), 'Connect Gmail', { app: 'gmail' }, 'connect');
    await crew.stop();
    const restored = new Crew(s.cfg, s.db); restored.init();
    try {
      const card = restored.snapshot().asks.find(a => a.id === ask)!;
      assert.equal(card.task_id, id); assert.equal(card.app, 'Gmail');
      assert.match(card.chief, /recommends no approval until you read the details/);
      assert.notEqual(restored.assign('scout', 'Approved', 'chief').task, id);
      assert.equal(s.db.get('SELECT state FROM asks WHERE id = ?', ask)!.state, 'open');
      assert.ok(s.db.get("SELECT 1 FROM messages WHERE task_id = ? AND author = 'chief' AND text LIKE '%Use September%'", id));
    } finally { await restored.stop(); }
  } finally { await crew.stop(); }
});

test('a generated alert uses short active instructions; marketing remains byte-for-byte unchanged', async () => {
  const { cfg, db, crew } = setup(); crew.onboard('Test'); crew.recruit('scribe', 'Scribe', 'person');
  crew.connections.onExpired?.('gmail');
  const alert = db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'system' ORDER BY id DESC")!.text;
  assert.equal(alert, 'Your Gmail connection has expired.\nOpen Connections in Settings.\nConnect Gmail again.');
  assert.ok(alert.split('\n').every((sentence: string) => sentence.split(/\s+/).length <= 20));
  assert.doesNotMatch(alert, /whenever you like|run out|is connected by/i);
  const body = '\n  Your launch deserves a little mischief: bring your boldest ideas, your half-finished sketches, and the impossible thing you keep coming back to when everybody else tells you to play it safe.\n\nLet’s make a glorious mess. ✨\n\n';
  const file = join(cfg.crewDir, 'bots/scribe/files/launch.md'); writeFileSync(file, body);
  const id = crew.assign('scribe', 'ask permission: prepare a marketing draft', 'chief').task;
  await holding(crew, 'scribe');
  await tools(crew, 'scribe').find((t: any) => t.name === 'crew_draft').run({ path: 'files/launch.md', channel: 'post', to: 'Example launch page' });
  const card = crew.snapshot().asks.find(a => a.kind === 'propose')!;
  assert.equal(card.detail.preview.body, body);
  assert.match(card.chief, /Give your decision to Chief/);
  await crew.answer(card.id, { answer: 'allow' });
  assert.deepEqual(readFileSync(file), Buffer.from(body));
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind IN ('send.done','send.queued')")!.n, 0);
  await release(crew, 'scribe', 'The marketing draft is ready. Nothing has been sent.'); await settled(db, id);
  // Counts and this scripted example do not verify the complete STE vocabulary or a live model.
});

test('standing rules save only from the exact current card; cancel, edit, restart and crew prompt keep actual state', async () => {
  const { db, cfg, crew } = setup(); crew.onboard('Test'); crew.recruit('scribe', 'Scribe', 'person');
  const said = 'Never send email. Prepare drafts only.';
  const request = crew.requestChief('ask permission: prepare the standing rule card', said).task;
  await holding(crew, 'chief');
  const propose = tools(crew, 'chief').find((t: any) => t.name === 'crew_rule');
  assert.equal(tools(crew, 'scribe').some((t: any) => t.name === 'crew_rule'), false);
  await propose.run({ title: 'Email drafts', text: said, said: 'forged original' });
  let card = crew.snapshot().asks.find((a: any) => a.detail.rule)!;
  assert.equal(card.detail.rule.said, said); assert.equal(card.detail.rule.text, said);
  assert.equal(card.detail.yes, 'Create rule'); assert.equal(card.detail.no, 'Cancel');
  assert.deepEqual(crew.rules(), []);
  await propose.run({ title: 'Email drafts', text: 'Prepare email drafts. Never send email.' });
  const current = crew.snapshot().asks.find((a: any) => a.detail.rule)!;
  assert.equal(db.get('SELECT state FROM asks WHERE id = ?', card.id)!.state, 'withdrawn');
  await assert.rejects(crew.answer(card.id, { answer: 'allow' }), /already settled/);
  await crew.answer(current.id, { answer: 'deny' });
  assert.deepEqual(crew.rules(), []);
  let message = crew.botPage('chief').messages.find((m: any) => m.rule)!;
  assert.equal(message.rule.state, 'cancelled');
  await propose.run({ title: 'Email drafts', text: said });
  card = crew.snapshot().asks.find((a: any) => a.detail.rule)!;
  await crew.post('chief', 'Approved'); assert.deepEqual(crew.rules(), []);
  await crew.answer(card.id, { answer: 'allow', scope: 'once' });
  const saved = crew.rules()[0]; assert.deepEqual(saved, { id: card.id, title: 'Email drafts', text: said });
  message = crew.botPage('chief').messages.filter((m: any) => m.rule).at(-1)!;
  assert.equal(message.rule.state, 'saved'); assert.match(message.text, /Rules in Settings/);
  await propose.run({ id: saved.id, title: saved.title, text: 'Prepare drafts only. Never send email.' });
  card = crew.snapshot().asks.find((a: any) => a.detail.rule)!;
  crew.changeRule(saved.id, 'Never send email, including replies. Prepare drafts only.');
  await assert.rejects(crew.answer(card.id, { answer: 'allow' }), /stale/);
  await crew.answer(card.id, { answer: 'deny' });
  assert.match(crew.rules()[0].text, /including replies/);
  assert.match(crew.botPage('chief').messages.filter((m: any) => m.rule).at(-1)!.text, /Current rule:.*including replies/);
  await release(crew, 'chief', 'The controlled review is complete.'); await settled(db, request);
  await crew.stop(); const next = new Crew(cfg, db); next.init();
  try {
    assert.match(next.rules()[0].text, /including replies/);
    const live = { appTools: new Map() };
    assert.match((next as any).systemPromptFor('scribe', live), /including replies/);
    assert.match((next as any).systemPromptFor('chief', live), /including replies/);
    assert.match((next as any).systemPromptFor('scribe', live), /grant no protected action/);
    const id = next.assign('scribe', 'ask permission: prepare the email draft', 'chief').task;
    await holding(next, 'scribe');
    assert.match((next as any).runtime.specOf(task(db, id).session).system, /including replies/);
    assert.match((await (next as any).gate('scribe', 'browser', { args: ['click', '@1'] })).reason, /unavailable/);
    const body = 'Here is the normal, creative email body.';
    writeFileSync(join(cfg.crewDir, 'bots/scribe/files/rule-email.txt'), body);
    await tools(next, 'scribe').find((t: any) => t.name === 'crew_draft').run({ path: 'files/rule-email.txt', channel: 'email', to: 'Family', subject: 'Plan' });
    assert.equal(readFileSync(join(cfg.crewDir, 'bots/scribe/files/rule-email.txt'), 'utf8'), body);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'send.done'")!.n, 0);
    await release(next, 'scribe', 'The email draft is ready.'); await settled(db, id);
    next.changeRule(saved.id); assert.deepEqual(next.rules(), []);
  } finally { next.stop(); }
});


test('routine steps remain internal; a meaningful deadline review binds its event despite later chatter', async () => {
  const { db, crew } = setup(); crew.onboard('Test'); crew.recruit('scout', 'Scout', 'person');
  const routine = crew.addRoutine({ bot: 'scout', schedule: 'every day 9:00', task: 'ask permission: inspect the controlled notice', name: 'Notice check', quiet: true }, 'person');
  crew.runRoutine(routine.id);
  const id = db.get('SELECT id FROM tasks WHERE routine = ?', routine.id)!.id;
  await holding(crew, 'scout');
  const report = tools(crew, 'scout').find((t: any) => t.name === 'crew_report');
  await report.run({ text: 'Opening the page.' }); await report.run({ text: 'Opening the page.' });
  await report.run({ text: 'Reading the next section.' });
  assert.equal(db.get("SELECT COUNT(*) AS n FROM tasks WHERE parent = ? AND origin = 'report'", id)!.n, 0);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'task.progress' AND json_extract(data, '$.task') = ?", id)!.n, 2);
  let resume!: () => void;
  const barrier = new Promise<void>(resolve => { resume = resolve; });
  const runtime = (crew as any).runtime, run = runtime.run.bind(runtime);
  runtime.run = async (spec: any, on: any) => { if (spec.bot === 'chief') await barrier; return run(spec, on); };
  const text = 'The notice expires Friday. Source: https://example.test/notice';
  await report.run({ text, important: true });
  const event = db.get("SELECT seq FROM events WHERE kind = 'task.progress' AND json_extract(data, '$.task') = ? ORDER BY seq DESC", id)!.seq;
  const review = db.get("SELECT id FROM tasks WHERE parent = ? AND origin = 'report'", id)!.id;
  await until('review started', () => task(db, review).state === 'working');
  for (let n = 0; n < 4; n++) await report.run({ text: `Reading section ${n}.` });
  await report.run({ text, important: true }); // unchanged deadline, even after unrelated step chatter
  assert.equal(db.get("SELECT COUNT(*) AS n FROM tasks WHERE parent = ? AND origin = 'report'", id)!.n, 1);
  resume(); await settled(db, review);
  const readback = JSON.parse(await tools(crew, 'chief').find((t: any) => t.name === 'crew_status').run({ task: id, event }));
  assert.equal(readback.progress.length, 1); assert.equal(readback.progress[0].text, text);
  const line = db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ? ORDER BY id DESC", id)!.text;
  assert.match(line, /Friday.*https:\/\/example.test\/notice/s); assert.doesNotMatch(line, /Reading section/);
  await release(crew, 'scout', 'ALL-CLEAR'); await settled(db, id);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM tasks WHERE parent = ? AND origin = 'report'", id)!.n, 1);
});

test('only event-bound terminal review messages carry immutable outcomes, never prior questions or progress', async () => {
  const { db, crew } = setup(); crew.onboard('Test'); crew.recruit('scout', 'Scout', 'person');
  const id = crew.assign('scout', 'ask permission: produce a controlled result', 'chief').task;
  await holding(crew, 'scout');
  await tools(crew, 'scout').find((t: any) => t.name === 'crew_report').run({ text: 'The comparison is underway.' });
  await until('progress review', () => crew.botPage('chief').messages.some((m: any) => m.task_id === id));
  await release(crew, 'scout', 'Which receipt should be compared?'); await settled(db, id);
  const prior = crew.botPage('chief').messages.filter((m: any) => m.task_id === id);
  assert.ok(prior.length >= 2); assert.ok(prior.every((m: any) => !m.outcome));
  assert.equal(crew.assign('scout', 'Use the controlled receipt; ask permission before continuing', 'chief').task, id);
  await release(crew, 'scout', 'The controlled comparison is complete.'); await settled(db, id);
  const final = crew.botPage('chief').messages.find((m: any) => m.task_id === id && m.outcome)!;
  assert.ok(final); assert.equal(final.outcome.state, 'done');
  const event = final.outcome.event, source = task(db, id);
  assert.equal(db.get('SELECT kind FROM events WHERE seq = ?', event)!.kind, 'task.done');
  assert.ok(crew.botPage('chief').messages.filter((m: any) => prior.some((p: any) => p.id === m.id)).every((m: any) => !m.outcome));
  const review = db.get("SELECT * FROM tasks WHERE parent = ? AND origin = 'report' ORDER BY id DESC", id)!;
  assert.equal((crew as any).reportToChief(source, false, event).task, review.id, 'same event reuses review identity');
  db.run("UPDATE tasks SET state = 'queued' WHERE id = ?", review.id); (crew as any).dispatch(); await settled(db, review.id);
  assert.equal(crew.botPage('chief').messages.filter((m: any) => m.outcome?.event === event).length, 1, 'same-event retry cannot duplicate a receipt');
  (crew as any).setTask(source, 'needs_you', 'A later question.');
  assert.deepEqual(crew.botPage('chief').messages.find((m: any) => m.id === final.id)!.outcome, { state: 'done', event });
  const read = JSON.parse(await tools(crew, 'chief').find((t: any) => t.name === 'crew_status').run({ task: id, event }));
  assert.equal(read.report.state, 'done'); assert.equal(read.report.result, 'The controlled comparison is complete.', 'event evidence is not replaced by mutable retry state');
  (crew as any).setTask(source, 'done', 'A later result.');
  for (const state of ['unsure', 'failed']) {
    const next = crew.assign('scout', 'ask permission: another controlled result', 'chief').task;
    await holding(crew, 'scout');
    (crew as any).close('scout');
    (crew as any).setTask(task(db, next), state, `Controlled ${state}.`);
    await settled(db, next);
    const line = crew.botPage('chief').messages.find((m: any) => m.task_id === next && m.outcome)!;
    assert.equal(line.outcome.state, state); assert.equal(db.get('SELECT kind FROM events WHERE seq = ?', line.outcome.event)!.kind, `task.${state}`);
  }
  const malformed = (crew as any).addTask('chief', 'ask permission: inspect malformed binding', 'report', undefined, undefined, '', [], { parent: id, review: { source: id, purpose: 'terminal', state: 'failed', event } }).task;
  await release(crew, 'chief', 'A disagreeing binding is not a receipt.'); await settled(db, malformed);
  const untagged = crew.botPage('chief').messages.filter((m: any) => m.task_id === id).at(-1)!;
  assert.equal(untagged.outcome, undefined);
  const foreign = db.get("SELECT seq FROM events WHERE kind = 'task.failed' ORDER BY seq DESC")!.seq;
  db.event('message.outcome', 'chief', { message: untagged.id, task: id, outcome: { state: 'failed', event: foreign } });
  assert.equal(crew.botPage('chief').messages.find((m: any) => m.id === untagged.id)!.outcome, undefined, 'wrong source binding fails closed');
  db.event('message.outcome', 'chief', { message: prior[0].id, task: id, outcome: { state: 'done', event: -1 } });
  assert.equal(crew.botPage('chief').messages.find((m: any) => m.id === prior[0].id)!.outcome, undefined, 'absent event never creates a receipt');
});
