// Chief's mail watch: while Gmail is connected a quiet routine notices only mail newer than its cursor.
// Old mail is never noticed, a run with nothing new starts no task, and the one task carries the shape
// instruction plus a working link per thread. The model itself judges what matters (proved on the real model).
import { signInApp } from './connect-fixture.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, settled, until } from './lab.ts';

const { GMAIL } = await import('../src/mail.ts');

const now = Date.now();
const msg = (from: string, subject: string, at: number) => ({
  internalDate: String(at),
  payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }], mimeType: 'text/plain', body: { data: Buffer.from('body').toString('base64url') } },
});
// The mailbox, oldest first: one old thread, then (added later) five unimportant threads and one important one.
const threads: Record<string, any> = {
  '18c0000000000001': { messages: [msg('Old Newsletter <news@old.example>', 'Old newsletter', now - 3 * 86_400_000)] },
};
const order: string[] = ['18c0000000000001'];
const real = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  if (!String(url).startsWith(GMAIL)) return real(url, init);
  const u = new URL(String(url));
  const path = u.pathname.replace('/gmail/v1/users/me', '');
  const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
  if (path === '/threads') return json({ threads: [...order].reverse().map((id) => ({ id })) });
  const t = threads[path.split('/threads/')[1]];
  return json(t ?? {});
}) as typeof fetch;
after(() => { globalThis.fetch = real; });

test("Chief's mail watch notices only new mail, once, with links", async () => {
  const { db, crew, done } = setup();
  await signInApp(crew.connections, 'gmail');
  const due = (id: number) => db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 1000, id);
  const fired = (id: number) => db.all("SELECT * FROM events WHERE kind = 'routine.fired' AND json_extract(data, '$.routine') = ? ORDER BY seq", id)
    .map((e) => JSON.parse(e.data).watch);
  const fire = async (id: number) => { const n = fired(id).length; due(id); crew.schedule(); await until('mail check recorded', () => fired(id).length > n); };

  crew.schedule(); // Gmail is connected: Chief keeps one quiet mail watch
  const r = db.get('SELECT * FROM routines WHERE mailwatch = 1')!;
  assert.ok(r, 'the watch exists');
  assert.equal(r.bot, 'chief');
  assert.equal(r.quiet, 1, 'silent unless something matters');

  await fire(r.id); // first look: the old mail is the baseline, never noticed
  assert.deepEqual(fired(r.id), ['started']);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 0, 'old mail starts no task');

  // Six new threads arrive: five noise, one that matters.
  const at = Date.now();
  const fresh: [string, string, string][] = [
    ['18c0000000000002', 'Shop <no-reply@shop.example>', 'Your order shipped'],
    ['18c0000000000003', 'News <news@news.example>', 'Daily headlines'],
    ['18c0000000000004', 'Social <noreply@social.example>', 'You have new followers'],
    ['18c0000000000005', 'Bank <alerts@bank.example>', 'LOC1315: reply needed by Oct 8'],
    ['18c0000000000006', 'Receipts <no-reply@shop.example>', 'Receipt for order 43'],
    ['18c0000000000007', 'Ads <ads@ads.example>', 'Sale ends Sunday'],
  ];
  fresh.forEach(([id, from, subject], i) => { threads[id] = { messages: [msg(from, subject, at + i)] }; order.push(id); });
  await fire(r.id);
  assert.deepEqual(fired(r.id), ['started', 'mail']);
  const tasks = db.all('SELECT * FROM tasks WHERE routine = ? ORDER BY id', r.id);
  assert.equal(tasks.length, 1, 'one task for the whole batch, whatever the model then decides');
  assert.equal(tasks[0].bot, 'chief');
  assert.doesNotMatch(tasks[0].body, /Old newsletter/, 'mail older than the first look is never noticed');
  await settled(db, tasks[0].id); // the run must finish before the next check, or overlap skips it
  for (const [id] of fresh) assert.match(tasks[0].body, new RegExp(`https://mail.google.com/mail/u/0/#inbox/${id}`), 'every new thread carries a working link');

  // The model's turn had the shape instruction, the links and the quiet way out.
  const session = db.get('SELECT session FROM tasks WHERE id = ?', tasks[0].id)!.session;
  const prompt = (crew.runtime as any).specOf(session)?.message ?? '';
  assert.match(prompt, /what is not confirmed yet/);
  assert.match(prompt, /reply exactly ALL-CLEAR/);
  assert.match(prompt, new RegExp(`https://mail.google.com/mail/u/0/#inbox/18c0000000000005`));
  // Whatever the model said landed once in Chief's chat: that message is what the phone is pushed.
  assert.equal(db.get("SELECT COUNT(*) AS n FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ?", tasks[0].id)!.n, 1);

  await fire(r.id); // nothing new: silence, no second task
  assert.deepEqual(fired(r.id), ['started', 'mail', 'same']);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 1, 'a quiet run starts nothing');
  done();
});
