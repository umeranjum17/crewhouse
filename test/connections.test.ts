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
const disk = await import('../src/bots.ts');

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
  // Google, stood in for, answering as Google does: the key first, then the code, with the scopes the person ticked,
  // and a refresh token's lifetime only when it runs out (the app still in Testing).
  if (url.pathname === '/gtoken') {
    const f = Object.fromEntries(new URLSearchParams(body));
    if (![gid('123-house'), gid('123-web')].includes(f.client_id)) return json({ error: 'invalid_client', error_description: 'The OAuth client was not found.' }, 401);
    if (f.client_secret !== SECRET) return json({ error: 'invalid_client', error_description: 'Unauthorized' }, 401);
    if (f.code !== 'good') return json({ error: 'invalid_grant', error_description: 'Malformed auth code.' }, 400);
    return json({ access_token: 'A1', refresh_token: 'R1', expires_in: 3600, scope: google.ticked, ...(google.testing ? { refresh_token_expires_in: 604799 } : {}) });
  }
  // Google's sign-in page refuses a website's key for a loopback address, by redirecting to its error page.
  if (url.pathname === '/gauth') {
    const why = url.searchParams.get('client_id') === gid('123-web') ? '\n\x15redirect_uri_mismatch\x12\x1aBad Request' : '';
    res.writeHead(302, { location: why ? `/signin/oauth/error?authError=${Buffer.from(why, 'latin1').toString('base64')}` : '/v3/signin/identifier' });
    return res.end();
  }
  // The read-back after a yes: Google's real 403 when the owner hasn't enabled that API.
  if (url.pathname.startsWith('/gread/')) {
    if (google.off.includes(url.pathname.slice(7))) return json({ error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'accessNotConfigured' }],
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', domain: 'googleapis.com' }] } }, 403);
    return google.broken ? json({ error: { code: 500 } }, 500) : json({ ok: true });
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
const google = { ticked: '', testing: false, off: [] as string[], broken: false };
// Made up at run time, so a scanner doesn't take them for real keys.
const gid = (name: string) => `${name}.apps.google${'usercontent'}.com`;
const SECRET = ['GOCSPX', 'abcdefghijklmnopqrstuvwxyz12'].join('-');
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
  assert.equal(await back(crew, view.url!, { code: 'good' }), 'Mocknote is connected. You can go back to Crewhouse now.');
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
  assert.equal(await back(crew, link, { error: 'access_denied' }), "No problem, nothing was connected. Tap Connect whenever you'd like to try again.");
  assert.equal(crew.connections.status(OWNER, 'mocknote').state, 'declined');
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
  assert.equal((await crew.connections.connect(OWNER, 'mocknote')).state, 'done', 'already on: nothing to open');
  assert.deepEqual(crew.connections.status(OWNER, 'mocknote'), { state: 'on' });
  crew.connections.cancel(OWNER, 'mocknote');
  assert.deepEqual(crew.connections.status(OWNER, 'mocknote'), { state: 'cancelled' }, 'closing the sheet on a finished one disconnects it');
  crew.connections.apps.offline = { name: 'Offline', servers: [], issuer: 'http://127.0.0.1:9' };
  assert.equal((await crew.connections.connect(OWNER, 'offline')).error, "Couldn't reach Offline. Check the internet connection, then tap Connect again.");
  const slow = await start(crew);
  await until('too slow', () => crew.connections.view(OWNER, 'mocknote')?.state === 'failed', 5000);
  assert.equal(crew.connections.view(OWNER, 'mocknote')!.error, 'Connecting took too long. Tap Connect to start again.');
  assert.equal(crew.connections.status(OWNER, 'mocknote').state, 'expired');
  assert.match(await back(crew, slow, { code: 'good' }), /expired/);
  await assert.rejects(crew.connections.connect(OWNER, 'outlook'), /no such app/, 'Outlook is cut from v1');
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
    s.crew.connections.apps[id] = { ...a, servers: [`${base}/mcp`], check: `${base}/gread/${id}`, oauth: { ...a.oauth!, token: `${base}/gtoken`, authorize: `${base}/gauth` } };
  }
  return s;
}

/** The owner's paste, as Settings sends it; the error's words when Google (or the shape check) says no. */
const paste = (crew: any, id: string, secret: string) => crew.connections.setHouseGoogle(id, secret).then(() => 'saved', (e: any) => e.message);
async function house(crew: any) {
  assert.equal(await paste(crew, ` ${gid('123-house')} `, ` ${SECRET} `), 'saved');
  assert.equal(crew.connections.houseGoogle(), true);
}
/** One Connect, with the person saying yes on Google's page. */
const yes = async (crew: any, app: string) => back(crew, await start(crew, app), { code: 'good' });

test("Google for the house: the pasted key is checked with Google before it's kept, and each wrong paste is named", async () => {
  const { crew, done } = googleLab();
  const ID = gid('123-house');
  assert.match(await paste(crew, SECRET, ID), /^That's the Client secret\. It goes in the second box/);
  assert.match(await paste(crew, ID, ID), /^That's the Client ID again\. The second box takes the Client secret/);
  assert.match(await paste(crew, 'crewhouse-family-4711', SECRET), /^That doesn't look like a Client ID/);
  assert.match(await paste(crew, ID, 'shh'), /^That doesn't look like a Client secret/);
  assert.match(await paste(crew, gid('999-gone'), SECRET), /^Google doesn't know that Client ID/);
  assert.match(await paste(crew, ID, ['GOCSPX', 'somebodyelsessecret12345'].join('-')), /^Google says that Client secret doesn't belong to that Client ID/);
  assert.match(await paste(crew, gid('123-web'), SECRET), /^That key is for a website, not this computer\. In step 4 make one of type “Desktop app”/);
  assert.equal(crew.connections.houseGoogle(), false, 'nothing wrong was kept');
  assert.equal(crew.connections.houseSteps(), null);
  await house(crew);
  // Pasted and taken by Google: steps 1 and 4 checked; 2 and 3 only said done until someone connects.
  assert.deepEqual(crew.connections.houseSteps()!.map((s: any) => s.state), ['checked', 'said', 'said', 'checked']);
  assert.deepEqual(crew.snapshot().house.steps!.map((s: any) => s.state), ['checked', 'said', 'said', 'checked']);
  done();
});

test("Google: after the yes, one read back before connected; Google's real failure sends the owner to the step that's missing", async () => {
  const { crew, done } = googleLab();
  await house(crew);
  google.ticked = 'https://www.googleapis.com/auth/gmail.readonly';
  // Still in Testing: it would work for a week, so it isn't called connected.
  google.testing = true;
  assert.equal(await yes(crew, 'gmail'), "The house's Google app is still in Testing, so Google would cut Gmail off within a week. Step 3 of Google for the house: press Publish app.");
  assert.deepEqual(crew.connections.status(OWNER, 'gmail'), { state: 'failed', error: (crew.connections.view(OWNER, 'gmail') as any).error, step: 3 });
  assert.equal(crew.connections.connected(OWNER, 'gmail'), false);
  assert.deepEqual(crew.connections.houseSteps()![2], { state: 'missing', note: 'Still in Testing: press Publish app under Audience.' });
  google.testing = false;
  // The Gmail API never enabled: Google's 403 on the read back names it.
  google.off = ['gmail'];
  assert.equal(await yes(crew, 'gmail'), "Gmail API isn't switched on in the house's Google project yet. Step 2 of Google for the house: enable Gmail API.");
  assert.equal(crew.connections.status(OWNER, 'gmail').step, 2);
  assert.equal(crew.connections.connected(OWNER, 'gmail'), false);
  assert.deepEqual(crew.connections.houseSteps()![1], { state: 'missing', note: 'Gmail API is still off. Enable it.' });
  assert.equal(crew.connections.houseSteps()![2].state, 'checked', 'a read that got as far as the API proves the app is published');
  // Any other failed read: not connected, and it says so.
  google.off = [];
  google.broken = true;
  assert.match(await yes(crew, 'gmail'), /^Gmail said yes, but Crewhouse couldn't read anything back from it, so it isn't connected/);
  assert.equal(crew.connections.connected(OWNER, 'gmail'), false);
  google.broken = false;
  // Fixed: connected, and the step is ticked from the evidence.
  assert.match(await yes(crew, 'gmail'), /^Gmail is connected/);
  assert.deepEqual(crew.connections.houseSteps()![1], { state: 'said', note: 'Gmail API answered; the others are checked the first time someone connects them.' });
  for (const [id, scope] of [['calendar', 'calendar.events'], ['drive', 'drive.file']]) {
    google.ticked = `https://www.googleapis.com/auth/${scope}`;
    assert.match(await yes(crew, id), /is connected/);
  }
  assert.deepEqual(crew.connections.houseSteps()!.map((s: any) => s.state), ['checked', 'checked', 'checked', 'checked']);
  // A Workspace app left Internal: step 3; a key Google stopped knowing (deleted after the paste): step 4.
  crew.connections.disconnect(OWNER, 'calendar');
  assert.equal(await back(crew, await start(crew, 'calendar'), { error: 'org_internal' }), "The house's Google app is set to Internal, so Google turns everyone else away. Step 3 of Google for the house: make it External.");
  assert.equal(crew.connections.status(OWNER, 'calendar').step, 3);
  assert.match(connectError('Gmail', 'invalid_client'), /^Google didn't accept the house's key\. Step 4 of Google for the house: make a “Desktop app” key/);
  done();
});

test("Google: one service per connection, only after the owner switched it on for the house; Google's own failures said plainly", async () => {
  const { crew, done } = googleLab();
  assert.deepEqual(Object.keys(crew.connections.apps).filter((k) => k !== 'mocknote'), ['drive', 'calendar', 'gmail', 'notion', 'canva'], 'v1: no Outlook, no OneDrive');
  // Before the owner's setup: nobody is sent to Google's "OAuth client not found" page.
  await assert.rejects(crew.connections.connect(OWNER, 'calendar'), (e: any) => e.status === 409 && /Google switched on for the house/.test(e.message));
  assert.match(crew.connections.list(OWNER).find((c: any) => c.app === 'gmail')!.house!, /owner does it once in Settings/);
  await house(crew);
  assert.deepEqual(crew.connections.list(OWNER).filter((c: any) => c.warns).map((c: any) => c.app), ['calendar', 'gmail'], 'Drive shows no unverified-app warning');

  // One scope per request, and the household app's own client.
  let url = new URL(await start(crew, 'calendar'));
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(url.searchParams.get('client_id'), gid('123-house'));
  // "Back to safety" on Google's warning.
  assert.equal(await back(crew, url.toString(), { error: 'access_denied' }), "No problem, nothing was connected. Tap Connect whenever you'd like to try again.");
  assert.equal(crew.connections.status(OWNER, 'calendar').state, 'declined');
  // The box left unticked: not half connected.
  url = new URL(await start(crew, 'calendar'));
  google.ticked = 'openid';
  assert.equal(await back(crew, url.toString(), { code: 'good' }), "Google Calendar still isn't ticked. Tap Connect, then tick Google Calendar on Google's page.");
  assert.equal(crew.connections.status(OWNER, 'calendar').state, 'unticked');
  assert.equal(crew.connections.connected(OWNER, 'calendar'), false);
  // Ticked: connected, as Calendar only.
  url = new URL(await start(crew, 'calendar'));
  google.ticked = 'https://www.googleapis.com/auth/calendar.events';
  assert.match(await back(crew, url.toString(), { code: 'good' }), /^Google Calendar is connected/);
  assert.deepEqual(crew.snapshot().connections, ['calendar']);
  assert.equal(crew.connections.connected(OWNER, 'gmail'), false, 'Calendar is not Gmail');
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
  const v = await crew.connections.connect(OWNER, 'mocknote');
  await back(crew, v.url!, { code: 'good' });
  await crew.answer(ask.id, { answer: 'allow' });
  await settled(db, t);
  assert.equal(task(db, t).state, 'done');
  assert.ok(db.get("SELECT 1 FROM messages WHERE bot = 'quill' AND text = 'Mocknote is connected now. Quill carries on.'"));
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
  const book = '[tool mocknote_create_page {"title":"Dentist"}]';
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
  assert.match(crew.digest(OWNER, 0), /- Not sure it worked: Quill, /);
  done();
});
