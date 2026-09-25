// mail-axi against a stand-in Gmail (its REST API, in memory): what is new, a search, a conversation without its quoted
// history and cut to size; and the gate: everything it can do is reading, anything else is refused.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, task } from './lab.ts';

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
const real = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
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
  mkdirSync(join(cfg.stateDir, 'people', '1'), { recursive: true });
  writeFileSync(join(cfg.stateDir, 'people', '1', 'connections.json'), JSON.stringify({ gmail: { access: 'tok', expires: Date.now() + 3_600_000 } }));
  asked.length = 0;
  const t = crew.assign('quill', 'check [tool mail {"args":["search","from:school"]}]', 'chief').task;
  await settled(db, t);
  assert.match(task(db, t).result, /threads\[1\]\{id,from,subject,age\}:\n {2}18c0a1f00d2e3b4a/);
  assert.equal(db.all('SELECT * FROM asks').length, 0);
  assert.ok(asked.length > 0 && asked.every((a) => a.endsWith(' Bearer tok')), 'crewd adds the token to every call');
  done();
});
