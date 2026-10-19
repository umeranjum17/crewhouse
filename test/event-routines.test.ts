// Email and meeting routines, end to end on crewd's own tick: the kit's real sign-in against a scripted Google, SQLite,
// the scheduler and the stub engine. A new matching email or a meeting coming due starts the helper once, across
// pages, a failed read, missed ticks and a restart; what the helper then does still asks like any other run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grantApps, setup, settled, until } from './lab.ts';
import { signInApp } from './connect-fixture.ts';
import { GMAIL, CALENDAR } from '../src/calendar.ts';
import { Crew } from '../src/crew.ts';
import { Store } from '../src/db.ts';

test('a new matching email or a due meeting starts its routine once, through failures and a restart; effects still ask', async () => {
  const lab = setup(); let { crew, db } = lab;
  const real = globalThis.fetch;
  let history = 90071992547409930n, fail = false, reads = 0, now = Date.now(); // past Number.MAX_SAFE_INTEGER: ids stay strings
  const mails = new Map<string, { from: string; subject: string; history: bigint; inbox: boolean }>(), meetings: any[] = [];
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  globalThis.fetch = (async (url: any, init: any) => {
    const text = String(url), u = new URL(text);
    if (text.startsWith(GMAIL)) {
      assert.equal(init.headers.authorization, 'Bearer tok');
      if (u.pathname.endsWith('/profile')) return json({ historyId: String(history) });
      if (u.pathname.endsWith('/history')) {
        reads++;
        if (fail) return json({ error: 'unavailable' }, 503);
        const fresh = [...mails].filter(([, m]) => m.history > BigInt(u.searchParams.get('startHistoryId')!)), page = u.searchParams.has('pageToken') ? fresh.slice(1) : fresh.slice(0, 1);
        return json({ historyId: String(history), history: page.map(([id, m]) => ({ messagesAdded: [{ message: { id, labelIds: m.inbox ? ['INBOX'] : ['SENT'] } }] })),
          ...(!u.searchParams.has('pageToken') && fresh.length > 1 ? { nextPageToken: 'second' } : {}) });
      }
      if (u.pathname.includes('/messages/')) {
        const m = mails.get(u.pathname.split('/').at(-1)!);
        return m ? json({ payload: { headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }] } }) : json({}, 404);
      }
      return json({ threads: [] }); // Chief's standing mail watch stays quiet
    }
    if (text.startsWith(CALENDAR)) {
      const page = u.searchParams.has('pageToken') ? meetings.slice(1) : meetings.slice(0, 1);
      return json({ items: page, ...(!u.searchParams.has('pageToken') && meetings.length > 1 ? { nextPageToken: 'next' } : {}) });
    }
    return real(url, init);
  }) as typeof fetch;
  let reopened = false;
  try {
    crew.recruit('reel', 'Reel', 'person'); grantApps(lab.cfg, 'reel', ['calendar']);
    const bank = { bot: 'reel', on: 'when an email from the bank with subject statement arrives', task: 'Tell me about the statement', name: 'Bank mail' };
    assert.throws(() => crew.addRoutine(bank, 'person'), /Connect Gmail first/, 'an email routine needs Gmail connected');
    await signInApp(crew.connections, 'gmail'); await signInApp(crew.connections, 'calendar');
    const mail = crew.addRoutine(bank, 'person');
    const meet = crew.addRoutine({ bot: 'reel', on: '10 minutes before each meeting', task: 'Cancel it [tool calendar {"args":["cancel","meeting123"]}]', name: 'Meetings' }, 'person');
    assert.deepEqual(crew.routines().filter((r) => r.bot === 'reel').map((r) => r.on), ['When an email from bank with subject statement arrives', '10 minutes before each meeting']);

    const row = (id: number) => db.get('SELECT * FROM routines WHERE id = ?', id)!, runs = (id: number) => db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', id)!.n;
    const tick = async () => { now += 60_001; crew.schedule(now); await until('event checks finish', () => !(crew as any).checking.size); };
    const receive = (id: string, from: string, subject: string, inbox = true) => mails.set(id, { from, subject, history: ++history, inbox });

    receive('oldmail', 'bank@example.test', 'Statement'); await tick();
    assert.equal(runs(mail.id), 0, 'the first look is a baseline: mail already there never starts it');
    receive('offer', 'bank@example.test', 'Offer'); receive('shop', 'shop@example.test', 'Statement'); receive('sent', 'bank@example.test', 'Statement', false);
    await tick(); assert.equal(runs(mail.id), 0, 'sender, subject and incoming-only all apply');

    receive('newmail', 'BANK <alerts@bank.example>', 'Your October STATEMENT');
    fail = true; const cursor = row(mail.id).cursor; await tick();
    assert.equal(row(mail.id).cursor, cursor, 'a failed read never moves the cursor');
    assert.match(db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'system' ORDER BY id DESC")!.text, /“Bank mail” couldn't check Gmail: Gmail said 503\. I'll keep trying\./);
    fail = false; await tick();
    const fired = row(mail.id).last_task; await settled(db, fired);
    assert.equal(runs(mail.id), 1);
    const body = db.get('SELECT body FROM tasks WHERE id = ?', fired)!.body;
    assert.match(body, /Your October STATEMENT — BANK <alerts@bank\.example> \(https:\/\/mail\.google\.com\/mail\/u\/0\/#inbox\/newmail\)/);
    assert.doesNotMatch(body, /Offer|oldmail|shop@/);
    assert.match(db.get("SELECT text FROM messages WHERE task_id = ? AND author = 'bot'", fired)!.text, /Your October STATEMENT/, 'the helper’s answer about that email reaches the app');
    assert.deepEqual(crew.routines().find((r) => r.id === mail.id)!.history.map((h: any) => [h.why, h.task]), [['event', fired]]);

    const asked = reads; crew.schedule(now); await until('same-minute checks finish', () => !(crew as any).checking.size);
    assert.equal(reads, asked, 'Google is asked at most once a minute, not every tick');

    const at = (min: number) => new Date(now + min * 60_000).toISOString();
    meetings.push({ id: 'allday', start: { date: '2099-01-01' }, end: { date: '2099-01-02' } },
      { id: 'meeting123', summary: 'Test meeting', start: { dateTime: at(12) }, end: { dateTime: at(60) } },
      { id: 'cancelled', status: 'cancelled', start: { dateTime: at(12) }, end: { dateTime: at(60) } });
    now += 180_000; await tick();
    assert.equal(runs(meet.id), 1, 'a missed tick still catches the due meeting, on the second page');
    assert.match(db.get('SELECT body FROM tasks WHERE id = ?', row(meet.id).last_task)!.body, /Test meeting/);
    await until('the cancel asks first', () => db.get("SELECT 1 FROM asks WHERE kind = 'permission' AND state = 'open'"));
    assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'run.call' AND json_extract(data, '$.name') = 'calendar'")!.n, 0, 'the event never skips the approval');
    await crew.answer(db.get("SELECT id FROM asks WHERE kind = 'permission' AND state = 'open'")!.id, { answer: 'deny' });
    await settled(db, row(meet.id).last_task);

    await crew.stop(); lab.done();
    db = new Store(lab.cfg.stateDir); crew = new Crew(lab.cfg, db); crew.init(); reopened = true;
    await signInApp(crew.connections, 'gmail'); await signInApp(crew.connections, 'calendar');
    await tick(); await tick();
    assert.equal(runs(mail.id), 1, 'the saved mail cursor: no repeat after a restart');
    assert.equal(runs(meet.id), 1, 'the saved meeting cursor: no repeat after a restart');
    receive('aftersleep', 'bank@example.test', 'Statement after sleep'); now += 3_600_000; await tick();
    assert.equal(runs(mail.id), 2, 'mail that came while crewd was away still counts');
    await settled(db, row(mail.id).last_task);
  } finally {
    await crew.stop(); if (reopened) db.close(); else lab.done(); globalThis.fetch = real;
  }
});
