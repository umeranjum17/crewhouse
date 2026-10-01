import { signInApp } from './connect-fixture.ts';
// P7: Chief reads the person's own calendar himself instead of handing that to a helper.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, settled, task, until } from './lab.ts';
import { chiefFirst } from '../src/crew.ts';

const { CALENDAR } = await import('../src/calendar.ts');

/** Google Calendar, stood in for: two timed events tomorrow, with the token check. */
const real = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  if (!String(url).startsWith(CALENDAR)) return real(url, init);
  if (init.headers?.authorization !== 'Bearer tok') return new Response('{}', { status: 401 });
  const at = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const ev = (id: string, summary: string, h: number) => ({ id, summary, start: { dateTime: at(h) }, end: { dateTime: at(h + 1) } });
  return new Response(JSON.stringify({ items: [ev('ev1', 'Standup', 9), ev('ev2', 'Dentist', 15)] }), { status: 200 });
}) as typeof fetch;
after(() => { globalThis.fetch = real; });

test("Chief answers his own calendar question: one Chief task, no asks, the reply in his thread", async () => {
  const { db, crew, cfg, done } = setup();
  crew.onboard('Umer');
  await signInApp(crew.connections, 'calendar');
  const r = await crew.post('chief', 'what are my next meetings [tool calendar {"args":["next","2"]}]') as { task?: number };
  assert.ok(r?.task, 'the question becomes a task');
  await settled(db, r.task);
  assert.equal(db.all('SELECT * FROM tasks').length, 1, 'exactly one task');
  assert.equal(task(db, r.task).bot, 'chief', 'it stays with Chief: no helper task');
  assert.equal(db.all('SELECT * FROM asks').length, 0, 'reading never asks');
  assert.match(task(db, r.task).result ?? '', /next\[2\]/, 'the calendar answer is the task result');
  assert.ok(crew.botPage('chief').messages.some((m) => m.author === 'bot'), 'Chief replies in his own thread');
  done();
});

test('Chief without Calendar asks to connect it: one connect ask, still no helper task', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer');
  const r = await crew.post('chief', 'what is on this week [tool crew_connect {"app":"calendar"}]') as { task?: number };
  assert.ok(r?.task, 'the question becomes a task');
  await until('connect ask', () => task(db, r.task!).state === 'needs_you');
  const asks = crew.snapshot().asks.filter((a: any) => a.state === 'open');
  assert.equal(asks.length, 1, 'one ask');
  assert.equal(asks[0].kind, 'connect', 'it asks to connect the calendar');
  assert.deepEqual(db.all('SELECT DISTINCT bot FROM tasks').map((t) => t.bot), ['chief'], 'no helper task');
  done();
});

test('chiefFirst names the next step: the calendar, the inbox, or the work', () => {
  assert.equal(chiefFirst('what are my next meetings'), 'Checking your calendar.');
  assert.equal(chiefFirst('anything new in my inbox'), 'Checking your email.');
  assert.equal(chiefFirst('remind me about my meeting tomorrow'), "I'll work out the reminder and when it should run.");
  assert.equal(chiefFirst('hi'), "I'll look into that now.");
});
