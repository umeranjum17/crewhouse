// calendar-axi against a stand-in Google Calendar (its REST API, in memory): short answers, an add that is safe to repeat,
// a move that keeps the length, and the gate: looking is free, adding and moving ask, cancelling asks as a delete.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, task, until } from './lab.ts';

const { CALENDAR, parseWhen, runCalendar, whenOf } = await import('../src/calendar.ts');
const { effectOf, toolWords } = await import('../src/policy.ts');

/** Google Calendar, stood in for: primary calendar events, with the private-key filter and the token check. */
const store = new Map<string, any>();
const asked: string[] = [];
let n = 0;
const real = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  if (!String(url).startsWith(CALENDAR)) return real(url, init);
  const u = new URL(String(url));
  asked.push(`${init.method ?? 'GET'} ${u.pathname.replace('/calendar/v3/calendars/primary/events', '') || '/'} ${init.headers?.authorization}`);
  if (init.headers?.authorization !== 'Bearer tok') return new Response('{}', { status: 401 });
  const id = u.pathname.split('/events/')[1];
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
  const body = init.body ? JSON.parse(init.body) : {};
  const at = (e: any) => Date.parse(e.start.dateTime ?? `${e.start.date}T00:00:00`);
  if (!id && init.method === 'POST') { const e = { id: `ev${++n}abc`, ...body }; store.set(e.id, e); return json(e); }
  if (!id) {
    const key = u.searchParams.get('privateExtendedProperty')?.split('=')[1];
    const from = Date.parse(u.searchParams.get('timeMin')!), to = Date.parse(u.searchParams.get('timeMax')!);
    const items = [...store.values()].filter((e) => (key ? e.extendedProperties?.private?.crewhouse === key : true) && at(e) < to && at(e) >= from - 86_400_000).sort((a, b) => at(a) - at(b));
    return json({ items });
  }
  const e = store.get(id);
  if (!e) return json({}, 404);
  if (init.method === 'DELETE') { store.delete(id); return new Response(null, { status: 204 }); }
  if (init.method === 'PATCH') Object.assign(e, body);
  return json(e);
}) as typeof fetch;
after(() => { globalThis.fetch = real; });

const token = async () => 'tok';
const day = (offset: number, h?: number, m = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h ?? 0, m, 0, 0); return d; };
const ymd = (d: Date) => d.toLocaleDateString('sv-SE');

test('calendar-axi: the day, the week, free time; adding twice adds once; move keeps the length; cancel', async () => {
  const tomorrow = ymd(day(1));
  assert.deepEqual(parseWhen(`${tomorrow} 9:30`), { at: day(1, 9, 30), allDay: false });
  assert.deepEqual(parseWhen('tomorrow'), { at: day(1), allDay: true });
  assert.equal(parseWhen('next tuesday'), null);
  assert.equal(parseWhen(`${tomorrow} 25:00`), null);

  const added = await runCalendar(token, ['add', 'Dentist, Dr Rao', `${tomorrow} 09:00`, '--where', 'High St']);
  assert.match(added, /^added: \{id: ev1abc, when: \w{3} \d{4}-\d\d-\d\d 09:00-10:00\}$/);
  assert.equal(await runCalendar(token, ['add', 'Dentist, Dr Rao', `${tomorrow} 09:00`]), added.replace('added', 'exists'), 'a retry finds the first one');
  await runCalendar(token, ['add', 'School run', `${tomorrow} 09:30`, '--end', `${tomorrow} 10:30`]);
  await runCalendar(token, ['add', 'Eid', tomorrow]);
  assert.equal(store.size, 3);

  const week = await runCalendar(token, ['week']);
  assert.equal(week, [
    'events[3]{id,when,title,where}:',
    `  ev3abc,${whenOf({ start: day(1), end: day(2), allDay: true })},Eid,""`,
    `  ev1abc,${whenOf({ start: day(1, 9), end: day(1, 10), allDay: false })},"Dentist, Dr Rao",High St`,
    `  ev2abc,${whenOf({ start: day(1, 9, 30), end: day(1, 10, 30), allDay: false })},School run,""`,
    'total: 3', 'clashes: 1'].join('\n'));
  assert.equal(await runCalendar(token, ['free', 'tomorrow']), 'slots[2]{from,to}:\n  08:00,09:00\n  10:30,20:00');

  assert.match(await runCalendar(token, ['move', 'ev1abc', `${tomorrow} 14:00`]), /^moved: \{id: ev1abc, when: \w{3} \d{4}-\d\d-\d\d 14:00-15:00\}$/);
  assert.equal(await runCalendar(token, ['cancel', 'ev2abc']), 'cancelled: {id: ev2abc}');
  assert.equal(store.size, 2);
  assert.match(await runCalendar(token, []), /^today\[0\]\{id,when,title\}:\nnext: nothing more today\nhelp\[7\]:/);

  // Nothing but Google's own event ids reaches the address; plain errors with the help.
  assert.match(await runCalendar(token, ['cancel', '../../calendarList']), /^error: calendar cancel <id>/);
  assert.match(await runCalendar(token, ['frobnicate']), /^error: no command "frobnicate"\nhelp\[7\]:/);
  await assert.rejects(runCalendar(token, ['move', 'nosuchev1', 'tomorrow']), /No such event/);
  await assert.rejects(runCalendar(async () => null, ['week']), /not connected any more/);
  assert.ok(!asked.some((a) => /calendarList|\.\./.test(a)));
});

test('the gate reads the calendar command: looking is free, adding and moving ask, cancelling asks as a delete', () => {
  const s = { bot: 'Pip', space: '/tmp/pip', secret: [] };
  for (const args of [[], ['today'], ['week', '--from', 'tomorrow'], ['free', 'tomorrow']]) assert.equal(effectOf('calendar', { args }, s).kind, 'safe');
  assert.deepEqual(effectOf('calendar', { args: ['add', 'Dentist', 'tomorrow 09:00', '--where', 'High St'] }, s), {
    kind: 'send', words: 'Pip wants to add “Dentist” to your Google Calendar, tomorrow 09:00.', key: 'app:Google Calendar:add an event', covers: '“add an event” in your Google Calendar' });
  assert.equal((effectOf('calendar', { args: ['move', 'ev1abc', 'tomorrow 14:00'] }, s) as { words: string }).words, 'Pip wants to move an event on your Google Calendar to tomorrow 14:00.');
  assert.equal(effectOf('calendar', { args: ['cancel', 'ev1abc'] }, s).kind, 'delete');
  assert.equal(effectOf('calendar', { args: ['share', 'x'] }, s).kind, 'refuse');
  assert.equal(toolWords('calendar', { args: ['add', 'Dentist', 'tomorrow'] }), 'Added “Dentist” to the calendar');
  assert.equal(toolWords('calendar', { args: ['week'] }), 'Looked at the calendar');
});

test('a helper uses the connected calendar through crewd: no Google MCP, the token stays with crewd, adding asks first', async () => {
  const { db, crew, cfg, done } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  mkdirSync(join(cfg.stateDir, 'people', '1'), { recursive: true });
  writeFileSync(join(cfg.stateDir, 'people', '1', 'connections.json'), JSON.stringify({ calendar: { access: 'tok', expires: Date.now() + 3_600_000 } }));
  store.clear(); asked.length = 0;
  const t = crew.assign('quill', 'look [tool calendar {"args":["week"]}]', 'chief').task;
  await settled(db, t);
  assert.match(task(db, t).result, /events\[0\]\{id,when,title,where\}:\ntotal: 0/);
  assert.equal(db.all('SELECT * FROM asks').length, 0, 'looking never asks');
  const u = crew.assign('quill', 'add it [tool calendar {"args":["add","Parents evening","tomorrow 18:00"]}]', 'chief').task;
  await until('ask', () => db.get("SELECT * FROM asks WHERE state = 'open'"));
  assert.equal(db.get("SELECT title FROM asks WHERE state = 'open'")!.title, 'Quill wants to add “Parents evening” to your Google Calendar, tomorrow 18:00.');
  assert.equal(store.size, 0, 'nothing is added before the yes');
  await crew.answer(db.get("SELECT id FROM asks WHERE state = 'open'")!.id, { answer: 'allow' });
  await settled(db, u);
  assert.match(db.get("SELECT text FROM messages WHERE bot = 'quill' AND author = 'bot' AND task_id = ? ORDER BY id LIMIT 1", u)!.text, /added: \{id: ev\d+abc/);
  assert.equal(task(db, u).state, 'unsure', 'it added an event and never said it saw it there');
  assert.match(task(db, u).result, /on your Google Calendar/);
  assert.ok(asked.length > 0 && asked.every((a) => a.endsWith(' Bearer tok')), 'crewd adds the token to every call');
  done();
});
