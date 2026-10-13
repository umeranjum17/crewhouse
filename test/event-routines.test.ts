// Event routines traverse real kit sign-in, crewd's scheduler, persisted SQLite and the stub engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, settled, until } from './lab.ts';
import { signInApp } from './connect-fixture.ts';
import { parseTrigger, describeTrigger } from '../src/routines.ts';
import { GMAIL } from '../src/mail.ts';
import { CALENDAR } from '../src/calendar.ts';
import { Crew } from '../src/crew.ts';
import { Store } from '../src/db.ts';

test('plain event words keep literal sender and subject matches', () => {
  const mail = parseTrigger('when an email from Bank@example.com with subject Statement arrives');
  assert.deepEqual(mail, { mail: true, from: 'Bank@example.com', subject: 'Statement' });
  assert.equal(describeTrigger(mail, 'Scout'), 'When an email from Bank@example.com with subject Statement arrives');
  assert.deepEqual(parseTrigger('when new mail arrives'), { mail: true, from: '', subject: '' });
  assert.deepEqual(parseTrigger('when an email from the bank arrives'), { mail: true, from: 'bank', subject: '' });
  assert.deepEqual(parseTrigger('10 minutes before each meeting'), { calendar: 10 });
  assert.deepEqual(parseTrigger('when a calendar event starts'), { calendar: 0 });
  assert.throws(() => parseTrigger('2000 minutes before each meeting'), /can't start/);
});

test('new mail and meeting starts fire once across pages, missed ticks and restart; effects still ask', async () => {
  const lab = setup(); let { crew, db } = lab;
  const real = globalThis.fetch, base = 90071992547409930n;
  let history = base, fail = false, checks = 0, now = Date.now();
  const messages = new Map<string, { from: string; subject: string; history: bigint; inbox: boolean }>();
  const meetings: any[] = [];
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  globalThis.fetch = (async (url: any, init: any) => {
    const text = String(url), u = new URL(text);
    if (text.startsWith(GMAIL)) {
      assert.equal(init.headers.authorization, 'Bearer tok');
      if (u.pathname.endsWith('/profile')) return json({ historyId: String(history) });
      if (u.pathname.endsWith('/history')) {
        checks++;
        if (fail) return json({ error: 'temporarily unavailable' }, 503);
        const fresh = [...messages].filter(([, m]) => m.history > BigInt(u.searchParams.get('startHistoryId')!));
        const page = u.searchParams.has('pageToken') ? fresh.slice(1) : fresh.slice(0, 1);
        return json({ historyId: String(history), history: page.map(([id, m]) => ({ messagesAdded: [{ message: { id, labelIds: m.inbox ? ['INBOX'] : ['SENT'] } }, { message: { id, labelIds: m.inbox ? ['INBOX'] : ['SENT'] } }] })),
          ...(!u.searchParams.has('pageToken') && fresh.length > 1 ? { nextPageToken: 'second' } : {}) });
      }
      if (u.pathname.includes('/messages/')) {
        const m = messages.get(u.pathname.split('/').at(-1)!);
        return json({ payload: { headers: [{ name: 'From', value: m?.from }, { name: 'Subject', value: m?.subject }] } });
      }
      return json({ threads: [] }); // the standing mail watch stays quiet
    }
    if (text.startsWith(CALENDAR)) {
      const page = u.searchParams.has('pageToken') ? meetings.slice(1) : meetings.slice(0, 1);
      return json({ items: page, ...(!u.searchParams.has('pageToken') && meetings.length > 1 ? { nextPageToken: 'next' } : {}) });
    }
    return real(url, init);
  }) as typeof fetch;
  let reopened = false;
  try {
    crew.recruit('reel', 'Reel', 'person');
    await signInApp(crew.connections, 'gmail'); await signInApp(crew.connections, 'calendar');
    const mail = crew.addRoutine({ bot: 'reel', on: 'when an email from the bank with subject statement arrives', task: 'Tell me about the statement', name: 'Bank mail' }, 'person');
    const calendar = crew.addRoutine({ bot: 'reel', on: '10 minutes before each meeting', task: '[tool calendar {"args":["cancel","meeting123"]}]', name: 'Meetings' }, 'person');
    const row = (id: number) => db.get('SELECT * FROM routines WHERE id = ?', id)!;
    const count = (id: number) => db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', id)!.n;
    const poll = async () => { now += 60_001; crew.schedule(now); await until('event checks finish', () => !(crew as any).checking.size); };
    const receive = (id: string, from: string, subject: string, inbox = true) => messages.set(id, { from, subject, history: ++history, inbox });
    receive('oldmail', 'bank@example.test', 'Statement'); await poll();
    assert.equal(count(mail.id), 0, 'first history is a baseline, never old mail');
    receive('wrongsubject', 'bank@example.test', 'Offer'); receive('wrongfrom', 'shop@example.test', 'Statement'); receive('sent', 'bank@example.test', 'Statement', false);
    await poll(); assert.equal(count(mail.id), 0, 'sender, subject and incoming-mail filters all apply');
    receive('newmail', 'BANK@example.test', 'New STATEMENT');
    fail = true; const cursor = row(mail.id).cursor; await poll();
    assert.equal(row(mail.id).cursor, cursor, 'an incomplete read never advances the cursor');
    assert.match(db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'system' ORDER BY id DESC")!.text, /503/);
    fail = false; await poll(); const fired = row(mail.id).last_task;
    await settled(db, fired);
    assert.equal(count(mail.id), 1); assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', fired)!.state, 'done');
    assert.match(db.get('SELECT body FROM tasks WHERE id = ?', fired)!.body, /New STATEMENT/);
    assert.doesNotMatch(db.get('SELECT body FROM tasks WHERE id = ?', fired)!.body, /Offer|oldmail|wrongfrom/);
    assert.match(db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ?", fired)!.text, /New STATEMENT/, 'Chief brings this event task’s result back to the app');
    const before = checks; crew.schedule(now); await until('same-tick checks finish', () => !(crew as any).checking.size);
    assert.equal(checks, before, 'polling is tick-driven and bounded to once a minute');
    const start = new Date(now + 600_000).toISOString(), end = new Date(now + 3_600_000).toISOString();
    meetings.push({ id: 'allday', start: { date: '2099-01-01' }, end: { date: '2099-01-02' } },
      { id: 'meeting123', summary: 'Test meeting', start: { dateTime: start }, end: { dateTime: end } },
      { id: 'cancelled', status: 'cancelled', start: { dateTime: start }, end: { dateTime: end } });
    now += 180_000; await poll();
    assert.equal(count(calendar.id), 1, 'a missed tick catches the due timed event on the second page');
    await until('calendar effect asks', () => db.get("SELECT 1 FROM asks WHERE kind = 'permission' AND state = 'open'"));
    assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'run.call' AND json_extract(data, '$.name') = 'calendar'")!.n, 0, 'the event never bypasses the delete approval');
    await crew.answer(db.get("SELECT id FROM asks WHERE kind = 'permission' AND state = 'open'")!.id, { answer: 'deny' });
    await settled(db, row(calendar.id).last_task);
    await crew.stop(); lab.done();
    db = new Store(lab.cfg.stateDir); crew = new Crew(lab.cfg, db); crew.init(); reopened = true;
    await signInApp(crew.connections, 'gmail'); await signInApp(crew.connections, 'calendar');
    await poll();
    assert.equal(count(mail.id), 1, 'the persisted history prevents restart duplicates');
    assert.equal(count(calendar.id), 1, 'the persisted event id prevents restart duplicates');
    assert.deepEqual(JSON.parse(row(calendar.id).cursor).seen, ['meeting123']);
    receive('aftersleep', 'bank@example.test', 'Statement after sleep'); now += 3_600_000; await poll();
    assert.equal(count(mail.id), 2, 'mail since a missed tick is not dropped');
    await settled(db, row(mail.id).last_task);
  } finally {
    await crew.stop(); if (reopened) db.close(); else lab.done(); globalThis.fetch = real;
  }
});
