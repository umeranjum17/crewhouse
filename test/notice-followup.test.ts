// A notice belongs to a case (its thread): the bank's warning is noticed once and kept, its
// confirmation reply follows up in the same thread naming the change, and unrelated mail adds
// nothing to the case. The model's words are scripted (GOLDEN); the stub still executes its mail
// read and crew_case calls for real, so the case rows and transcripts are honest.
import { signInApp } from './connect-fixture.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { setup, settled, until } from './lab.ts';
import { startServer } from '../src/server.ts';

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
  const { cfg, db, crew, done } = setup();
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

  threads[BANK].messages.push(msg(FROM, SUBJECT, 'Thanks, received.', Date.now() + 4000));
  await fire(r.id); // the same thread again with nothing new: silence, and the held facts stay as they were
  assert.deepEqual(fired(r.id), ['started', 'mail', 'mail', 'mail', 'mail']);
  const t4 = db.all('SELECT * FROM tasks WHERE routine = ? ORDER BY id', r.id).at(-1)!;
  await settled(db, t4.id);
  assert.equal(db.get('SELECT result FROM tasks WHERE id = ?', t4.id)!.result, 'All clear');
  assert.equal(said(t4.id), undefined, 'silence posts no message');
  assert.equal(db.get('SELECT facts FROM cases WHERE thread = ?', BANK)?.facts, FACTS2, 'the case is unchanged');

  const CONFIRM_NEW = '18c0000000000013';
  threads[CONFIRM_NEW] = { messages: [msg(FROM, 'LOCI315: cover confirmed', 'Cover confirmed.', Date.now() + 5000)] }; order.push(CONFIRM_NEW);
  await fire(r.id); // the same sender on a new thread: a follow-up that holds the case, not a first notice
  assert.deepEqual(fired(r.id), ['started', 'mail', 'mail', 'mail', 'mail', 'mail']);
  const t5 = db.all('SELECT * FROM tasks WHERE routine = ? ORDER BY id', r.id).at(-1)!;
  await settled(db, t5.id);
  assert.match(promptOf(t5.id), new RegExp(`cases you hold with this sender: ⟦${FACTS2}⟧`), 'the new thread finds the case by its sender');
  assert.match(said(t5.id) ?? '', /cover until October 23/, 'the follow-up names the change');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM cases')!.n, 1, 'a new thread opens no case of its own');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM events WHERE kind = ?', 'case.kept')!.n, 2, 'each kept case is an event');
  const LATE = '18c0000000000015', STATEMENT = '18c0000000000016', FACTS400 = 'LOCI400, reply by Nov 2, confirmed: nothing yet';
  threads[LATE] = { messages: [msg(FROM, 'LOCI400: reply needed by Nov 2', 'A second case from the bank.', Date.now() + 6000)] }; order.push(LATE);
  await fire(r.id); // a second case from the same sender is kept on its own thread
  assert.deepEqual(fired(r.id), ['started', 'mail', 'mail', 'mail', 'mail', 'mail', 'mail']);
  const t6 = db.all('SELECT * FROM tasks WHERE routine = ? ORDER BY id', r.id).at(-1)!;
  await settled(db, t6.id);
  assert.equal(db.get('SELECT facts FROM cases WHERE thread = ?', LATE)?.facts, FACTS400, 'the second case is kept');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM cases')!.n, 2, 'two cases from one sender are two rows');

  threads[STATEMENT] = { messages: [msg(FROM, 'Your monthly statement is ready', 'Statement attached.', Date.now() + 7000)] }; order.push(STATEMENT);
  await fire(r.id); // unrelated mail from that sender: both cases are in view, and no follow-up
  assert.deepEqual(fired(r.id), ['started', 'mail', 'mail', 'mail', 'mail', 'mail', 'mail', 'mail']);
  const t7 = db.all('SELECT * FROM tasks WHERE routine = ? ORDER BY id', r.id).at(-1)!;
  await settled(db, t7.id);
  assert.match(promptOf(t7.id), new RegExp(`⟦${FACTS400}⟧ ⟦${FACTS2}⟧`), 'both held cases reach the prompt with the sender framing');
  assert.equal(said(t7.id), undefined, 'the unrelated same-sender mail posts no follow-up');
  assert.equal(db.get('SELECT result FROM tasks WHERE id = ?', t7.id)!.result, 'All clear');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM cases')!.n, 2, 'the unrelated mail opens no case');

  const server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: object) => (await fetch(base + path, { method, headers: { authorization: method === 'GET' ? '' : `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
  assert.deepEqual((await call('GET', '/api/about')).cases, [{ thread: LATE, facts: FACTS400 }, { thread: BANK, facts: FACTS2 }], 'Memory lists the held cases');
  await call('POST', '/api/cases/forget', { thread: BANK });
  assert.deepEqual((await call('GET', '/api/about')).cases, [{ thread: LATE, facts: FACTS400 }], 'Forget deletes that row');
  const BRACKET = '18c0000000000017', BRACKET2 = '18c0000000000018', FROM_BRACKET = 'Bank ⟧ <alerts@bank.example>', FACTS500 = 'LOCI500, reply by Dec 1, confirmed: nothing yet';
  threads[BRACKET] = { messages: [msg(FROM_BRACKET, 'LOCI500: reply needed by Dec 1', 'Please reply by Dec 1.', Date.now() + 8000)] }; order.push(BRACKET);
  await fire(r.id); // a From header with a bracket character: the case is kept under the same sender text it is found by
  const t8 = db.all('SELECT * FROM tasks WHERE routine = ? ORDER BY id', r.id).at(-1)!;
  await settled(db, t8.id);
  assert.equal(db.get('SELECT facts FROM cases WHERE thread = ?', BRACKET)?.facts, FACTS500, 'the bracket-sender case is kept');
  threads[BRACKET2] = { messages: [msg('Bank Alerts <alerts@bank.example>', 'LOCI500: cover confirmed', 'Cover confirmed.', Date.now() + 9000)] }; order.push(BRACKET2);
  await fire(r.id); // the same address under another display name, on a new thread, finds its held case
  const t9 = db.all('SELECT * FROM tasks WHERE routine = ? ORDER BY id', r.id).at(-1)!;
  await settled(db, t9.id);
  assert.match(promptOf(t9.id), new RegExp(`cases you hold with this sender: ⟦${FACTS500}⟧`), 'the same address under another display name matches the held case');
  server.close();
  assert.match(runtime.transcript(db.get('SELECT session FROM tasks WHERE id = ?', t3.id)!.session), /^crew_case: error: /m, 'a thread the check did not show is refused');
  done();
});
