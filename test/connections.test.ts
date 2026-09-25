// Connecting a person's apps: one Connect, the app's own page, back to Crewhouse. Against a stand-in app (OAuth discovery,
// self-registration, tokens, and an MCP server), so every failure path is exercised without anyone's account.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, task, until } from './lab.ts';

const { OWNER } = await import('../src/accounts.ts');
const { connectError } = await import('../src/connections.ts');

const seen: { tokens: Record<string, string>[]; auth: string[] } = { tokens: [], auth: [] };
const app = createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const json = (x: unknown, status = 200, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(x)); };
  const url = new URL(req.url!, base);
  if (url.pathname === '/.well-known/oauth-authorization-server') return json({ authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register` });
  if (url.pathname === '/.well-known/oauth-protected-resource') return json({ scopes_supported: ['read', 'write'] });
  if (url.pathname === '/register') return json({ client_id: 'crewhouse-client' }, 201);
  if (url.pathname === '/token') {
    const f = Object.fromEntries(new URLSearchParams(body));
    seen.tokens.push(f);
    if (f.grant_type === 'authorization_code' && f.code === 'good' && f.code_verifier && f.client_id === 'crewhouse-client') return json({ access_token: 'A1', refresh_token: 'R1', expires_in: 3600 });
    if (f.grant_type === 'refresh_token' && f.refresh_token === 'R1') return json({ access_token: 'A2', expires_in: 3600 });
    return json({ error: 'invalid_grant' }, 400);
  }
  if (url.pathname === '/mcp') {
    seen.auth.push(String(req.headers.authorization));
    if (!/^Bearer A[12]$/.test(String(req.headers.authorization))) return json({ error: 'invalid_token' }, 401);
    const m = JSON.parse(body);
    if (!m.id) { res.writeHead(202); return res.end(); }
    if (m.method === 'initialize') return json({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }, 200, { 'mcp-session-id': 's1' });
    if (m.method === 'tools/list') return json({ jsonrpc: '2.0', id: m.id, result: { tools: [
      { name: 'search', description: 'Search pages', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, annotations: { readOnlyHint: true } },
      { name: 'create-page', description: 'Create a page', inputSchema: { type: 'object', properties: { title: { type: 'string' } } }, annotations: { title: 'create a page' } },
    ] } });
    // Answered as an event stream, as remote MCP servers may.
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `did ${m.params.name} ${JSON.stringify(m.params.arguments)}` }] } })}\n\n`);
  }
  json({ error: 'not found' }, 404);
});
await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(app.address() as any).port}`;
after(() => app.close());

function lab() {
  const s = setup();
  s.crew.connections.apps.mocknote = { name: 'Mocknote', servers: [`${base}/mcp`], issuer: base };
  return s;
}
/** The browser coming back from the app's page, as the app would send it. */
const back = (crew: any, from: string, q: Record<string, string>) => crew.connections.finish(new URLSearchParams({ state: new URL(from).searchParams.get('state')!, ...q }));
/** Start connecting and keep the link the person would open (the view drops it once the try is over). */
const start = async (crew: any, app = 'mocknote') => (await crew.connections.connect(OWNER, app)).url as string;

test('connect: the app\'s own page, back to Crewhouse, connected; the tokens stay in that person\'s own folder', async () => {
  const { cfg, crew, done } = lab();
  const view = await crew.connections.connect(OWNER, 'mocknote');
  const url = new URL(view.url!);
  assert.equal(url.origin + url.pathname, `${base}/authorize`, 'the app\'s own sign-in page');
  for (const k of ['client_id', 'state', 'code_challenge', 'redirect_uri']) assert.ok(url.searchParams.get(k), k);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'read write');
  assert.equal(await back(crew, view.url!, { code: 'good' }), 'Mocknote is connected. You can close this tab.');
  assert.equal(crew.connections.view(OWNER, 'mocknote')!.state, 'done');
  const file = join(cfg.stateDir, 'people', '1', 'connections.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).mocknote.access, 'A1');
  const listed = crew.connections.list(OWNER).find((c) => c.app === 'mocknote')!;
  assert.equal(listed.connected, true);
  assert.ok(!JSON.stringify(crew.connections.list(OWNER)).includes('A1'), 'no token reaches the app screen');
  const sam = crew.addMember('Sam').id;
  assert.equal(crew.connections.connected(sam, 'mocknote'), false, 'one person\'s connection is theirs alone');
  crew.connections.disconnect(OWNER, 'mocknote');
  assert.equal(crew.connections.connected(OWNER, 'mocknote'), false);
  done();
});

test('connect failures: declined, a bad return, an old link, offline, too slow; each ends not connected with one next step', async () => {
  const { crew, done } = lab();
  let link = await start(crew);
  assert.equal(await back(crew, link, { error: 'access_denied' }), "The connection was declined on Mocknote's page. Tap Connect to try again.");
  assert.equal(crew.connections.connected(OWNER, 'mocknote'), false);
  link = await start(crew);
  assert.equal(await back(crew, link, { code: 'forged' }), "Mocknote didn't finish connecting. Tap Connect to try again.");
  assert.equal(crew.connections.view(OWNER, 'mocknote')!.state, 'failed');
  assert.equal(await back(crew, link, { code: 'good' }), 'This connection link has expired. Go back to Crewhouse and tap Connect again.', 'a link works once');
  // Tapping Connect again replaces the earlier try: its link no longer works, the new one does.
  const first = await start(crew);
  const second = await start(crew);
  assert.match(await back(crew, first, { code: 'good' }), /expired/);
  assert.match(await back(crew, second, { code: 'good' }), /connected/);
  crew.connections.apps.offline = { name: 'Offline', servers: [], issuer: 'http://127.0.0.1:9' };
  assert.equal((await crew.connections.connect(OWNER, 'offline')).error, "Couldn't reach Offline. Check the internet connection, then tap Connect again.");
  const slow = await start(crew);
  await until('too slow', () => crew.connections.view(OWNER, 'mocknote')?.state === 'failed', 5000);
  assert.equal(crew.connections.view(OWNER, 'mocknote')!.error, 'Connecting took too long. Tap Connect to start again.');
  assert.match(await back(crew, slow, { code: 'good' }), /expired/);
  await assert.rejects(crew.connections.connect(OWNER, 'outlook'), /coming soon/);
  assert.match(crew.connections.list(OWNER).find((c) => c.app === 'google')!.soon!, /household's own Google app first/, 'Google waits for the household app, and says so');
  assert.equal(connectError('Canva', 'getaddrinfo ENOTFOUND mcp.canva.com'), "Couldn't reach Canva. Check the internet connection, then tap Connect again.");
  done();
});

test('connections stay fresh in the background; a revoked one disconnects and says so once', async () => {
  const { cfg, db, crew, done } = lab();
  crew.onboard('sir');
  const v = await crew.connections.connect(OWNER, 'mocknote');
  await back(crew, v.url!, { code: 'good' });
  const file = join(cfg.stateDir, 'people', '1', 'connections.json');
  const set = (t: object) => { const all = JSON.parse(readFileSync(file, 'utf8')); all.mocknote = { ...all.mocknote, ...t }; writeFileSync(file, JSON.stringify(all)); };
  set({ expires: Date.now() - 1 });
  assert.equal(await crew.connections.token(OWNER, 'mocknote'), 'A2', 'refreshed when it ran out');
  set({ expires: Date.now() - 1, refresh: 'revoked' });
  await crew.connections.keepFresh([OWNER]);
  assert.equal(crew.connections.connected(OWNER, 'mocknote'), false);
  assert.match(db.get("SELECT text FROM messages WHERE bot = 'chief' ORDER BY id DESC")!.text, /^Your Mocknote connection has run out\. Connect it again under Settings, Connections/);
  done();
});

test('a connected app\'s tools: reading runs silently, changing something asks in plain words', async () => {
  const { db, crew, done } = lab();
  crew.onboard('sir');
  crew.recruit('scribe', 'Quill', 'person');
  const v = await crew.connections.connect(OWNER, 'mocknote');
  await back(crew, v.url!, { code: 'good' });
  const t = crew.assign('quill', 'find it [tool mocknote_search {"q":"school trip"}]', 'chief').task;
  await settled(db, t);
  assert.match(task(db, t).result, /did search \{"q":"school trip"\}/);
  assert.equal(db.all('SELECT * FROM asks').length, 0);
  const u = crew.assign('quill', 'write it up [tool mocknote_create_page {"title":"Trip"}]', 'chief').task;
  await until('ask', () => db.get("SELECT * FROM asks WHERE state = 'open'"));
  const ask = db.get("SELECT * FROM asks WHERE state = 'open'")!;
  assert.equal(ask.title, 'Quill wants to use your Mocknote: create a page.');
  assert.equal(crew.snapshot().asks[0].detail.covers, '“create a page” in your Mocknote');
  await crew.answer(ask.id, { answer: 'allow' });
  await settled(db, u);
  assert.match(task(db, u).result, /did create-page/);
  assert.ok(seen.auth.every((a) => /^Bearer A[12]$/.test(a)), 'the bot never holds the token; crewd adds it');
  assert.ok(!existsSync(join(crew['cfg'].crewDir, 'bots', 'quill', 'connections.json')));
  done();
});
