// The day, planned: Scout reads today's calendar, what is new in the mail and what is still open, and answers in one
// message with the three things that matter, in order, at times that fit. Reading the person's own calendar and mail is
// free (no card), nothing is ever sent, and with Google not on for the house the plan still comes, saying in plain words
// what it could not see. The Home row is the promise: it waits on Google until the person connects it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { setup, until, settled, holding, release, task } = await import('./lab.ts');
const { CALENDAR } = await import('../src/calendar.ts');
const { GMAIL } = await import('../src/mail.ts');
const { effectOf } = await import('../src/policy.ts');

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const at = (inHours: number) => new Date(Date.now() + inHours * 3_600_000).toISOString();

// Google's two APIs, stood in for: crewd's own token is checked, and only our fixture data comes back.
const asked: string[] = [];
const real = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  const where = String(url);
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
  if (where.startsWith(CALENDAR) || where.startsWith(GMAIL)) {
    asked.push(`${init.method ?? 'GET'} ${where} ${init.headers?.authorization ?? ''}`);
    if (!asked.at(-1)!.includes('Bearer tok')) return json({}, 401);
    const path = new URL(where).pathname.replace('/gmail/v1/users/me', '');
    if (path === '/labels/INBOX') return json({ id: 'INBOX', name: 'INBOX', threadsUnread: 2, messagesUnread: 2 });
    if (path === '/threads') return json({ threads: [{ id: '18c0a1f00d2e3b4a' }], resultSizeEstimate: 1 });
    if (path.startsWith('/threads/')) return json({ messages: [{ internalDate: String(Date.now() - 40 * 60_000), payload: {
      headers: [{ name: 'From', value: 'School Office <office@school.example>' }, { name: 'Subject', value: 'Trip on Friday, forms' }],
      mimeType: 'text/plain', body: { data: b64('Please return the signed form before Friday.') } } }] });
    return json({ items: [{ id: 'ev1abc', summary: 'Sports day', start: { dateTime: at(1) }, end: { dateTime: at(4) } }] });
  }
  return real(url, init);
}) as typeof fetch;
after(() => { globalThis.fetch = real; });

const PLAN = 'Two fixed things today, and a form to sign.\n'
  + '1. 08:40 - Sign the school trip form, the office wants it before the run.\n'
  + '2. 13:15 - Ring the shop back, the refund waits on you.\n'
  + '3. 18:30 - Pack the kit bag for tomorrow, it goes in the car.';
const PLAN_OFF = "I couldn't read your calendar or your mail: Google isn't on for the house.\n"
  + '1. 09:00 - Post the shop return, the window closes on Friday.\n'
  + '2. 19:30 - Sign the school form at the kitchen table.';

const house = (cfg: any) => writeFileSync(join(cfg.stateDir, 'apps.json'), JSON.stringify({ google: { id: 'crew.apps', secret: 'pasted' } }), { mode: 0o600 });
const connect = (cfg: any, ...ids: string[]) => {
  mkdirSync(join(cfg.stateDir, 'people', '1'), { recursive: true });
  writeFileSync(join(cfg.stateDir, 'people', '1', 'connections.json'),
    JSON.stringify(Object.fromEntries(ids.map((id) => [id, { access: 'tok', expires: Date.now() + 3_600_000 }]))));
};
const items = (text: string) => (text.match(/^\d+\./gm) ?? []).length;
const rowOf = (crew: any) => crew.snapshot().ideas.find((i: any) => /what today actually is/.test(i.promise));
const hired = () => { const l = setup(); l.crew.onboard('sir'); l.crew.recruit('scout', 'Scout', 'person'); return l; };
const told = (db: any, t: number) => db.all('SELECT text FROM messages WHERE bot = ? AND author = ? AND task_id = ?', 'scout', 'bot', t);

test('Home lists the day, planned, and says it waits on Google rather than dead-ending', () => {
  const { crew, cfg, done } = hired();
  const first = rowOf(crew);
  assert.equal(first.bot, 'scout');
  assert.equal(first.group, 'life', 'an everyday job, beside the money ones');
  assert.equal(first.ask, "Give me my day: what's on, what's waiting on me, what to do first");
  assert.deepEqual(first.needs, ['Google'], 'two of the household’s apps name one thing');
  house(cfg);
  assert.deepEqual(rowOf(crew).needs, ['Google Calendar', 'Gmail'], 'Google is on; now it waits on this person’s own apps');
  connect(cfg, 'calendar');
  assert.deepEqual(rowOf(crew).needs, ['Gmail']);
  connect(cfg, 'calendar', 'gmail');
  const ready = crew.snapshot().ideas;
  const day = ready.find((i: any) => /what today actually is/.test(i.promise));
  assert.ok(day, 'the job stays on the list');
  assert.deepEqual(day.needs, [], 'read both, and the job is ready to hand over');
  assert.ok(ready.slice(0, 6).some((i: any) => /what today actually is/.test(i.promise)), 'a job ready to hand over counts against the six');
  done();
});

test('the day, planned reads the calendar and the mail for free, answers once with three things in order, and sends nothing', async () => {
  const { crew, cfg, db, done } = hired();
  house(cfg); connect(cfg, 'calendar', 'gmail');
  asked.length = 0;
  const t = crew.assign('scout', 'give me my day [tool calendar {"args":["today"]}] [tool calendar {"args":["week"]}] [tool mail {"args":["inbox"]}] ask permission', 'chief').task;
  await holding(crew, 'scout');
  const seen = (crew.runtime as any).transcript(crew.sessionOf('scout')!.key); // what the helper's tools said
  await release(crew, 'scout', PLAN);
  await settled(db, t);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM asks')!.n, 0, 'reading the person’s own calendar and mail never asks');
  assert.ok(asked.length >= 3 && asked.every((a) => a.endsWith('Bearer tok')), 'every read went out with crewd’s own token');
  assert.match(seen, /Sports day/, 'what the calendar says reached the helper');
  assert.match(seen, /Trip on Friday, forms/, 'what the mail says reached the helper');
  const msgs = told(db, t);
  assert.equal(msgs.length, 1, 'one message, not a trail of notes');
  assert.equal(msgs[0].text, PLAN);
  assert.equal(items(msgs[0].text), 3, 'three things that matter, no more');
  assert.match(msgs[0].text, /1\..*2\..*3\./s, 'in order');
  assert.equal(task(db, t).state, 'done');
  assert.equal(db.all('SELECT kind FROM events').filter((e: any) => /sent|draft|money/.test(e.kind)).length, 0, 'nothing left this computer');
  const s = { bot: 'Scout', space: '/tmp/scout', secret: [] };
  assert.equal(effectOf('mail', { args: ['send', 'boss@work.example', 'Done.'] }, s).kind, 'refuse', 'the mail stays read-only');
  assert.equal(effectOf('calendar', { args: ['add', 'Something', 'tomorrow 09:00'] }, s).kind, 'send', 'adding to the calendar is a card of its own');
  done();
});

test('a person who likes the list is offered the weekday mornings, and nothing runs until they say yes', async () => {
  const { crew, cfg, db, done } = hired();
  house(cfg); connect(cfg, 'calendar', 'gmail');
  const offer = `[tool crew_routine ${JSON.stringify({ when: 'weekdays 8am', name: 'The day, planned',
    task: "read today's calendar, what is new in the mail and what is still open, then send me the three things that matter today, in order, with times that fit" })}]`;
  const t = crew.assign('scout', `I like that, set it going ${offer} ask permission`, 'chief').task;
  await until('the offered routine', () => db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'"));
  const card = db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'")!;
  const preview = JSON.parse(card.detail).preview.body as string;
  assert.match(preview, /Weekdays at 8:00 am/, 'the weekday mornings, not every day');
  assert.match(preview, /Scout will read today/, 'whose chat it lands in, and what it reads');
  assert.match(preview, /Tells you each time it runs/, 'a morning plan speaks; it is not a quiet check-in');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM routines WHERE bot = 'scout'")!.n, 0, 'nothing runs until the person says yes');
  await release(crew, 'scout', PLAN);
  await settled(db, t);
  await crew.answer(card.id, { answer: 'allow' });
  const r = db.get("SELECT * FROM routines WHERE bot = 'scout'")!;
  assert.equal(r.schedule, 'weekdays 8am');
  assert.equal(r.quiet, 0, 'it speaks every weekday morning');
  assert.equal(r.member, 1, 'and it is this person’s morning');
  assert.match(r.body, /three things that matter today, in order, with times that fit/);
  done();
});

test('with Google off for the house the day is still planned, and it says what it could not read', async () => {
  const { crew, cfg, db, done } = hired();
  house(cfg); // the household's Google is there; this person has connected nothing, so there is nothing to read
  const t = crew.assign('scout', 'give me my day. still open with you: the shop return, and the school form'
    + ' [tool crew_connect {"app":"calendar"}] ask permission', 'chief').task;
  await until('the Connect card', () => db.get("SELECT * FROM asks WHERE state = 'open' AND kind = 'connect'"));
  const card = db.get("SELECT * FROM asks WHERE state = 'open' AND kind = 'connect'")!;
  assert.equal(JSON.parse(card.detail).words, 'Let Scout use your Google Calendar', 'it asks for the one app, in the person’s own words');
  await release(crew, 'scout', PLAN_OFF);
  await until('Scout’s plan in the chat', () => told(db, t).length === 1); // the card was opened mid-turn, so the task was waiting already
  await settled(db, t);
  const msgs = told(db, t);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].text, /couldn't read your calendar or your mail/, 'it says plainly what it could not see');
  assert.equal(items(msgs[0].text), 2, 'what it could see still makes a plan');
  assert.match(msgs[0].text, /shop return/);
  assert.match(msgs[0].text, /school form/);
  assert.equal(task(db, t).state, 'needs_you', 'the job waits on the card, and goes on once they answer');
  assert.equal(db.all('SELECT kind FROM events').filter((e: any) => /sent|draft/.test(e.kind)).length, 0, 'nothing was sent in their name');
  done();
});
