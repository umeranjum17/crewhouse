import { signInApp } from './connect-fixture.ts';
// calendar-axi against a stand-in Google Calendar (its REST API, in memory): short answers, an add that is safe to repeat,
// a move that keeps the length, and the gate: looking is free, adding and moving ask, cancelling asks as a delete.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, settled, task, until, grantApps, lastSaid } from './lab.ts';
import * as A from '../web/src/adapter.ts';

const { CALENDAR, parseWhen, runCalendar, whenOf } = await import('../src/calendar.ts');
const { effectOf } = await import('../src/policy.ts');

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
  assert.match(await runCalendar(token, []), /^today\[0\]\{id,when,title\}:\nnext: nothing more today\nhelp\[8\]:/);

  // Nothing but Google's own event ids reaches the address; plain errors with the help.
  assert.match(await runCalendar(token, ['cancel', '../../calendarList']), /^error: calendar cancel <id>/);
  assert.match(await runCalendar(token, ['frobnicate']), /^error: no command "frobnicate"\nhelp\[8\]:/);
  await assert.rejects(runCalendar(token, ['move', 'nosuchev1', 'tomorrow']), /No such event/);
  await assert.rejects(runCalendar(async () => null, ['week']), /not connected any more/);
  assert.ok(!asked.some((a) => /calendarList|\.\./.test(a)));
});

test('calendar next [n]: the next timed events across two weeks, no ask', async () => {
  store.clear();
  const morrow = ymd(day(1)), overmorrow = ymd(day(2));
  const ids = [];
  for (const [title, when] of [['First', `${morrow} 09:00`], ['Second', `${morrow} 15:00`], ['Third', `${overmorrow} 10:00`]]) {
    ids.push(/id: (\w+)/.exec(await runCalendar(token, ['add', title, when]))![1]);
  }
  await runCalendar(token, ['add', 'Day off', morrow]);
  const row = (id: string, d: Date, title: string) => `  ${id},${whenOf({ start: d, end: new Date(d.getTime() + 3_600_000), allDay: false })},${title}`;
  assert.equal(await runCalendar(token, ['next', '2']), ['next[2]{id,when,title}:', row(ids[0], day(1, 9), 'First'), row(ids[1], day(1, 15), 'Second')].join('\n'));
  assert.match(await runCalendar(token, ['next']), /^next\[3\]/, 'no count means three');
  assert.ok(!(await runCalendar(token, ['next'])).includes('Day off'), 'all-day events are not next');
  assert.equal(effectOf('calendar', { args: ['next', '2'] }, { bot: 'Pip', space: '/tmp/pip', secret: [] }).kind, 'safe');
});

test('a helper uses the connected calendar through crewd: no Google MCP, the token stays with crewd, adding asks first', async () => {
  const { db, crew, cfg, done } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  grantApps(cfg, 'quill', ['calendar']);
  await signInApp(crew.connections, 'calendar');
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

test('Chief makes a helper for a calendar job: its card names calendar, the yes grants only that, it reaches calendar and is refused Gmail in plain words', async () => {
  const { db, crew, done } = setup();
  crew.onboard('sir');
  await signInApp(crew.connections, 'calendar');
  await signInApp(crew.connections, 'gmail');
  store.clear(); asked.length = 0;
  const made = crew.post('chief', 'keep my calendar tidy [tool crew_create {"name":"Calendar Cleo","role":"Keeps your calendar tidy","job":{"does":"Keeps your Google Calendar tidy: spots clashes and gaps in your week.","aim":"Your week has no clashes and no surprises.","gets":"Days and events you point it at.","how":"Reads your calendar, lists clashes and gaps, and offers to move or add events.","great":"A clean week; for example, one clash found and flagged first."},"personality":"You are Calendar Cleo. Tidy and calm.","first":"Tidy my week","apps":["calendar"]}]') as Promise<{ task: number }>;
  await settled(db, (await made).task);
  const card = db.get("SELECT id, detail FROM asks WHERE bot = 'chief' AND kind = 'propose' AND state = 'open'")!;
  assert.match(card.detail, /Can use: Google Calendar/, 'the card names the one app the job needs');
  await crew.answer(card.id, { answer: 'allow' });
  assert.deepEqual(A.appsOf(crew.snapshot(), 'calendar-cleo'), [{ id: 'calendar', name: 'Google Calendar', connected: true }], 'the yes grants calendar and nothing else');
  const job = { does: 'Keeps your Google Calendar tidy.', aim: 'Your week has no clashes.', gets: 'Days you point it at.', how: 'Reads your calendar.', great: 'A clean week.' };
  await settled(db, (await crew.post('chief', `give Cleo this job [tool crew_create ${JSON.stringify({ bot: 'calendar-cleo', role: 'Keeps your calendar tidy', job, apps: ['gmail'] })}]`) as { task: number }).task);
  assert.match(lastSaid(db, 'chief'), /keeps the apps it has/, 'adapting refuses an apps list rather than dropping it');
  assert.equal(db.get("SELECT id FROM asks WHERE bot = 'chief' AND kind = 'propose' AND state = 'open'"), undefined);
  await settled(db, (await crew.post('chief', `give Cleo this job [tool crew_create ${JSON.stringify({ bot: 'calendar-cleo', role: 'Keeps your calendar tidy', job })}]`) as { task: number }).task);
  const adapt = db.get("SELECT id, detail FROM asks WHERE bot = 'chief' AND kind = 'propose' AND state = 'open'")!;
  assert.doesNotMatch(adapt.detail, /Can use/, 'adapting a helper names no grant change');
  await crew.answer(adapt.id, { answer: 'allow' });
  assert.deepEqual(A.appsOf(crew.snapshot(), 'calendar-cleo').map((a) => a.id), ['calendar'], 'adapting keeps the helper\'s apps');
  await settled(db, (await crew.post('chief', `send [tool crew_create ${JSON.stringify({ name: 'Send Sam', role: 'Sends mail', job, apps: ['gmailsend'] })}]`) as { task: number }).task);
  assert.match(lastSaid(db, 'chief'), /apps must be a list of drive, calendar, gmail, notion, canva/, 'the send connection is never granted to a helper');
  await settled(db, (await crew.post('chief', `send [tool crew_create ${JSON.stringify({ name: 'Draft Dan', role: 'Drafts mail', job, apps: ['gmailwrite'] })}]`) as { task: number }).task);
  assert.match(lastSaid(db, 'chief'), /apps must be a list of drive, calendar, gmail, notion, canva/, 'drafts and labels have no tool of their own, so they are never granted');
  // It reaches its one granted app.
  const look = crew.assign('calendar-cleo', 'look [tool calendar {"args":["week"]}]', 'chief').task;
  await settled(db, look);
  assert.match(task(db, look).result, /total: 0/);
  // Gmail is connected, but this job does not name it: refused, and nothing reaches Gmail.
  const mail = crew.assign('calendar-cleo', 'read [tool crew_app {"tool":"mail","input":{"args":["search","school"]}}]', 'chief').task;
  await settled(db, mail);
  assert.match(task(db, mail).result, /Gmail isn't part of this job, so you can't use it\. Tell the person that\./);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') = ?", mail)!.n, 0);
  done();
});
