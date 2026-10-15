import { signInApp } from './connect-fixture.ts';
// mail-axi against a stand-in Gmail (its REST API, in memory): what is new, a search, a conversation without its quoted
// history and cut to size; and the gate: everything it can do is reading, anything else is refused.
import { test, after } from 'node:test';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DeviceLink, pairWithOffer } from '@byokit/pair';
import { startServer } from '../src/server.ts';
import assert from 'node:assert/strict';
import { setup, settled, task, until } from './lab.ts';
import { temp } from './tmp.ts';
const A = await import('../web/src/adapter.ts');

const { GMAIL, ageOf, bodyOf, runMail } = await import('../src/mail.ts');
const { MailSend } = await import('../src/mail-send.ts');
const { Crew } = await import('../src/crew.ts');

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const PDF = '%PDF-1.4 a form to read';
const att = (id: string, filename: string, size: number) => ({ mimeType: 'application/pdf', filename, body: { attachmentId: id, size } });
const now = Date.now();
const msg = (id: string, from: string, subject: string, minsAgo: number, payload: object) => ({ id, internalDate: String(now - minsAgo * 60_000), payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }], ...payload } });
const threads: Record<string, any> = {
  '18c0a1f00d2e3b4a': { messages: [
    msg('m1', 'School Office <office@school.example>', 'Trip on Friday, forms', 3000, { mimeType: 'text/plain', body: { data: b64('Please return the form.') } }),
    msg('m2', 'Sam <sam@home.example>', 'Re: Trip on Friday, forms', 90, { mimeType: 'multipart/mixed', parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/html', body: { data: b64('<p>Signed &amp; sent.</p>') } },
        { mimeType: 'text/plain', body: { data: b64('Signed and sent.\n\nOn Tue, School Office wrote:\n> Please return the form.') } }] },
      att('a1', 'statement.pdf', Buffer.byteLength(PDF)), att('a2', 'huge.zip', 12 * 1024 * 1024), att('a3', 'locked.pdf', 2048), att('a4', '../../.pi/settings.json', 8)] }),
  ] },
  '18c0a1f00d2e3b51': { messages: [msg('other', 'School Office <office@school.example>', 'Friday trip', 5, {}), msg('own1', 'Umer <umer@sender.example>', 'Re: Friday trip', 2, {}), msg('own2', 'Umer alias <alias@sender.example>', 'Re: Friday trip', 1, {})] },
  '18c0a1f00d2e3b4b': { messages: [msg('own1', 'Umer <umer@sender.example>', 'My notes', 5, {}), msg('own2', 'Umer alias <alias@sender.example>', 'Re: My notes', 1, {})] },
  '18c0b2f00d2e3b4a': { messages: [msg('m3', 'Shop <no-reply@shop.example>', 'Your order', 5, { mimeType: 'text/html', body: { data: b64(`<style>x{}</style><div>Order 42</div>${'word '.repeat(600)}`) } })] },
  '18c0a1f00d2e3b4c': { messages: [msg('m9', 'School Office <office@school.example>', 'Hi\r\nBcc: evil@x.example', 60, { mimeType: 'text/plain', body: { data: b64('hi') } })] },
  '18c0a1f00d2e3b4d': { messages: [msg('m10', 'a@b.example\r\nCc: x@y.example', 'hello', 60, { mimeType: 'text/plain', body: { data: b64('hi') } })] },
  '18c0a1f00d2e3b4e': { messages: [] },
  '18c0a1f00d2e3b4f': { messages: [msg('m11', 'Sam <sam@home.example>', 'caf\u00e9 update', 60, { mimeType: 'text/plain', body: { data: b64('hi') } })] },
  '18c0a1f00d2e3b50': { messages: [{ id: 'm12', internalDate: String(now - 60 * 60_000), payload: { headers: [{ name: 'From', value: 'Sam <sam@home.example>' }, { name: 'Subject', value: 'hello' }, { name: 'Message-Id', value: '<abc123@mail.example>' }], mimeType: 'text/plain', body: { data: b64('hi') } } }] },
};
const asked: string[] = [];
const draftBodies: string[] = [];
let identity = '';
let sendOk = false;
let sendRefusal = 404;
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
  if (path === '/messages/m2/attachments/a1') return json({ size: Buffer.byteLength(PDF), data: b64(PDF) });
  if (path === '/messages/m2/attachments/a4') return json({ size: 8, data: b64('{"hi":1}') });
  if (path === '/settings/sendAs') return json({ sendAs: [{ sendAsEmail: 'umer@sender.example', isDefault: true, signature: '— Umer' }, { sendAsEmail: 'alias@sender.example' }] });
  if (path === '/labels' && (init.method ?? 'GET') === 'GET') return json({ labels: [{ id: 'Label_1', name: 'School' }] });
  if (path === '/labels') return json({ id: 'Label_2', name: JSON.parse(String(init.body ?? '{}')).name ?? 'School' });
  if (path === '/drafts') { if (init.method === 'POST') draftBodies.push(String(init.body ?? '')); return json({ id: 'draft-1' }); }
  if (path.endsWith('/modify')) return json(threads[path.split('/threads/')[1].split('/')[0]] ?? {});
  const t = threads[path.split('/threads/')[1]];
  if (path === '/messages/send') return sendOk ? json({ id: 'sent-1' }) : json({}, sendRefusal);
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
    'help[6]:'].join('\n') + '\n' + (await runMail(token, [])).split('help[6]:\n')[1]);
  assert.equal(await runMail(token, ['search', 'from:school']), 'threads[1]{id,from,subject,age}:\n  18c0a1f00d2e3b4a,Sam <sam@home.example>,"Trip on Friday, forms",2h\ntotal: 1');
  assert.equal(await runMail(token, ['read', '18c0a1f00d2e3b4a']), [
    'subject: Trip on Friday, forms',
    'messages[2]{from,age}:', '  School Office <office@school.example>,2d', '  Sam <sam@home.example>,2h',
    'latest: Sam <sam@home.example>, 4 attached (mail attachments 18c0a1f00d2e3b4a)', 'body: |', '  Signed and sent.'].join('\n'), 'plain text first, and the quoted history left out');
  const long = await runMail(token, ['read', '18c0b2f00d2e3b4a']);
  assert.match(long, /body: \|\n {2}Order 42\n {2}word word/);
  assert.doesNotMatch(long, /style|x\{\}/);
  assert.match(long, /\nmore: \d+ more characters; mail read 18c0b2f00d2e3b4a --full$/);
  assert.doesNotMatch(await runMail(token, ['read', '18c0b2f00d2e3b4a', '--full']), /more:/);
  assert.equal(bodyOf({ mimeType: 'text/plain', body: { data: b64('hi\r\n-----Original Message-----\r\nold') } }), 'hi');

  // Attachments: listed, then a chosen one saved into the helper's own files folder; the refusals are plain words.
  assert.equal(await runMail(token, ['attachments', '18c0a1f00d2e3b4a']), [
    'attachments[4]{n,name,type,size}:', '  1,statement.pdf,application/pdf,23B', '  2,huge.zip,application/pdf,12.0MB', '  3,locked.pdf,application/pdf,2KB',
    '  4,-..-.pi-settings.json,application/pdf,8B'].join('\n'));
  const files = temp('mail-files');
  assert.equal(await runMail(token, ['attachments', '18c0a1f00d2e3b4a', '1'], files),
    'saved: {file: files/statement.pdf, name: statement.pdf, type: application/pdf, size: 23B}\nRead it with your own file tools.');
  assert.equal(readFileSync(join(files, 'files', 'statement.pdf'), 'utf8'), PDF, 'the bytes Gmail gave are the bytes on disk');
  assert.match(await runMail(token, ['attachments', '18c0a1f00d2e3b4a', '1'], files), /files\/statement \(2\)\.pdf/, 'an earlier file of the same name is kept');
  assert.equal(await runMail(token, ['attachments', '18c0b2f00d2e3b4a']), 'No attachments on this conversation.');
  assert.match(await runMail(token, ['attachments', '18c0a1f00d2e3b4a', '2'], files), /^error: “huge\.zip” is 12\.0MB, over the 10\.0MB crewd will save for you/);
  assert.match(await runMail(token, ['attachments', '18c0a1f00d2e3b4a', '9'], files), /^error: this conversation has 4 attachments; n is 1 to 4/);
  assert.match(await runMail(token, ['attachments', '18c0b2f00d2e3b4a', '1'], files), /^error: No attachments on this conversation\./);
  assert.match(await runMail(token, ['attachments', '18c0a1f00d2e3b4a', '1']), /^error: saving an attachment writes into a helper’s own files folder/);
  await assert.rejects(runMail(token, ['attachments', '18c0a1f00d2e3b4a', '3'], files), /No such conversation/, 'an attachment Gmail will not hand over says so');
  // A hostile name from a stranger's mail never becomes a path: it lands one level down in files/, nothing else.
  assert.match(await runMail(token, ['attachments', '18c0a1f00d2e3b4a', '4'], files), /files\/-\..-\.pi-settings\.json/);
  assert.deepEqual(readdirSync(join(files, 'files')).sort(), ['-..-.pi-settings.json', 'statement (2).pdf', 'statement.pdf'], 'every saved file is in files/, under a name with no folders in it');

  // Only Gmail's own ids reach the address; plain errors with the help.
  assert.match(await runMail(token, ['read', '../../settings/filters']), /^error: mail read <id>/);
  assert.match(await runMail(token, ['send', 'x']), /^error: no command "send"\nhelp\[6\]:/);
  await assert.rejects(runMail(token, ['read', 'deadbeef00']), /No such conversation/);
  await assert.rejects(runMail(async () => null, []), /not connected any more/);
  assert.ok(asked.every((a) => a.startsWith('GET ') && !/settings|\.\./.test(a)), 'it only ever reads');
});

test('Chief drafts a reply and files under a label: one card each, the guarded path, nothing ever sent', async () => {
  const { effectOf } = await import('../src/policy.ts');
  const seen = { bot: 'Chief', space: '/tmp', secret: [] } as any;
  const draft = effectOf('mail', { args: ['draft', '18c0a1f00d2e3b4a', 'Thanks, got it.'] }, seen) as any;
  assert.equal(draft.kind, 'send', 'a draft asks');
  assert.equal(draft.key, undefined, 'no standing grant covers a write');
  assert.equal(draft.mail.id, '18c0a1f00d2e3b4a', 'one card bound to that one message, without exposing the internal id');
  const label = effectOf('mail', { args: ['label', '18c0a1f00d2e3b4a', 'School'] }, seen) as any;
  assert.equal(label.kind, 'send');
  assert.equal(label.key, undefined, 'filing asks every time too');
  assert.equal(label.mail.id, '18c0a1f00d2e3b4a');
  assert.match(label.words, /School/, 'the card names the label');
  assert.equal((effectOf('mail', { args: ['send', 'x'] }, seen) as any).kind, 'refuse', 'send stays refused');

  // The surface delegates to the guarded MailSend path; without it, plain words ask to connect.
  assert.match(await runMail(token, ['draft', '18c0a1f00d2e3b4a', 'hi']), /^error: Connect Gmail drafts & labels/);
  assert.match(await runMail(token, ['label', '18c0a1f00d2e3b4a', 'School']), /^error: Connect Gmail drafts & labels/);
  assert.match(await runMail(token, ['draft', 'nope', 'hi']), /^error: mail draft <id>/);
  const { db, done } = setup();
  try {
    const { MailSend } = await import('../src/mail-send.ts');
    const mail = new MailSend(db, { token: async () => 'tok' } as any);
    asked.length = 0;
    const drafted = await runMail(token, ['draft', '18c0a1f00d2e3b4a', 'Thanks, got it.'], undefined, mail, 'chief');
    assert.match(drafted, /^drafted: \{id: draft-1, thread: 18c0a1f00d2e3b4a, from: umer@sender\.example/);
    assert.match(drafted, /nothing was sent/i, 'it says plainly nothing went out');
    const labelled = await runMail(token, ['label', '18c0a1f00d2e3b4a', 'School'], undefined, mail, 'chief');
    assert.equal(labelled, 'labelled: {id: 18c0a1f00d2e3b4a, label: School}');
    assert.equal(db.all("SELECT * FROM events WHERE kind='mail.drafted'").length, 1, 'the draft is witnessed');
    assert.equal(db.all("SELECT * FROM events WHERE kind='mail.labelled'").length, 1, 'the label is witnessed');
    assert.equal(asked.filter((x) => x.startsWith('POST /messages/send')).length, 0, 'never sent');
    assert.ok(asked.some((x) => x.startsWith('POST /drafts')), 'the draft landed');
    assert.ok(asked.some((x) => x.includes('/modify')), 'the label landed');
  } finally { done(); }
});

test('draftReply hardens attacker-shaped thread headers: refuses splits, encodes the subject, omits absent refs', async () => {
  const { db, done } = setup();
  try {
    const mail = new MailSend(db, { token: async () => 'tok' } as any);
    asked.length = 0;
    await assert.rejects(mail.draftReply('18c0a1f00d2e3b4c', 'Thanks.', 'chief'), /unreadable subject/, 'a split subject never reaches the MIME');
    await assert.rejects(mail.draftReply('18c0a1f00d2e3b4d', 'Thanks.', 'chief'), /one work email address/, 'a split From is not an address');
    await assert.rejects(mail.draftReply('18c0a1f00d2e3b4e', 'Thanks.', 'chief'), /no messages/, 'an empty thread drafts nothing');
    assert.equal(asked.filter((x) => x.startsWith('POST /drafts')).length, 0, 'no refusal drafted anything');
    draftBodies.length = 0;
    const out = await mail.draftReply('18c0a1f00d2e3b4f', 'Thanks, got it.', 'chief');
    assert.match(out, /^drafted: \{id: draft-1/);
    const head = Buffer.from(JSON.parse(draftBodies[0]).message.raw, 'base64url').toString('utf8').split('\r\n\r\n')[0];
    assert.ok(head.includes('=?UTF-8?B?') && !head.includes('caf\u00e9'), 'the subject is encoded words, never raw bytes');
    const words = [...head.replace(/\r\n /g, '').matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) => Buffer.from(m[1], 'base64').toString('utf8')).join('');
    assert.equal(words, 'Re: caf\u00e9 update', 'it decodes back to the reply subject');
    assert.ok(!head.includes('In-Reply-To'), 'no Message-Id means no reference headers');
    draftBodies.length = 0;
    await mail.draftReply('18c0a1f00d2e3b50', 'Hello back.', 'chief');
    const head2 = Buffer.from(JSON.parse(draftBodies[0]).message.raw, 'base64url').toString('utf8').split('\r\n\r\n')[0];
    assert.ok(head2.includes('In-Reply-To: <abc123@mail.example>') && head2.includes('References: <abc123@mail.example>'), 'a present id threads the reply');
  } finally { done(); }
});

test('a helper drafts and files through crewd: one card per message, the yes writes, never sends', async () => {
  const { db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  await signInApp(crew.connections, 'gmail');
  await signInApp(crew.connections, 'gmailwrite');
  assert.equal(A.apps(crew.snapshot()).find((a) => a.id === 'gmailwrite')!.status, 'On · changes ask first');
  asked.length = 0;
  const t = crew.assign('quill', 'reply [tool mail {"args":["draft","18c0a1f00d2e3b51","## Friday trip\\n\\n**Thanks.**\\n\\n- Form ready"]}]', 'chief').task;
  await until('ask', () => db.get("SELECT * FROM asks WHERE state = 'open'"));
  assert.match(db.get("SELECT title FROM asks WHERE state = 'open'")!.title, /create a reply in your Gmail drafts/, 'one plain card for that message');
  assert.equal(db.all("SELECT * FROM events WHERE kind='mail.drafted'").length, 0, 'nothing lands before the yes');
  await crew.answer(db.get("SELECT id FROM asks WHERE state = 'open'")!.id, { answer: 'allow' });
  await settled(db, t);
  assert.match(db.get("SELECT text FROM messages WHERE bot = 'quill' AND author = 'bot' AND task_id = ? ORDER BY id LIMIT 1", t)!.text, /drafted: \{id: draft-1/, 'the draft landed after the yes');
  assert.equal(db.all("SELECT * FROM events WHERE kind='mail.drafted'").length, 1);
  const raw = Buffer.from(JSON.parse(draftBodies.at(-1)!).message.raw, 'base64url').toString('utf8');
  const html = Buffer.from(raw.split('\r\n\r\n')[1], 'base64').toString('utf8');
  assert.match(raw, /To: office@school.example/, 'neither own send-as becomes the recipient');
  assert.match(raw, /Content-Type: text\/html/); assert.match(html, /<h2>Friday trip<\/h2>/); assert.match(html, /<strong>Thanks\.<\/strong>/); assert.match(html, /<li>Form ready<\/li>/); assert.match(html, /— Umer/);
  const u = crew.assign('quill', 'file it [tool mail {"args":["label","18c0a1f00d2e3b4a","School"]}]', 'chief').task;
  await until('ask', () => db.get("SELECT * FROM asks WHERE state = 'open' AND title LIKE '%file this email%'"));
  await crew.answer(db.get("SELECT id FROM asks WHERE state = 'open'")!.id, { answer: 'allow' });
  await settled(db, u);
  assert.match(db.get("SELECT text FROM messages WHERE bot = 'quill' AND author = 'bot' AND task_id = ? ORDER BY id LIMIT 1", u)!.text, /labelled: \{id: 18c0a1f00d2e3b4a, label: School\}/);
  assert.equal(db.all("SELECT * FROM events WHERE kind='mail.labelled'").length, 1);
  assert.equal(asked.filter((x) => x.startsWith('POST /messages/send')).length, 0, 'never sent');
  assert.ok(asked.some((x) => x.startsWith('POST /drafts')) && asked.some((x) => x.includes('/modify')), 'both writes landed');
  for (const args of [['draft', 'bad-id', 'hi'], ['draft', '18c0a1f00d2e3b4a', 'x'.repeat(12001)], ['label', '18c0a1f00d2e3b4a', 'bad/label']]) {
    const invalid = crew.assign('quill', `[tool mail ${JSON.stringify({ args })}]`, 'chief').task;
    await settled(db, invalid); assert.equal(db.all("SELECT * FROM asks WHERE state='open'").length, 0, 'invalid arguments never ask or write');
  }
  const before = draftBodies.length, own = crew.assign('quill', '[tool mail {"args":["draft","18c0a1f00d2e3b4b","Hello"]}]', 'chief').task;
  await until('own-only ask', () => db.get("SELECT * FROM asks WHERE state='open'"));
  const ownAsk = db.get("SELECT * FROM asks WHERE state='open'")!;
  const view = A.cards(crew.snapshot()).find((c) => c.id === ownAsk.id)!;
  assert.equal(view.choices[0].label, 'Create draft'); assert.equal(view.status, 'Nothing will be sent');
  await crew.answer(ownAsk.id, { answer: 'allow' }); await settled(db, own);
  assert.equal(draftBodies.length, before, 'an all-own-address thread cannot create a draft');
  assert.ok(db.all("SELECT text FROM messages WHERE task_id=? AND author='bot'", own).some((m) => /only your own messages/.test(m.text)), 'the real refusal reaches the chat');
  const parked = crew.assign('quill', '[tool mail {"args":["label","18c0a1f00d2e3b4a","School"]}]', 'chief').task;
  await until('parked approval', () => db.get("SELECT 1 FROM events WHERE kind='ask.parked' AND json_extract(data,'$.task')=?", parked));
  await crew.answer(db.get("SELECT id FROM asks WHERE task_id=? AND state='open'", parked)!.id, { answer: 'allow' }); await settled(db, parked);
  const writes = asked.filter((x) => x.includes('/modify')).length;
  const again = crew.assign('quill', '[tool mail {"args":["label","18c0a1f00d2e3b4a","School"]}]', 'chief').task;
  await until('a new job needs its own card', () => db.get("SELECT id FROM asks WHERE task_id=? AND state='open'", again));
  assert.equal(asked.filter((x) => x.includes('/modify')).length, writes, 'a parked grant cannot cross task identity');
  await crew.answer(db.get("SELECT id FROM asks WHERE task_id=? AND state='open'", again)!.id, { answer: 'deny' }); await settled(db, again);
  done();
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
  // The same helper saves the letter's attachment into its own files folder, with no card and no ask: it reads
  // what it saved with its own file tools.
  const saved = crew.assign('quill', 'keep [tool mail {"args":["attachments","18c0a1f00d2e3b4a","1"]}]', 'chief').task;
  await settled(db, saved);
  assert.equal(task(db, saved).state, 'done');
  assert.equal(readFileSync(join(cfg.crewDir, 'bots', 'quill', 'files', 'statement.pdf'), 'utf8'), PDF, 'the attachment is a real file in the helper\u2019s own folder');
  assert.match(task(db, saved).result, /saved: \{file: files\/statement\.pdf/);
  assert.equal(db.all("SELECT * FROM events WHERE kind='run.call' AND json_extract(data,'$.tool')='mail'").length, 2, 'crewd\u2019s own record of both calls');
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
  // Person authority (Main-slice #387): local /api calls carry the launcher's bearer, the way ./crewhouse open does.
  const person = `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`;
  const http = async (method: string, path: string, body?: object) => { const r = await real(base + path, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: person }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
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
    const attested = await mark('corporate'); assert.equal(attested.body.eligibility.person, 1); assert.ok(attested.body.eligibility.at); assert.equal(attested.body.eligibility.phone, undefined, 'the paired phone’s device id stays server-side');
    const phoneId = db.get("SELECT id FROM devices WHERE role='control'")!.id;
    const mailEvents = [...(await http('GET', '/api/events')).body, ...(await http('GET', '/api/state')).body.events].filter((e: any) => String(e.kind).startsWith('mail.'));
    assert.ok(mailEvents.some((e: any) => e.kind === 'mail.attested'), 'the attestation event is served');
    assert.equal(JSON.stringify(mailEvents).includes(phoneId), false, 'no served mail event carries the device id');
    await request('PUT /api/mail', { to: 'ADA@FERNWOOD.EXAMPLE', suppressed: true });
    assert.match((await request('POST /api/mail/review', { draft: draft.id })).body.error, /do-not-email list/);
    await request('PUT /api/mail', { to: 'ada@fernwood.example', suppressed: false }); asked.length = 0;
    const review = await request('POST /api/mail/review', { draft: draft.id }); assert.equal(review.status, 200);
    assert.equal((await request('POST /api/mail/review', { draft: draft.id })).body.id, review.body.id, 'one card, even on retry');
    const card = (await request('GET /api/state')).body.asks.find((a: any) => a.id === review.body.id);
    assert.equal(card.bot, 'chief', 'sending is reviewed with Chief, never in a helper’s Needs you');
    assert.deepEqual(card.detail.send, { from: 'umer@sender.example', to: 'ada@fernwood.example', subject: 'A grounded subject' }); assert.equal(card.detail.preview.body, text);
    assert.equal((await http('POST', `/api/asks/${card.id}/answer`, { answer: 'allow', phone: db.get("SELECT id FROM devices WHERE role='control'")!.id })).status, 403, 'final send cannot be approved locally');
    view = await pair('view'); await assert.rejects(view.request('PUT /api/mail', { to: 'ada@fernwood.example', kind: 'corporate', name: 'Fake', build: 'p9b' }), (e: any) => e.code === 'view-only');
    assert.equal(asked.length, 0, 'no Gmail send request, even with an attestation and a review card');
    await request(`POST /api/asks/${card.id}/answer`, { answer: 'deny' });
    assert.equal(db.all("SELECT * FROM events WHERE kind='mail.approved' OR kind='mail.sent'").length, 0, 'backed out; no Send press');
  } finally { phone?.stop(); view?.stop(); identity = ''; await new Promise<void>(r => server.close(() => r())); await new Promise<void>(r => who.close(() => r())); done(); }
});

test('one approval sends exactly once, and a check-Gmail card can always be dismissed', async () => {
  const { db, crew, cfg, done } = setup();
  crew.onboard('Umer'); crew.recruit('tracer', 'Tracer', 'person');
  db.run("INSERT INTO devices (id,name,pk,role,created_at) VALUES ('ctl','Control','pk-ctl','control',?)", Date.now());
  const who = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ email: 'umer@sender.example', email_verified: true })); });
  await new Promise<void>(r => who.listen(0, '127.0.0.1', r)); identity = `http://127.0.0.1:${(who.address() as any).port}`;
  const mail = new MailSend(db, { token: async () => 'tok' } as any);
  try {
    mail.set('ada@fernwood.example', { kind: 'corporate', name: 'Fernwood' }, 'ctl');
    sendOk = true; asked.length = 0;
    const draft = Number(db.run("INSERT INTO asks (bot,kind,title,detail,at) VALUES ('tracer','propose','Email',?,?)", JSON.stringify({ draft: { channel: 'email', to: 'ada@fernwood.example', subject: 'Hi' }, preview: { body: 'Hello there.' } }), Date.now()).lastInsertRowid);
    const card = (await mail.review(draft)).id;
    const row = () => db.get('SELECT * FROM asks WHERE id=?', card)!;
    const results = await Promise.allSettled([mail.answer(row(), 'allow', 'ctl'), mail.answer(row(), 'allow', 'ctl')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one of two approvals is accepted');
    assert.equal(asked.filter((x) => x.startsWith('POST /messages/send')).length, 1, 'exactly one email is sent for one approval');
    assert.equal(db.all("SELECT * FROM events WHERE kind='mail.sent'").length, 1, 'one sent event, never two');
    // A failed send leaves the card uncertain; the person can always clear it, so it never sticks in Needs you.
    db.run("UPDATE asks SET state='uncertain',answer='check Gmail' WHERE id=?", card);
    const snapshot = crew.snapshot().asks.find((a: any) => a.id === card)!;
    assert.equal(snapshot.state, 'uncertain', 'the uncertain card is still shown to the person');
    const view = A.card(snapshot, crew.snapshot());
    assert.equal(view.mailUncertain, true, 'the card says it is the uncertain one');
    assert.deepEqual(view.choices.map((c) => c.body.answer), ['dismiss'], 'and offers a way to clear it');
    mail.dismiss(db.get('SELECT * FROM asks WHERE id=?', card)!);
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', card)!.state, 'answered');
    assert.equal(db.get('SELECT answer FROM asks WHERE id=?', card)!.answer, 'dismissed');
    assert.ok(!crew.snapshot().asks.some((a: any) => a.id === card), 'the check-Gmail card clears from Needs you');
  } finally { sendOk = false; identity = ''; await new Promise<void>(r => who.close(() => r())); done(); }
});

test('a send left mid-flight when crewd stops becomes the check-Gmail card, never re-sent', async () => {
  const { db, crew, cfg, done } = setup();
  crew.onboard('Umer'); crew.recruit('tracer', 'Tracer', 'person');
  db.run("INSERT INTO devices (id,name,pk,role,created_at) VALUES ('ctl','Control','pk-ctl','control',?)", Date.now());
  const who = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ email: 'umer@sender.example', email_verified: true })); });
  await new Promise<void>(r => who.listen(0, '127.0.0.1', r)); identity = `http://127.0.0.1:${(who.address() as any).port}`;
  const mail = new MailSend(db, { token: async () => 'tok' } as any);
  let restarted: InstanceType<typeof Crew> | undefined;
  try {
    mail.set('ada@fernwood.example', { kind: 'corporate', name: 'Fernwood' }, 'ctl');
    const draft = sendDraft(db, 'ada@fernwood.example', 'Stuck one');
    const card = (await mail.review(draft)).id;
    // The claim committed but Gmail never answered: crewd stops right here.
    db.run("UPDATE asks SET state='sending',answer='approved once' WHERE id=?", card);
    asked.length = 0;
    restarted = new Crew(cfg, db);
    const mail2 = new MailSend(db, { token: async () => 'tok' } as any); // a restart re-initialises both, as at boot
    restarted.init();
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', card)!.state, 'uncertain', 'the stuck send becomes the check-Gmail card');
    assert.equal(db.get('SELECT answer FROM asks WHERE id=?', card)!.answer, 'check Gmail');
    assert.equal(db.all("SELECT * FROM events WHERE kind='mail.unsure'").length, 1, 'the same unsure event the failed-send path uses');
    assert.equal(asked.filter((x) => x.startsWith('POST /messages/send')).length, 0, 'nothing is re-sent');
    const snapshot = crew.snapshot().asks.find((a: any) => a.id === card)!;
    assert.equal(A.card(snapshot, crew.snapshot()).mailUncertain, true, 'the existing uncertain card shows, with no new UI');
    mail2.dismiss(db.get('SELECT * FROM asks WHERE id=?', card)!);
    assert.equal(db.get('SELECT answer FROM asks WHERE id=?', card)!.answer, 'dismissed');
    assert.ok(!crew.snapshot().asks.some((a: any) => a.id === card), 'the person can clear it');
  } finally { await restarted?.stop(); identity = ''; await new Promise<void>(r => who.close(() => r())); done(); }
});

test('a draft decided elsewhere after its send card was made sends nothing and says so', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer'); crew.recruit('tracer', 'Tracer', 'person');
  db.run("INSERT INTO devices (id,name,pk,role,created_at) VALUES ('ctl','Control','pk-ctl','control',?)", Date.now());
  const who = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ email: 'umer@sender.example', email_verified: true })); });
  await new Promise<void>(r => who.listen(0, '127.0.0.1', r)); identity = `http://127.0.0.1:${(who.address() as any).port}`;
  const mail = new MailSend(db, { token: async () => 'tok' } as any);
  try {
    mail.set('ada@fernwood.example', { kind: 'corporate', name: 'Fernwood' }, 'ctl');
    sendOk = true; asked.length = 0;
    const draft = Number(db.run("INSERT INTO asks (bot,kind,title,detail,at) VALUES ('tracer','propose','Email',?,?)", JSON.stringify({ draft: { channel: 'email', to: 'ada@fernwood.example', subject: 'Hi' }, preview: { body: 'Hello there.' } }), Date.now()).lastInsertRowid);
    const card = (await mail.review(draft)).id;
    db.run("UPDATE asks SET state='answered',answer='not now' WHERE id=?", draft);
    await assert.rejects(mail.answer(db.get('SELECT * FROM asks WHERE id=?', card)!, 'allow', 'ctl'), (e: any) => /answered on its draft\. Nothing was sent\./.test(e.message));
    assert.equal(asked.filter((x) => x.startsWith('POST /messages/send')).length, 0, 'no email is sent');
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', card)!.state, 'open', 'the send card stays open, not stuck as attempted');
  } finally { sendOk = false; identity = ''; await new Promise<void>(r => who.close(() => r())); done(); }
});

test('a send card withdrawn at restart never blocks its draft: review makes a fresh card', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer'); crew.recruit('tracer', 'Tracer', 'person');
  db.run("INSERT INTO devices (id,name,pk,role,created_at) VALUES ('ctl','Control','pk-ctl','control',?)", Date.now());
  const who = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ email: 'umer@sender.example', email_verified: true })); });
  await new Promise<void>(r => who.listen(0, '127.0.0.1', r)); identity = `http://127.0.0.1:${(who.address() as any).port}`;
  const mail = new MailSend(db, { token: async () => 'tok' } as any);
  try {
    mail.set('ada@fernwood.example', { kind: 'corporate', name: 'Fernwood' }, 'ctl');
    const draft = Number(db.run("INSERT INTO asks (bot,kind,title,detail,at) VALUES ('tracer','propose','Email',?,?)", JSON.stringify({ draft: { channel: 'email', to: 'ada@fernwood.example', subject: 'Hi' }, preview: { body: 'Hello there.' } }), Date.now()).lastInsertRowid);
    const first = (await mail.review(draft)).id;
    db.run("UPDATE asks SET state = 'withdrawn' WHERE state = 'open' AND kind != 'propose'");
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', first)!.state, 'withdrawn');
    const second = await mail.review(draft);
    assert.notEqual(second.id, first, 'a new card is made, not a refusal');
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', second.id)!.state, 'open');
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', draft)!.state, 'open', 'the draft stays open for the new card');
  } finally { identity = ''; await new Promise<void>(r => who.close(() => r())); done(); }
});

test('a free-mail domain can never be attested, so a sole trader on it is never emailed', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer');
  crew.recruit('tracer', 'Tracer', 'person');
  db.run("INSERT INTO devices (id,name,pk,role,created_at) VALUES ('ctl','Control','pk-ctl','control',?)", Date.now());
  const mail = new MailSend(db, { token: async () => 'tok' } as any);
  try {
    assert.throws(() => mail.set('jane@gmail.com', { kind: 'corporate', name: 'Jane' }, 'ctl'), (e: any) => e.status === 400);
    assert.throws(() => mail.set('jo@hotmail.co.uk', { kind: 'corporate', name: 'Jo' }, 'ctl'), (e: any) => e.status === 400);
    assert.equal(mail.status('plumber@gmail.com').eligibility, null, 'attesting one mailbox marks nothing on its domain');
    const draft = Number(db.run("INSERT INTO asks (bot,kind,title,detail,at) VALUES ('tracer','propose','Email',?,?)", JSON.stringify({ draft: { channel: 'email', to: 'plumber@gmail.com', subject: 'Hi' }, preview: { body: 'Hello there.' } }), Date.now()).lastInsertRowid);
    await assert.rejects(mail.review(draft), (e: any) => /count as individuals/.test(e.message));
  } finally { done(); }
});

test('a Not now on a send card whose draft was decided elsewhere records no refusal', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer'); crew.recruit('tracer', 'Tracer', 'person');
  db.run("INSERT INTO devices (id,name,pk,role,created_at) VALUES ('ctl','Control','pk-ctl','control',?)", Date.now());
  const who = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ email: 'umer@sender.example', email_verified: true })); });
  await new Promise<void>(r => who.listen(0, '127.0.0.1', r)); identity = `http://127.0.0.1:${(who.address() as any).port}`;
  const mail = new MailSend(db, { token: async () => 'tok' } as any);
  try {
    mail.set('ada@fernwood.example', { kind: 'corporate', name: 'Fernwood' }, 'ctl');
    const draft = sendDraft(db, 'ada@fernwood.example', 'Copied one');
    const card = (await mail.review(draft)).id;
    db.run("UPDATE asks SET state='answered',answer='allowed once' WHERE id=?", draft);
    await mail.answer(db.get('SELECT * FROM asks WHERE id=?', card)!, 'deny', 'ctl');
    assert.equal(db.get('SELECT state, answer FROM asks WHERE id=?', card)!.answer, 'not now');
    assert.equal(db.all("SELECT * FROM events WHERE kind='draft.rejected'").length, 0, 'the email was not refused; it was already decided');
  } finally { identity = ''; await new Promise<void>(r => who.close(() => r())); done(); }
});

const sendDraft = (db: any, to: string, subject: string) => Number(db.run("INSERT INTO asks (bot,kind,title,detail,at) VALUES ('tracer','propose','Email',?,?)", JSON.stringify({ draft: { channel: 'email', to, subject }, preview: { body: 'Hello there.' } }), Date.now()).lastInsertRowid);

test('an open send card survives a restart and a reset of Chief', async () => {
  const { db, crew, cfg, done } = setup();
  crew.onboard('Umer'); crew.recruit('tracer', 'Tracer', 'person');
  db.run("INSERT INTO devices (id,name,pk,role,created_at) VALUES ('ctl','Control','pk-ctl','control',?)", Date.now());
  const who = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ email: 'umer@sender.example', email_verified: true })); });
  await new Promise<void>(r => who.listen(0, '127.0.0.1', r)); identity = `http://127.0.0.1:${(who.address() as any).port}`;
  const mail = new MailSend(db, { token: async () => 'tok' } as any);
  const restarted = new Crew(cfg, db);
  try {
    mail.set('ada@fernwood.example', { kind: 'corporate', name: 'Fernwood' }, 'ctl');
    const card = (await mail.review(sendDraft(db, 'ada@fernwood.example', 'Hi'))).id;
    restarted.init();
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', card)!.state, 'open', 'a restart leaves the card waiting for the person');
    await restarted.resetBot('chief');
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', card)!.state, 'open', 'resetting Chief leaves it waiting too');
  } finally { await restarted.stop(); identity = ''; await new Promise<void>(r => who.close(() => r())); done(); }
});

test('a sent email and a declined card each leave the draft receipt Tracer reads', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer'); crew.recruit('tracer', 'Tracer', 'person');
  db.run("INSERT INTO devices (id,name,pk,role,created_at) VALUES ('ctl','Control','pk-ctl','control',?)", Date.now());
  const who = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ email: 'umer@sender.example', email_verified: true })); });
  await new Promise<void>(r => who.listen(0, '127.0.0.1', r)); identity = `http://127.0.0.1:${(who.address() as any).port}`;
  const mail = new MailSend(db, { token: async () => 'tok' } as any);
  const receipts = () => db.all("SELECT kind, data FROM events WHERE kind IN ('draft.approved','draft.rejected') ORDER BY seq").map((e: any) => { const d = JSON.parse(String(e.data)); return [e.kind, d.to, d.subject]; });
  try {
    mail.set('ada@fernwood.example', { kind: 'corporate', name: 'Fernwood' }, 'ctl');
    sendOk = true;
    const sent = (await mail.review(sendDraft(db, 'ada@fernwood.example', 'Sent one'))).id;
    await mail.answer(db.get('SELECT * FROM asks WHERE id=?', sent)!, 'allow', 'ctl');
    assert.deepEqual(receipts(), [['draft.approved', 'ada@fernwood.example', 'Sent one']]);
    const declined = (await mail.review(sendDraft(db, 'ada@fernwood.example', 'Declined one'))).id;
    await mail.answer(db.get('SELECT * FROM asks WHERE id=?', declined)!, 'deny', 'ctl');
    assert.deepEqual(receipts(), [['draft.approved', 'ada@fernwood.example', 'Sent one'], ['draft.rejected', 'ada@fernwood.example', 'Declined one']]);
  } finally { sendOk = false; identity = ''; await new Promise<void>(r => who.close(() => r())); done(); }
});

test('a Gmail server error is unknown, not a refusal: the draft stays locked and nothing is retried', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer'); crew.recruit('tracer', 'Tracer', 'person');
  db.run("INSERT INTO devices (id,name,pk,role,created_at) VALUES ('ctl','Control','pk-ctl','control',?)", Date.now());
  const who = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ email: 'umer@sender.example', email_verified: true })); });
  await new Promise<void>(r => who.listen(0, '127.0.0.1', r)); identity = `http://127.0.0.1:${(who.address() as any).port}`;
  const mail = new MailSend(db, { token: async () => 'tok' } as any);
  const posts = () => asked.filter((x) => x.startsWith('POST /messages/send')).length;
  try {
    mail.set('ada@fernwood.example', { kind: 'corporate', name: 'Fernwood' }, 'ctl');
    const draft = sendDraft(db, 'ada@fernwood.example', 'Hi');
    sendOk = false; sendRefusal = 503; asked.length = 0;
    const card = (await mail.review(draft)).id;
    await assert.rejects(mail.answer(db.get('SELECT * FROM asks WHERE id=?', card)!, 'allow', 'ctl'), (e: any) => /Could not confirm sending: Gmail said 503/.test(e.message));
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', card)!.state, 'uncertain', 'the card asks whether it went out');
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', draft)!.state, 'answered', 'the draft stays locked');
    await assert.rejects(mail.review(draft), (e: any) => /already sent or attempted/.test(e.message));
    assert.equal(posts(), 1, 'no automatic retry');
  } finally { sendOk = false; sendRefusal = 404; identity = ''; await new Promise<void>(r => who.close(() => r())); done(); }
});

test('a definite Gmail refusal sends nothing, reopens the draft for a new review, and is not retried by itself', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer'); crew.recruit('tracer', 'Tracer', 'person');
  db.run("INSERT INTO devices (id,name,pk,role,created_at) VALUES ('ctl','Control','pk-ctl','control',?)", Date.now());
  const who = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ email: 'umer@sender.example', email_verified: true })); });
  await new Promise<void>(r => who.listen(0, '127.0.0.1', r)); identity = `http://127.0.0.1:${(who.address() as any).port}`;
  const mail = new MailSend(db, { token: async () => 'tok' } as any);
  const posts = () => asked.filter((x) => x.startsWith('POST /messages/send')).length;
  try {
    mail.set('ada@fernwood.example', { kind: 'corporate', name: 'Fernwood' }, 'ctl');
    const draft = sendDraft(db, 'ada@fernwood.example', 'Hi');
    sendOk = false; asked.length = 0;
    const card = (await mail.review(draft)).id;
    await assert.rejects(mail.answer(db.get('SELECT * FROM asks WHERE id=?', card)!, 'allow', 'ctl'), (e: any) => /Nothing was sent/.test(e.message));
    assert.equal(posts(), 1);
    assert.equal(db.get('SELECT state, answer FROM asks WHERE id=?', card)!.answer, 'not sent');
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', draft)!.state, 'open', 'the draft is open again');
    sendOk = true;
    const again = (await mail.review(draft)).id;
    assert.notEqual(again, card, 'a new card, approved on its own');
    await mail.answer(db.get('SELECT * FROM asks WHERE id=?', again)!, 'allow', 'ctl');
    assert.equal(posts(), 2);
    assert.equal(db.all("SELECT * FROM events WHERE kind='mail.sent'").length, 1);
  } finally { sendOk = false; identity = ''; await new Promise<void>(r => who.close(() => r())); done(); }
});

test('a send card can be declined from the computer, but approving it still needs the paired phone', async () => {
  const { db, crew, cfg, done } = setup(); cfg.port = 0; cfg.linkHost = '127.0.0.1';
  const free = createServer(); await new Promise<void>(r => free.listen(0, '127.0.0.1', r)); cfg.linkPort = (free.address() as any).port; await new Promise<void>(r => free.close(() => r()));
  crew.onboard('Umer'); crew.recruit('tracer', 'Tracer', 'person');
  const server = await startServer(cfg, db, crew), base = `http://127.0.0.1:${(server.address() as any).port}`;
  const person = `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`;
  const answer = (id: number, body: object) => real(`${base}/api/asks/${id}/answer`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: person }, body: JSON.stringify(body) });
  const draft = sendDraft(db, 'ada@fernwood.example', 'Hi');
  const card = Number(db.run("INSERT INTO asks (bot,kind,title,detail,at) VALUES ('chief','mail','Send?',?,?)", JSON.stringify({ effect: 'send', send: { draft, from: 'umer@sender.example', to: 'ada@fernwood.example', subject: 'Hi', body: 'Hello there.' }, preview: { body: 'Hello there.' } }), Date.now()).lastInsertRowid);
  try {
    assert.equal((await answer(card, { answer: 'allow' })).status, 403, 'Send is refused without the phone');
    assert.equal(db.get('SELECT state FROM asks WHERE id=?', card)!.state, 'open');
    assert.equal((await answer(card, { answer: 'deny' })).status, 200, 'Not now works from the computer');
    assert.equal(db.get('SELECT state, answer FROM asks WHERE id=?', card)!.answer, 'not now');
  } finally { await new Promise<void>(r => server.close(() => r())); done(); }
});
