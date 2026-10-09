import { signInApp } from './connect-fixture.ts';
// mail-axi against a stand-in Gmail (its REST API, in memory): what is new, a search, a conversation without its quoted
// history and cut to size; and the gate: everything it can do is reading, anything else is refused.
import { test, after } from 'node:test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeviceLink, pairWithOffer } from '@byokit/link';
import { startServer } from '../src/server.ts';
import assert from 'node:assert/strict';
import { setup, settled, task, until } from './lab.ts';

const { GMAIL, ageOf, bodyOf, runMail } = await import('../src/mail.ts');
const { effectOf, toolWords } = await import('../src/policy.ts');

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const now = Date.now();
const msg = (from: string, subject: string, minsAgo: number, payload: object) => ({ internalDate: String(now - minsAgo * 60_000), payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }], ...payload } });
const threads: Record<string, any> = {
  '18c0a1f00d2e3b4a': { messages: [
    msg('School Office <office@school.example>', 'Trip on Friday, forms', 3000, { mimeType: 'text/plain', body: { data: b64('Please return the form.') } }),
    msg('Sam <sam@home.example>', 'Re: Trip on Friday, forms', 90, { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/html', body: { data: b64('<p>Signed &amp; sent.</p>') } },
      { mimeType: 'text/plain', body: { data: b64('Signed and sent.\n\nOn Tue, School Office wrote:\n> Please return the form.') } }] }),
  ] },
  '18c0b2f00d2e3b4a': { messages: [msg('Shop <no-reply@shop.example>', 'Your order', 5, { mimeType: 'text/html', body: { data: b64(`<style>x{}</style><div>Order 42</div>${'word '.repeat(600)}`) } })] },
};
const asked: string[] = [];
let identity = '';
const real = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo' && identity) return real(identity, init);
  if (!String(url).startsWith(GMAIL)) return real(url, init);
  const u = new URL(String(url));
  const path = u.pathname.replace('/gmail/v1/users/me', '');
  asked.push(`${init.method ?? 'GET'} ${path}${u.search} ${init.headers?.authorization}`);
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
  if (init.headers?.authorization !== 'Bearer tok') return json({}, 401);
  if (path === '/labels/INBOX') return json({ threadsUnread: 2 });
  if (path === '/threads') return json({ threads: u.searchParams.get('q') === 'from:school' ? [{ id: '18c0a1f00d2e3b4a' }] : [{ id: '18c0b2f00d2e3b4a' }, { id: '18c0a1f00d2e3b4a' }], resultSizeEstimate: u.searchParams.get('q') ? 1 : 2 });
  const t = threads[path.split('/threads/')[1]];
  return t ? json(t) : json({}, 404);
}) as typeof fetch;
after(() => { globalThis.fetch = real; });
const token = async () => 'tok';

test('mail-axi: what is new, a search, a conversation without its quoted history, cut to size', async () => {
  assert.equal(ageOf(now - 5 * 60_000, now), '5m');
  assert.equal(ageOf(now - 3 * 3_600_000, now), '3h');
  assert.equal(ageOf(now - 50 * 3_600_000, now), '2d');
  assert.equal(await runMail(token, []), [
    'unread: 2',
    'newest[2]{id,from,subject,age}:',
    '  18c0b2f00d2e3b4a,Shop <no-reply@shop.example>,Your order,5m',
    '  18c0a1f00d2e3b4a,Sam <sam@home.example>,"Trip on Friday, forms",2h',
    'help[3]:'].join('\n') + '\n' + (await runMail(token, [])).split('help[3]:\n')[1]);
  assert.equal(await runMail(token, ['search', 'from:school']), 'threads[1]{id,from,subject,age}:\n  18c0a1f00d2e3b4a,Sam <sam@home.example>,"Trip on Friday, forms",2h\ntotal: 1');
  assert.equal(await runMail(token, ['read', '18c0a1f00d2e3b4a']), [
    'subject: Trip on Friday, forms',
    'messages[2]{from,age}:', '  School Office <office@school.example>,2d', '  Sam <sam@home.example>,2h',
    'latest: Sam <sam@home.example>', 'body: |', '  Signed and sent.'].join('\n'), 'plain text first, and the quoted history left out');
  const long = await runMail(token, ['read', '18c0b2f00d2e3b4a']);
  assert.match(long, /body: \|\n {2}Order 42\n {2}word word/);
  assert.doesNotMatch(long, /style|x\{\}/);
  assert.match(long, /\nmore: \d+ more characters; mail read 18c0b2f00d2e3b4a --full$/);
  assert.doesNotMatch(await runMail(token, ['read', '18c0b2f00d2e3b4a', '--full']), /more:/);
  assert.equal(bodyOf({ mimeType: 'text/plain', body: { data: b64('hi\r\n-----Original Message-----\r\nold') } }), 'hi');

  // Only Gmail's own ids reach the address; plain errors with the help.
  assert.match(await runMail(token, ['read', '../../settings/filters']), /^error: mail read <id>/);
  assert.match(await runMail(token, ['send', 'x']), /^error: no command "send"\nhelp\[3\]:/);
  await assert.rejects(runMail(token, ['read', 'deadbeef00']), /No such conversation/);
  await assert.rejects(runMail(async () => null, []), /not connected any more/);
  assert.ok(asked.every((a) => a.startsWith('GET ') && !/settings|\.\./.test(a)), 'it only ever reads');
});

test('the gate: mail only reads, so it never asks; anything else is refused', () => {
  const s = { bot: 'Pip', space: '/tmp/pip', secret: [] };
  for (const args of [[], ['inbox'], ['search', 'from:school'], ['read', '18c0a1f00d2e3b4a', '--full']]) assert.equal(effectOf('mail', { args }, s).kind, 'safe');
  for (const args of [['send', 'x'], ['delete', '18c0a1f00d2e3b4a']]) assert.equal(effectOf('mail', { args }, s).kind, 'refuse');
  assert.equal(toolWords('mail', { args: ['search', 'from:school'] }), 'Searched the email for “from:school”');
  assert.equal(toolWords('mail', { args: ['read', '18c0a1f00d2e3b4a'] }), 'Read an email');
});

test('a helper reads the connected Gmail through crewd: no Google MCP, the token stays with crewd, it never asks', async () => {
  const { db, crew, cfg, done } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  await signInApp(crew.connections, 'gmail');
  asked.length = 0;
  const t = crew.assign('quill', 'check [tool mail {"args":["search","from:school"]}]', 'chief').task;
  await settled(db, t);
  assert.match(task(db, t).result, /threads\[1\]\{id,from,subject,age\}:\n {2}18c0a1f00d2e3b4a/);
  assert.equal(db.all('SELECT * FROM asks').length, 0);
  assert.ok(asked.length > 0 && asked.every((a) => a.endsWith(' Bearer tok')), 'crewd adds the token to every call');
  done();
});

test('Tracer email: real sandbox HTTP cannot approve; paired control attests once, refuses unknown/sole traders/suppressed, reviews one email without sending', async () => {
  const { crew, cfg, db, done } = setup(); cfg.port = 0; cfg.linkHost = '127.0.0.1';
  const free = createServer(); await new Promise<void>(r => free.listen(0, '127.0.0.1', r)); cfg.linkPort = (free.address() as any).port; await new Promise<void>(r => free.close(() => r()));
  crew.onboard('Umer'); crew.recruit('tracer', 'Tracer', 'person');
  await signInApp(crew.connections, 'gmailsend');
  const who = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ email: 'umer@sender.example', email_verified: true })); });
  await new Promise<void>(r => who.listen(0, '127.0.0.1', r)); identity = `http://127.0.0.1:${(who.address() as any).port}`;
  const server = await startServer(cfg, db, crew), base = `http://127.0.0.1:${(server.address() as any).port}`;
  // Person authority (Main-slice #387): local non-GET /api calls carry the launcher's bearer, the way ./crewhouse open does.
  const person = `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`;
  const http = async (method: string, path: string, body?: object) => { const r = await real(base + path, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: method === 'GET' ? '' : person }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  let phone: DeviceLink | undefined, view: DeviceLink | undefined;
  const pair = async (role: 'control' | 'view') => {
    const offer = await http('POST', '/api/phones/pair', { role });
    const pairing = pairWithOffer(offer.body.qr, { name: `Mail ${role}`, onWords: () => {} });
    await until('pairing words', () => crew.phoneLink!.status().asking.length);
    const pending = crew.phoneLink!.status().asking[0]; await http('POST', '/api/phones/answer', { id: pending.id, yes: true });
    return new DeviceLink(await pairing, { store: { save: () => {}, clear: () => {} }, onEvent: () => {} });
  };
  try {
    phone = await pair('control');
    const request = async (op: string, b: object = {}) => await phone!.request(op, { ...b, build: 'p9b' }) as any;
    const text = 'Hi Ada,\n\n' + 'A precise, grounded opener. '.repeat(100) + '\n\nUmer';
    const t = await crew.post('tracer', `[tool crew_write ${JSON.stringify({ path: 'files/mail.md', content: text })}][tool crew_draft ${JSON.stringify({ path: 'files/mail.md', channel: 'email', to: 'ada@fernwood.example', subject: 'A grounded subject' })}]`);
    await settled(db, t!.task); const draft = crew.snapshot().asks.find(a => a.bot === 'tracer')!;
    const fake = await http('PUT', '/api/mail', { to: 'ada@fernwood.example', kind: 'corporate', name: 'Fake', phone: 'forged', person: 1 }); assert.equal(fake.status, 403);
    const attack = await crew.post('tracer', `[tool bash ${JSON.stringify({ command: `curl -sS --fail -X POST -H 'content-type: application/json' -H 'x-crewhouse: 1' --data '{"answer":"allow"}' '${base}/api/asks/${draft.id}/answer'` })}]`);
    await settled(db, attack!.task); assert.equal(db.get('SELECT state FROM asks WHERE id=?', draft.id)!.state, 'open');
    assert.equal(db.all("SELECT * FROM events WHERE kind='draft.approved'").length, 0, 'no person approval was forged');
    assert.equal((await request('POST /api/mail/review', { draft: draft.id })).status, 409, 'unknown refused');
    const mark = (kind: string) => request('PUT /api/mail', { to: 'ada@fernwood.example', name: 'Fernwood', kind });
    await mark('sole-trader'); assert.match((await request('POST /api/mail/review', { draft: draft.id })).body.error, /count as individuals/);
    await mark('small-partnership'); assert.match((await request('POST /api/mail/review', { draft: draft.id })).body.error, /count as individuals/);
    const attested = await mark('corporate'); assert.equal(attested.body.eligibility.person, 1); assert.ok(attested.body.eligibility.phone && attested.body.eligibility.at);
    await request('PUT /api/mail', { to: 'ADA@FERNWOOD.EXAMPLE', suppressed: true });
    assert.match((await request('POST /api/mail/review', { draft: draft.id })).body.error, /do-not-email list/);
    await request('PUT /api/mail', { to: 'ada@fernwood.example', suppressed: false }); asked.length = 0;
    const review = await request('POST /api/mail/review', { draft: draft.id }); assert.equal(review.status, 200);
    assert.equal((await request('POST /api/mail/review', { draft: draft.id })).body.id, review.body.id, 'one card, even on retry');
    const card = (await request('GET /api/state')).body.asks.find((a: any) => a.id === review.body.id);
    assert.equal(card.bot, 'chief', 'sending is reviewed with Chief, never in a helper’s Needs you');
    assert.deepEqual(card.detail.send, { from: 'umer@sender.example', to: 'ada@fernwood.example', subject: 'A grounded subject' }); assert.equal(card.detail.preview.body, text);
    assert.equal((await http('POST', `/api/asks/${card.id}/answer`, { answer: 'allow', phone: attested.body.eligibility.phone })).status, 403, 'final send cannot be approved locally');
    view = await pair('view'); await assert.rejects(view.request('PUT /api/mail', { to: 'ada@fernwood.example', kind: 'corporate', name: 'Fake', build: 'p9b' }), (e: any) => e.code === 'view-only');
    assert.equal(asked.length, 0, 'no Gmail send request, even with an attestation and a review card');
    await request(`POST /api/asks/${card.id}/answer`, { answer: 'deny' });
    assert.equal(db.all("SELECT * FROM events WHERE kind='mail.approved' OR kind='mail.sent'").length, 0, 'backed out; no Send press');
  } finally { phone?.stop(); view?.stop(); identity = ''; await new Promise<void>(r => server.close(() => r())); await new Promise<void>(r => who.close(() => r())); done(); }
});
