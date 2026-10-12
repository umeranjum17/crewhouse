// A notice belongs to a case (its thread): the bank's warning is noticed once and kept, its
// confirmation reply follows up in the same thread naming the change, and unrelated mail adds
// nothing to the case. The model's words are scripted (GOLDEN); the stub still executes its mail
// read and crew_case calls for real, so the case rows and transcripts are honest.
import { signInApp } from './connect-fixture.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, settled, until } from './lab.ts';

process.env.CREWHOUSE_STUB_GOLDEN = '1';

const { GMAIL } = await import('../src/mail.ts');

const BANK = '18c0000000000011', NEWS = '18c0000000000012';
const FROM = 'Bank <alerts@bank.example>', SUBJECT = 'LOCI315: reply needed by Oct 8';
const WARN = 'We forwarded your insurance questions to the relevant team. Reply needed by Oct 8.';
const CONFIRM = 'Confirmed: the LOCI315 cover stays until October 23. Premium unchanged.';
const FACTS1 = 'LOCI315, reply by Oct 8, expiry Oct 23, confirmed: nothing yet';
const FACTS2 = 'LOCI315, cover confirmed until Oct 23, deadline Oct 8, confirmed: cover, not premium';
const msg = (from: string, subject: string, body: string, at: number) => ({
  internalDate: String(at),
  payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }], mimeType: 'text/plain', body: { data: Buffer.from(body).toString('base64url') } },
});
const threads: Record<string, any> = {};
const order: string[] = [];
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

test('a two-step case gives one notice and one follow-up; unrelated mail adds nothing', async () => {
  const { db, crew, done } = setup();
  await signInApp(crew.connections, 'gmail');
  const due = (id: number) => db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 1000, id);
  const fired = (id: number) => db.all("SELECT * FROM events WHERE kind = 'routine.fired' AND json_extract(data, '$.routine') = ? ORDER BY seq", id)
    .map((e) => JSON.parse(e.data).watch);
  const fire = async (id: number) => { const n = fired(id).length; due(id); crew.schedule(); await until('mail check recorded', () => fired(id).length > n); };
  const runtime = crew.runtime as any;
  const promptOf = (task: number) => runtime.specOf(db.get('SELECT session FROM tasks WHERE id = ?', task)!.session)?.message ?? '';
  const said = (task: number) => db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ?", task)?.text;

  crew.schedule(); // Gmail is connected: Chief keeps one quiet mail watch
  const r = db.get('SELECT * FROM routines WHERE mailwatch = 1')!;
  assert.ok(r, 'the watch exists');

  await fire(r.id); // first look: the empty mailbox is the baseline
  assert.deepEqual(fired(r.id), ['started']);

  threads[BANK] = { messages: [msg(FROM, SUBJECT, WARN, Date.now() + 1000)] }; order.push(BANK);
  await fire(r.id); // the warning: one first notice, and the case is kept
  assert.deepEqual(fired(r.id), ['started', 'mail']);
  const t1 = db.all('SELECT * FROM tasks WHERE routine = ? ORDER BY id', r.id).at(-1)!;
  await settled(db, t1.id);
  assert.doesNotMatch(t1.body, /— a case you hold:/, 'the first notice holds nothing yet');
  assert.match(said(t1.id) ?? '', /forwarded your insurance questions/);
  assert.match(said(t1.id) ?? '', /October 8.*not confirmed/);
  assert.match(said(t1.id) ?? '', new RegExp(`https://mail.google.com/mail/u/0/#inbox/${BANK}`));
  assert.equal(db.get('SELECT facts FROM cases WHERE thread = ?', BANK)?.facts, FACTS1);

  threads[BANK].messages.push(msg(FROM, SUBJECT, CONFIRM, Date.now() + 2000));
  await fire(r.id); // the confirmation reply: one follow-up in the same thread, naming the change
  assert.deepEqual(fired(r.id), ['started', 'mail', 'mail']);
  const t2 = db.all('SELECT * FROM tasks WHERE routine = ? ORDER BY id', r.id).at(-1)!;
  await settled(db, t2.id);
  assert.match(promptOf(t2.id), new RegExp(`a case you hold: ⟦${FACTS1}⟧`), 'the follow-up carries what Chief holds, marked as mail');
  assert.match(runtime.transcript(db.get('SELECT session FROM tasks WHERE id = ?', t2.id)!.session) ?? '', /cover stays until October 23/, 'the model read the new mail before judging');
  assert.match(said(t2.id) ?? '', /now confirmed.*October 23/);
  assert.match(said(t2.id) ?? '', /October 8 stays the deadline/);
  assert.match(said(t2.id) ?? '', /premium is still not confirmed/);
  assert.equal(db.get('SELECT facts FROM cases WHERE thread = ?', BANK)?.facts, FACTS2);

  threads[NEWS] = { messages: [msg('News <news@news.example>', 'Daily headlines', 'headlines', Date.now() + 3000)] }; order.push(NEWS);
  await fire(r.id); // unrelated mail: silence, and nothing added to the bank case
  assert.deepEqual(fired(r.id), ['started', 'mail', 'mail', 'mail']);
  const t3 = db.all('SELECT * FROM tasks WHERE routine = ? ORDER BY id', r.id).at(-1)!;
  await settled(db, t3.id);
  assert.equal(db.get('SELECT result FROM tasks WHERE id = ?', t3.id)!.result, 'All clear');
  assert.equal(said(t3.id), undefined, 'silence posts no message');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id IN (SELECT id FROM tasks WHERE routine = ?)", r.id)!.n, 2, 'still one notice and one follow-up');
  assert.equal(db.get('SELECT facts FROM cases WHERE thread = ?', BANK)?.facts, FACTS2, 'the case is untouched');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM cases')!.n, 1, 'noise opens no case');
  assert.match(runtime.transcript(db.get('SELECT session FROM tasks WHERE id = ?', t3.id)!.session), /^crew_case: error: /m, 'a thread the check did not show is refused');
  done();
});
