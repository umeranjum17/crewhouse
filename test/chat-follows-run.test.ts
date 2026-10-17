// The live line follows the running turn, not the newest task (chat quality map, row #1): a second send while Chief
// works must not steal the line or restart its clock — it shows as a short "Next: …" row — and a routed helper request
// finishing while Chief still works must not replace Chief's working line with the helper's "done". One adapter change
// feeds web chat and the phone app. Runs on the real crewd with the stub engine: no account, no network, no quota.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup as lab, holding } from './lab.ts';
import * as A from '../web/src/adapter.ts';

/** The live line exactly as the app builds it: this thread's page plus the snapshot's tasks and events. */
const line = (crew: any, id = 'chief') => {
  const state = crew.snapshot(), page = crew.botPage(id);
  return A.liveLine({ id, name: id === 'chief' ? 'Chief' : id, crew: A.crew(state), writing: new Map(), heard: [],
    tasks: [...(page.tasks ?? []), ...(id === 'chief' ? state.tasks ?? [] : [])], events: [...(page.trail ?? []), ...(state.events ?? [])] });
};

test('a second send while Chief works keeps the running turn and its clock, and the queued one shows as Next', { timeout: 60_000 }, async () => {
  const { db, crew } = lab();
  crew.onboard('Umer');
  const first = (await crew.post('chief', 'ask permission to plan my week'))!.task;
  await holding(crew, 'chief');
  const before = line(crew);
  assert.equal(before?.state, 'working', 'the held turn is the line');
  assert.equal(before?.next, undefined, 'nothing queued behind it yet');
  // The clock is the run's own admission, not the moment the task row was written.
  const admitted = db.get("SELECT at FROM events WHERE kind = 'run.admitted' AND json_extract(data, '$.task') = ?", first)!.at;
  assert.equal(before?.since, admitted, 'the clock counts from run.admitted');
  assert.ok(before?.todos.some((t) => /ask permission to plan my week/.test(t.text)), 'the running job still reads on the line');

  // The person sends again while Chief is still on the first job.
  const second = (await crew.post('chief', 'book a table for Saturday night'))!.task;
  assert.notEqual(second, first);
  const after = line(crew);
  assert.equal(after?.who, 'Chief', 'the line still follows Chief');
  assert.equal(after?.state, 'working', 'the running turn keeps the line; the queued send does not steal it');
  assert.equal(after?.since, admitted, 'the clock does not restart on the second send');
  assert.match(after?.next ?? '', /book a table for Saturday night/, 'the queued one shows as Next');
  assert.ok(after?.todos.some((t) => /ask permission to plan my week/.test(t.text)), 'the running job still reads on the line');

  // When the first job finishes, the queued one takes the line and its own clock starts at its admission.
  (crew.runtime as any).release(crew.sessionOf('chief')!.key, 'All planned for Umer.');
  const queued = await new Promise<any>((resolve) => {
    const end = Date.now() + 30_000;
    const poll = () => { const l = line(crew); if (l?.todos.some((t) => /book a table for Saturday night/.test(t.text)) && l.next === undefined) return resolve(l); if (Date.now() > end) return resolve(l); setTimeout(poll, 20); };
    poll();
  });
  assert.ok(queued, 'the queued job becomes the live line once it is running');
  assert.notEqual(queued.since, admitted, 'the next job has its own clock');
});

test('a routed helper request finishing while Chief works keeps Chief\'s working line', { timeout: 60_000 }, async () => {
  const { db, crew } = lab();
  crew.onboard('Umer');
  crew.recruit('scout', 'Penny', 'person');
  const first = (await crew.post('chief', 'ask permission to plan my week'))!.task;
  await holding(crew, 'chief');
  const before = line(crew);
  assert.equal(before?.state, 'working');
  // "Penny, …" routes to the helper with Chief as its origin; the helper runs while Chief is still held.
  const routed = (await crew.post('chief', 'Penny, sort my invoices'))!.task;
  assert.ok(routed && routed !== first, 'the routed request is its own helper task');
  const bot = db.get('SELECT bot, origin FROM tasks WHERE id = ?', routed)!;
  assert.equal(bot.bot, 'penny');
  assert.equal(bot.origin, 'chief');
  await new Promise<void>((resolve) => {
    const end = Date.now() + 30_000;
    const poll = () => { const s = db.get('SELECT state FROM tasks WHERE id = ?', routed)!.state; if (['done', 'failed', 'unsure'].includes(s) || Date.now() > end) return resolve(); setTimeout(poll, 20); };
    poll();
  });
  assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', routed)!.state, 'done', 'the helper finished while Chief still worked');
  const after = line(crew);
  assert.equal(after?.who, 'Chief', 'the finished helper job does not take Chief\'s line');
  assert.equal(after?.state, 'working', 'Chief still reads at work');
  assert.equal(after?.since, before?.since, 'Chief\'s clock did not restart');
});

test('the header says Chief at work from the send, before his job exists (chat quality map, row #8)', { timeout: 60_000 }, async () => {
  const { crew } = lab();
  crew.onboard('Umer');
  // The snapshot the header holds the instant the person sends: Chief's job is not in it yet, only the send.
  const idle = crew.snapshot();
  assert.equal(A.chiefStatus(A.office(idle)).word, 'Free', 'nothing sent: Chief is free');
  const sent = Date.now();
  assert.equal(A.liveLine({ id: 'chief', name: 'Chief', crew: A.crew(idle), writing: new Map(), heard: [], tasks: [], events: [], sent })?.state, 'reading', 'the thread reads the send');
  assert.equal(A.chiefStatus(A.sending(A.office(idle), sent)).word, 'At work', 'the header agrees with the thread from the first second');
  // Once Chief's job is on the snapshot, the job says it: the header stays at work with no send left pending.
  await crew.post('chief', 'ask permission to plan my week');
  await holding(crew, 'chief');
  assert.equal(A.chiefStatus(A.office(crew.snapshot())).word, 'At work', 'the running job is at work');
});
