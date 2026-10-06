// Connecting a person's apps: one Connect, the app's own page, back to Crewhouse. Against a stand-in app (OAuth discovery,
// self-registration, tokens, and an MCP server), so every failure path is exercised without anyone's account.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, task, until } from './lab.ts';

const { Connections, connectError } = await import('../src/connections.ts');
const disk = await import('../src/bots.ts');
const { ConnectError } = await import('@byokit/connect');
const grant = { expires: 3600, refresh: 'ok', refreshExpires: 3600 };


const seen: { tokens: Record<string, string>[]; auth: string[]; silent?: boolean } = { tokens: [], auth: [] };
const app = createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const json = (x: unknown, status = 200, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(x)); };
  const url = new URL(req.url!, base);
  if (url.pathname === '/.well-known/oauth-authorization-server') return json({ issuer: base, code_challenge_methods_supported: ['S256'], authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register` });
  if (url.pathname === '/.well-known/oauth-protected-resource/mcp') return json({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['read', 'write'] });
  if (url.pathname === '/register') return json({ client_id: 'crewhouse-client' }, 201);
  if (url.pathname === '/token') {
    const f = Object.fromEntries(new URLSearchParams(body));
    seen.tokens.push(f);
    if (f.grant_type === 'authorization_code' && f.code === 'good' && f.code_verifier && f.client_id === 'crewhouse-client') return json({ access_token: 'A1', token_type: 'Bearer', refresh_token: 'R1', expires_in: grant.expires });
    if (f.grant_type === 'refresh_token' && f.refresh_token === 'R1') {
      if (grant.refresh === 'network') return req.socket.destroy();
      if (grant.refresh !== 'ok') return json({ error: grant.refresh }, grant.refresh === 'invalid_grant' ? 400 : 500);
      return json({ access_token: 'A2', token_type: 'Bearer', expires_in: grant.refreshExpires });
    }
    return json({ error: 'invalid_grant' }, 400);
  }
  // Google, stood in for, answering as Google does: the key first, then the code, with the scopes the person ticked,
  // and a refresh token's lifetime only when it runs out (the app still in Testing).
  if (url.pathname === '/gtoken') {
    const f = Object.fromEntries(new URLSearchParams(body));
    if (![gid('123-house'), gid('123-web')].includes(f.client_id)) return json({ error: 'invalid_client', error_description: 'The OAuth client was not found.' }, 401);
    if (f.client_secret !== SECRET) return json({ error: 'invalid_client', error_description: 'Unauthorized' }, 401);
    if (f.code !== 'good') return json({ error: 'invalid_grant', error_description: 'Malformed auth code.' }, 400);
    return json({ access_token: 'A1', token_type: 'Bearer', refresh_token: 'R1', expires_in: grant.expires, scope: google.ticked, ...(google.testing ? { refresh_token_expires_in: 604799 } : {}) });
  }
  if (url.pathname === '/mcp') {
    if (req.method === 'GET' && req.headers.authorization) { res.writeHead(405); return res.end(); }
    if (req.method === 'GET') { res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` }); return res.end(); }
    if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
    seen.auth.push(String(req.headers.authorization));
    if (!/^Bearer A[12]$/.test(String(req.headers.authorization))) return json({ error: 'invalid_token' }, 401);
    const m = JSON.parse(body);
    if (m.id === undefined) { res.writeHead(202); return res.end(); }
    if (m.method === 'initialize') return json({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stand-in', version: '1' } } }, 200, { 'mcp-session-id': 's1' });
    if (m.method === 'tools/list' && seen.silent) return json({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'nothing for you' } }, 500);
    if (m.method === 'tools/list' && m.params?.cursor === 'next') return json({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'rich', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] } });
    if (m.method === 'tools/list') return json({ jsonrpc: '2.0', id: m.id, result: { tools: [
      { name: 'search', description: 'Search pages', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, annotations: { readOnlyHint: true } },
      { name: 'create-page', description: 'Create a page', inputSchema: { type: 'object', properties: { title: { type: 'string' } } }, annotations: { title: 'create a page' } },
    ], nextCursor: 'next' } });
    // Answered as an event stream, as remote MCP servers may.
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { ...(m.params.name === 'rich' ? { structuredContent: { rows: [1, 2] }, isError: true } : {}), content: [{ type: 'text', text: `did ${m.params.name} ${JSON.stringify(m.params.arguments)}` }, ...(m.params.name === 'rich' ? [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] : [])] } })}\n\n`);
  }
  // The apps crewd itself reads once a connection is made, stood in for as Google's own REST answers.
  if (url.pathname === '/cal/calendars/primary/events') return json({ items: [{ id: 'ev1', summary: 'Swimming', start: { dateTime: new Date().toISOString() }, end: { dateTime: new Date(Date.now() + 3_600_000).toISOString() } }] });
  if (url.pathname === '/gm/labels/INBOX') return json({ threadsUnread: 4 });
  if (url.pathname === '/gm/threads') return json({ threads: [] });
  json({ error: 'not found' }, 404);
});
const google = { ticked: '', testing: false };
// Made up at run time, so a scanner doesn't take them for real keys.
const gid = (name: string) => `${name}.apps.google${'usercontent'}.com`;
const SECRET = ['GOCSPX', 'abcdefghijklmnopqrstuvwxyz12'].join('-');
await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(app.address() as any).port}`;
after(() => app.close());

// Google answers its own REST hosts; the stand-in answers them here, so a proved connection is a real read and not a stored grant.
const realFetch = globalThis.fetch;
globalThis.fetch = ((url: any, init: any) => realFetch(String(url).replace('https://www.googleapis.com/calendar/v3/', `${base}/cal/`).replace('https://gmail.googleapis.com/gmail/v1/users/me/', `${base}/gm/`), init)) as typeof fetch;

function lab() {
  Object.assign(grant, { expires: 3600, refresh: 'ok', refreshExpires: 3600 });
  const s = setup();
  s.crew.connections.apps.mocknote = { id: 'mocknote', name: 'Mocknote', mcpUrl: `${base}/mcp`, issuer: base };
  return s;
}
/** The browser coming back from the app's page, as the app would send it. */
const back = (crew: any, from: string, q: Record<string, string>) => {
  const callback = new URL(new URL(from).searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({ state: new URL(from).searchParams.get('state')!, ...q }).toString();
  return crew.connections.finish(callback);
};
const savedFiles = (cfg: any) => { const dir = join(cfg.stateDir, 'people', '1', 'app-signins'); return readdirSync(dir).filter((n) => n.startsWith('byokit.connect.')).map((n) => join(dir, n)); };
/** Start connecting and keep the link the person would open (the view drops it once the try is over). */
const start = async (crew: any, app = 'mocknote') => (await crew.connections.connect(app)).url as string;

test('connect: the app\'s own page, back to Crewhouse, connected; the tokens stay in that person\'s own folder', async () => {
  const { cfg, crew, done } = lab();
  const view = await crew.connections.connect('mocknote');
  const url = new URL(view.url!);
  assert.equal(url.origin + url.pathname, `${base}/authorize`, 'the app\'s own sign-in page');
  for (const k of ['client_id', 'state', 'code_challenge', 'redirect_uri']) assert.ok(url.searchParams.get(k), k);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'read write');
  assert.equal(await back(crew, view.url!, { code: 'good' }), 'Mocknote is connected, and it works. Your helper can ask it for 3 different things. You can go back to Crewhouse now.');
  assert.equal(crew.connections.view('mocknote')!.state, 'done');
  const file = savedFiles(cfg)[0];
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(cfg.stateDir, 'people', '1', 'app-signins')).mode & 0o777, 0o700);
  assert.ok(!Buffer.from(readFileSync(file, 'utf8'), 'base64').includes(Buffer.from('"access":"A1"')));
  const reopened = new Connections(cfg, 'http://127.0.0.1:9911/connect/callback');
  reopened.apps.mocknote = crew.connections.apps.mocknote;
  await reopened.ready;
  assert.equal(await reopened.token('mocknote'), 'A1', 'saved kit connection survives a new callback port');
  await reopened.stop();
  const listed = crew.connections.list().find((c) => c.app === 'mocknote')!;
  assert.equal(listed.connected, true);
  assert.ok(!JSON.stringify(crew.connections.list()).includes('A1'), 'no token reaches the app screen');
  const former = join(cfg.stateDir, 'people', '2');
  mkdirSync(former, { recursive: true });
  const saved = JSON.stringify({ mocknote: { access: 'former', refresh: 'former', expires: 0 } });
  writeFileSync(join(former, 'connections.json'), saved);
  await crew.connections.keepFresh();
  assert.equal(readFileSync(join(former, 'connections.json'), 'utf8'), saved, 'former tokens are never refreshed or written');
  assert.equal(crew.connections.connected('mocknote'), true, 'only the person\'s connection is read');
  await crew.connections.disconnect('mocknote');
  assert.equal(crew.connections.connected('mocknote'), false);
  done();
});

test('old files are ignored; sealed grants reject tampering and a secret copied under another name', async () => {
  const { cfg, crew, done } = googleLab();
  await crew.connections.ready;
  const old = join(cfg.stateDir, 'people', '1', 'connections.json');
  mkdirSync(join(cfg.stateDir, 'people', '1'), { recursive: true });
  const legacy = JSON.stringify({ mocknote: { access: 'old-login', refresh: 'old-refresh', expires: Date.now() + 3600_000 } });
  writeFileSync(old, legacy);
  writeFileSync(join(cfg.stateDir, 'apps.json'), JSON.stringify({ google: { id: gid('123-house'), secret: SECRET } }));
  const empty = new Connections(cfg, 'http://127.0.0.1:9911/connect/callback');
  empty.apps.mocknote = crew.connections.apps.mocknote;
  await empty.ready;
  assert.equal(empty.connected('mocknote'), false);
  assert.equal(empty.houseGoogle(), false);
  await empty.stop();
  await house(crew);
  await back(crew, await start(crew), { code: 'good' });
  const file = savedFiles(cfg)[0], original = readFileSync(file, 'utf8');
  const bytes = Buffer.from(original, 'base64'); bytes[bytes.length - 1] ^= 1;
  writeFileSync(file, bytes.toString('base64'));
  await assert.rejects(crew.connections.token('mocknote'));
  assert.equal(readFileSync(file, 'utf8'), bytes.toString('base64'), 'failed decryption does not replace the record');
  writeFileSync(file, readFileSync(join(cfg.stateDir, 'people', '1', 'app-signins', 'google-client')));
  await assert.rejects(crew.connections.token('mocknote'), /Stored sign-in could not be opened/);
  writeFileSync(file, original);
  assert.equal(await crew.connections.token('mocknote'), 'A1');
  assert.equal(readFileSync(old, 'utf8'), legacy, 'no import, removal or compatibility handling');
  done();
});

test('connect failures: declined, a bad return, an old link, offline, too slow; each ends not connected with one next step', async () => {
  const { crew, done } = lab();
  let link = await start(crew);
  assert.equal(await back(crew, link, { error: 'access_denied' }), "No problem, nothing was connected. Tap Connect whenever you'd like to try again.");
  assert.equal(crew.connections.status('mocknote').state, 'declined');
  assert.equal(crew.connections.connected('mocknote'), false);
  link = await start(crew);
  assert.equal(await back(crew, link, { code: 'forged' }), new ConnectError('token').message);
  assert.equal(crew.connections.view('mocknote')!.state, 'failed');
  assert.equal(await back(crew, link, { code: 'good' }), 'This connection link has expired. Go back to Crewhouse and tap Connect again.', 'a link works once');
  // Tapping Connect again replaces the earlier try: its link no longer works, the new one does.
  const first = await start(crew);
  const second = await start(crew);
  assert.match(await back(crew, first, { code: 'good' }), /expired/);
  assert.match(await back(crew, second, { code: 'good' }), /connected/);
  assert.equal((await crew.connections.connect('mocknote')).state, 'done', 'already on: nothing to open');
  assert.deepEqual(crew.connections.status('mocknote'), { state: 'on', proof: 'Your helper can ask it for 3 different things.' });
  await crew.connections.cancel('mocknote');
  assert.deepEqual(crew.connections.status('mocknote'), { state: 'cancelled' }, 'closing the sheet on a finished one disconnects it');
  crew.connections.apps.offline = { id: 'offline', name: 'Offline', issuer: 'http://127.0.0.1:9' };
  assert.equal((await crew.connections.connect('offline')).error, "Couldn't reach Offline. Check the internet connection, then tap Connect again.");
  const slow = await start(crew);
  await until('too slow', () => crew.connections.view('mocknote')?.state === 'failed', 5000);
  assert.equal(crew.connections.view('mocknote')!.error, 'Connecting took too long. Tap Connect to start again.');
  assert.equal(crew.connections.status('mocknote').state, 'expired');
  assert.match(await back(crew, slow, { code: 'good' }), /expired/);
  await assert.rejects(crew.connections.connect('outlook'), /no such app/, 'Outlook is cut from v1');
  assert.equal(connectError('Canva', new ConnectError('network')), "Couldn't reach Canva. Check the internet connection, then tap Connect again.");
  // The app takes the sign-in and then does not answer: that is not a connection, and the person is told the real cause.
  seen.silent = true;
  link = await start(crew);
  assert.match(await back(crew, link, { code: 'good' }), /^Mocknote took the sign-in but didn't answer when we tried to use it, so nothing is connected\./);
  assert.equal(crew.connections.connected('mocknote'), false, 'a grant that cannot be used leaves nothing behind');
  assert.equal(crew.connections.status('mocknote').state, 'failed');
  assert.match(crew.connections.status('mocknote').error!, /^Mocknote took the sign-in/);
  seen.silent = false;
  done();
});

test('kit refresh stays sealed; transient failures preserve sign-in, expired tokens never return and revocation says so once', async () => {
  const { cfg, db, crew, done } = lab();
  crew.onboard('sir');
  grant.expires = 30; grant.refreshExpires = 30;
  // Proving the connection is a real read of the app, so the first refresh is spent there and the grant starts at A2.
  await back(crew, await start(crew), { code: 'good' });
  grant.refresh = 'network';
  assert.equal(await crew.connections.token('mocknote'), 'A2', 'unexpired token survives a transient failure');
  grant.refresh = 'ok';
  assert.equal(await crew.connections.token('mocknote'), 'A2');
  grant.refresh = 'server_error';
  await assert.rejects(crew.connections.token('mocknote'), (e: any) => e.code === 'token');
  assert.equal(crew.connections.connected('mocknote'), true);
  assert.ok(!Buffer.from(readFileSync(savedFiles(cfg)[0], 'utf8'), 'base64').includes(Buffer.from('"access":"A2"')));
  grant.refresh = 'invalid_grant';
  await crew.connections.keepFresh();
  assert.equal(crew.connections.connected('mocknote'), false);
  assert.match(db.get("SELECT text FROM messages WHERE bot = 'chief' ORDER BY id DESC")!.text, /^Your Mocknote connection has run out\. Connect it again under Settings, Connections/);
  const count = db.get("SELECT COUNT(*) AS n FROM messages WHERE text LIKE 'Your Mocknote connection has run out%'")!.n;
  await crew.connections.keepFresh();
  assert.equal(db.get("SELECT COUNT(*) AS n FROM messages WHERE text LIKE 'Your Mocknote connection has run out%'")!.n, count);
  grant.expires = 3600; grant.refreshExpires = 3600; grant.refresh = 'ok';
  done();
});

test('a connected app\'s tools: reading runs silently, changing something asks in plain words', async () => {
  const { db, crew, done } = lab();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const v = await crew.connections.connect('mocknote');
  await back(crew, v.url!, { code: 'good' });
  const t = crew.assign('quill', 'find it [tool crew_app {"tool":"mocknote_search","input":{"q":"school trip"}}]', 'chief').task;
  await settled(db, t);
  assert.match(task(db, t).result, /did search/);
  assert.equal(db.all('SELECT * FROM asks').length, 0);
  const u = crew.assign('quill', 'write it up [tool crew_app {"tool":"mocknote_create_page","input":{"title":"Trip"}}]', 'chief').task;
  await until('ask', () => db.get("SELECT * FROM asks WHERE state = 'open'"));
  const ask = db.get("SELECT * FROM asks WHERE state = 'open'")!;
  assert.equal(ask.title, 'Quill wants to use your Mocknote: create a page.');
  assert.equal(crew.snapshot().asks[0].detail.covers, '“create a page” in your Mocknote');
  await crew.answer(ask.id, { answer: 'allow' });
  await settled(db, u);
  assert.match(db.get("SELECT text FROM messages WHERE bot = 'quill' AND author = 'bot' AND task_id = ? ORDER BY id LIMIT 1", u)!.text, /did create-page/);
  assert.equal(task(db, u).state, 'unsure', 'it changed something and never said it saw it work');
  assert.ok(seen.auth.every((a) => /^Bearer A[12]$/.test(a)), 'the bot never holds the token; crewd adds it');
  assert.ok(!existsSync(join(crew['cfg'].crewDir, 'bots', 'quill', 'connections.json')));
  done();
});

/** Google's apps, pointed at the stand-in (same scopes and servers otherwise). */
function googleLab() {
  const s = lab();
  for (const id of ['drive', 'calendar', 'gmail']) {
    const a = s.crew.connections.apps[id];
    s.crew.connections.apps[id] = { ...a, mcpUrl: undefined, oauth: { ...a.oauth!, token: `${base}/gtoken`, authorize: `${base}/gauth` } };
  }
  return s;
}

/** The person's paste, as Settings sends it; the error's words when Google (or the shape check) says no. */
const paste = (crew: any, id: string, secret: string) => crew.connections.setHouseGoogle(id, secret).then(() => 'saved', (e: any) => e.message);
async function house(crew: any) {
  assert.equal(await paste(crew, ` ${gid('123-house')} `, ` ${SECRET} `), 'saved');
  assert.equal(crew.connections.houseGoogle(), true);
}
/** One Connect, with the person saying yes on Google's page. */
const yes = async (crew: any, app: string) => back(crew, await start(crew, app), { code: 'good' });

test('a send reuses the app listing: one handshake per connection set, not per task', async () => {
  const { crew, done } = lab();
  crew.onboard('sir');
  const empty = await crew.connections.tools();
  assert.equal(await crew.connections.tools(), empty, 'no apps: the same listing, no refetch');
  await back(crew, await start(crew), { code: 'good' });
  const listed = await crew.connections.tools();
  assert.notEqual(listed, empty);
  assert.ok(listed.effects['mocknote_search'], 'the newly connected app is listed');
  const rich = listed.tools.find((t) => t.name === 'mocknote_rich')!;
  const result = await rich.run({}) as any;
  assert.deepEqual(result.structuredContent, { rows: [1, 2] });
  assert.equal(result.isError, true);
  assert.equal(result.content[1].type, 'image');
  assert.equal(await crew.connections.tools(), listed, 'the next send reuses it');
  const hits = seen.auth.length;
  await crew.connections.tools();
  assert.equal(seen.auth.length, hits, 'reused: nothing reached the server');
  await crew.connections.disconnect('mocknote');
  assert.deepEqual((await crew.connections.tools()).effects, {}, 'disconnecting clears the listing');
  done();
});

test('Google setup saves a sealed key without pretending it was verified; typed kit errors supply the failure words', async () => {
  const { cfg, crew, done } = googleLab();
  const ID = gid('123-house');
  assert.match(await paste(crew, SECRET, ID), /^That's the Client secret/);
  assert.match(await paste(crew, ID, ID), /^That's the Client ID again/);
  assert.match(await paste(crew, 'bad', SECRET), /^That doesn't look like a Client ID/);
  assert.match(await paste(crew, ID, 'shh'), /^That doesn't look like a Client secret/);
  await house(crew);
  assert.deepEqual(crew.connections.houseSteps()!.map((s: any) => s.state), ['said', 'said', 'said', 'said']);
  const key = readFileSync(join(cfg.stateDir, 'people', '1', 'app-signins', 'google-client'), 'utf8');
  assert.ok(!key.includes(ID) && !key.includes(SECRET));
  await paste(crew, gid('999-gone'), SECRET);
  assert.equal(await yes(crew, 'gmail'), new ConnectError('token').message);
  assert.equal(crew.connections.status('gmail').step, undefined, 'no provider-cause inference');
  await house(crew);
  google.ticked = 'https://www.googleapis.com/auth/gmail.readonly'; google.testing = true;
  assert.match(await yes(crew, 'gmail'), /is connected/);
  assert.equal(crew.connections.houseSteps()![2].state, 'said', 'the kit does not expose refresh-token lifetime');
  assert.equal(crew.connections.houseSteps()![1].state, 'said', 'no raw API probes');
  assert.equal(crew.connections.houseSteps()![3].state, 'checked', 'completed sign-in proves the key was accepted');
  google.testing = false;
  done();
});

test("Google: one service per connection, only after its one-time setup; Google's own failures said plainly", async () => {
  const { crew, done } = googleLab();
  assert.deepEqual(Object.keys(crew.connections.apps).filter((k) => k !== 'mocknote'), ['drive', 'calendar', 'gmail', 'notion', 'canva'], 'v1: no Outlook, no OneDrive');
  // Before setup: you is sent to Google's "OAuth client not found" page.
  await assert.rejects(crew.connections.connect('calendar'), (e: any) => e.status === 409 && /Google switched on for your crew/.test(e.message));
  assert.match(crew.connections.list().find((c: any) => c.app === 'gmail')!.house!, /set it up once in Settings/);
  await house(crew);
  assert.deepEqual(crew.connections.list().filter((c: any) => c.warns).map((c: any) => c.app), ['calendar', 'gmail'], 'Drive shows no unverified-app warning');

  // One scope per request, and the household app's own client.
  let url = new URL(await start(crew, 'calendar'));
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(url.searchParams.get('client_id'), gid('123-house'));
  // "Back to safety" on Google's warning.
  assert.equal(await back(crew, url.toString(), { error: 'access_denied' }), "No problem, nothing was connected. Tap Connect whenever you'd like to try again.");
  assert.equal(crew.connections.status('calendar').state, 'declined');
  // The box left unticked: not half connected.
  url = new URL(await start(crew, 'calendar'));
  google.ticked = 'openid';
  assert.equal(await back(crew, url.toString(), { code: 'good' }), "Google Calendar still isn't ticked. Tap Connect, then tick Google Calendar on the app's page.");
  assert.equal(crew.connections.status('calendar').state, 'unticked');
  assert.equal(crew.connections.connected('calendar'), false);
  // Ticked: connected, as Calendar only.
  url = new URL(await start(crew, 'calendar'));
  google.ticked = 'https://www.googleapis.com/auth/calendar.events';
  assert.match(await back(crew, url.toString(), { code: 'good' }), /^Google Calendar is connected, and it works\. You have 1 thing on today\./);
  assert.deepEqual(crew.snapshot().connections, ['calendar']);
  assert.equal(crew.connections.connected('gmail'), false, 'Calendar is not Gmail');
  done();
});

test('in chat: a helper asks for an app, the person connects it from the card, and the task carries on with it', async () => {
  const { db, crew, done } = lab();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const t = crew.assign('quill', 'what is on this week [tool crew_connect {"app":"mocknote"}]', 'chief').task;
  await until('asked', () => task(db, t).state === 'needs_you');
  const ask = crew.snapshot().asks.find((a: any) => a.kind === 'connect')!;
  assert.deepEqual(ask.detail, { app: 'mocknote', words: 'Let Quill use your Mocknote' });
  const v = await crew.connections.connect('mocknote');
  await back(crew, v.url!, { code: 'good' });
  await crew.answer(ask.id, { answer: 'allow' });
  await settled(db, t);
  assert.equal(task(db, t).state, 'done');
  assert.ok(db.get("SELECT 1 FROM messages WHERE bot = 'quill' AND text = 'Mocknote is connected now. Quill carries on.'"));
  assert.ok(db.get("SELECT 1 FROM messages WHERE bot = 'chief' AND text = 'Mocknote is connected, and it works. Your helper can ask it for 3 different things.'"), 'Chief says what the app actually answered');
  // Asked again while connected: nothing to ask.
  const u = crew.assign('quill', 'again [tool crew_connect {"app":"mocknote"}]', 'chief').task;
  await settled(db, u);
  assert.equal(task(db, u).state, 'done');
  assert.match(task(db, u).result, /already connected/);
  // Not now: it carries on without.
  const w = crew.assign('quill', 'and [tool crew_connect {"app":"canva"}]', 'chief').task;
  await until('asked again', () => task(db, w).state === 'needs_you');
  await crew.answer(crew.snapshot().asks.find((a: any) => a.kind === 'connect')!.id, { answer: 'deny' });
  await settled(db, w);
  assert.equal(task(db, w).state, 'done');
  done();
});

test('done needs proof: a job that acts but sees no confirmation, or says nothing, ends not sure with an alert; never a false done', async () => {
  const { cfg, db, crew, done } = lab();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  await back(crew, await start(crew), { code: 'good' });
  disk.setSettings(cfg, 'quill', { allow: ['app:Mocknote:create a page'] }); // "Always": no card, so the call goes straight through
  const book = '[tool crew_app {"tool":"mocknote_create_page","input":{"title":"Dentist"}}]';
  const outcome = (worked: boolean, seen: string) => `[tool crew_outcome ${JSON.stringify({ worked, seen })}]`;
  const alerts = () => db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'alert'")!.n as number;
  const job = async (text: string) => {
    const before = alerts();
    const t = (await crew.post('quill', text))!.task;
    await settled(db, t);
    const lines = db.all("SELECT text FROM messages WHERE bot = 'quill' AND author = 'bot' AND task_id = ?", t).map((m) => m.text as string);
    return { ...task(db, t), lines, alerted: alerts() > before, trail: db.all("SELECT kind FROM events WHERE json_extract(data, '$.task') = ?", t).map((e) => e.kind as string) };
  };

  // Clicked through, no confirmation: the helper says so, and that is what the job ends as.
  const unsure = await job(`book it ${book} ${outcome(false, "I pressed Book, but the page didn't show a confirmation. Worth checking your email for one.")}`);
  assert.equal(unsure.state, 'unsure');
  assert.equal(unsure.lines.at(-1), "Not sure it worked: I pressed Book, but the page didn't show a confirmation. Worth checking your email for one.");
  assert.ok(unsure.alerted, 'the phone hears about it, like a failure');
  assert.ok(unsure.trail.includes('task.unsure') && !unsure.trail.includes('task.done'));

  // Acted and declared nothing: not sure, in crewd's words, never done.
  const silent = await job(`book it ${book}`);
  assert.equal(silent.state, 'unsure');
  assert.equal(silent.lines.at(-1), "Not sure it worked: I did something on your Mocknote, but I didn't see it confirmed. Worth checking there yourself.");
  assert.ok(silent.alerted);

  // Said it worked, then acted again: the old "it worked" doesn't cover the new act.
  const again = await job(`book it ${outcome(true, 'x')} ${book}`);
  assert.equal(again.state, 'unsure');

  // Confirmed with what it saw: done, and no alert.
  const sure = await job(`book it ${book} ${outcome(true, 'The page showed confirmation number 4417.')}`);
  assert.equal(sure.state, 'done');
  assert.ok(!sure.alerted);
  assert.ok(!sure.lines.some((l: string) => l.startsWith('Not sure')));

  // Nothing done out in the world: done as before, nothing to declare.
  assert.equal((await job('what time is it')).state, 'done');

  // A routine's not sure lands in Chief's thread, where every push-worthy Chief line goes.
  const r = crew.addRoutine({ bot: 'quill', schedule: 'every day 9:00', task: `book it ${book}` }, 'person');
  crew.runRoutine(r.id);
  await until('routine settled', () => { const t = db.get('SELECT state FROM tasks WHERE routine = ? ORDER BY id DESC', r.id); return t && !['queued', 'working'].includes(t.state); });
  assert.equal(db.get('SELECT state FROM tasks WHERE routine = ? ORDER BY id DESC', r.id)!.state, 'unsure');
  assert.match(db.get("SELECT text FROM messages WHERE bot = 'chief' ORDER BY id DESC")!.text, /^Quill isn't sure “.+” worked\. I did something on your Mocknote/);
  assert.match(crew.digest(0), /- Not sure it worked: Quill, /);
  done();
});
