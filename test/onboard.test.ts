// First run and "Sign in with ChatGPT", against the account shim over the runtime (the engine's own wizard is wired in
// the sign-in step of the build; these pin the product words and states around it, which never change).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { setup, settled, task, until, delegated } = await import('./lab.ts');
const { classify: classifyText } = await import('@byokit/accounts');
const { PROVIDERS } = await import('../src/accounts.ts');
const disk = await import('../src/bots.ts');
const A = await import('../web/src/adapter.ts');

/** A user message the stub model turns into one tool call. */
const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
/** The OpenCode console's `/api/orgs`, stubbed: `orgs` names the workspaces each key acts for, and a key it does not list is refused, as a bound service key is. Other hosts stay real. */
function opencodeConsole(orgs: Record<string, object[]>) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (!String(url).startsWith('https://opencode.ai/')) return real(url, init);
    const key = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '').replace('Bearer ', '');
    return orgs[key] ? Response.json(orgs[key]) : new Response('{}', { status: 403 });
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}
/** Only the named accounts count as signed in for the person; the rest wait for sign-in. */
function only(crew: any, keys: string[]) {
  for (const k of Object.keys(PROVIDERS)) {
    if (!keys.includes(k)) (crew.accounts as any).ready.set(k, false);
  }
}

test('sign-in: the one button completes, and the person is signed in', async () => {
  const { crew, done } = setup();
  const a = crew.accounts;
  assert.equal(await a.signedIn('grok'), false);
  const shown = await a.login('grok', 'code');
  assert.equal(shown?.state, 'waiting');
  assert.equal(shown?.code, 'CREW-2026', 'the code is the card');
  await a.finished('grok');
  assert.equal(a.view('grok')!.state, 'done');
  assert.equal(await a.signedIn('grok'), true);
  await a.logout('grok');
  assert.equal(await a.signedIn('grok'), false, 'signed out for real');
  done();
});

test('first run: her first request waits for her own sign-in, Chief says why in one line, and it starts by itself after', async () => {
  const { db, crew, done } = setup();
  const sara = 1;
  // Nobody signed in: her request waits for her sign-in.
  only(crew, []);
  // The first-run screen: she taps an idea; that is both "call me Sara" and her first request.
  const { task: t } = crew.onboard('Sara', "Plan this week's dinners, with a shopping list") as { task: number };
  await settled(db, t);
  assert.equal(crew.person().address, 'Sara');
  assert.equal(crew.botPage('chief').messages[0].text, "Plan this week's dinners, with a shopping list", 'her thread starts with her request');
  assert.equal(task(db, t).state, 'paused');
  assert.equal(task(db, t).member, sara);
  const said = () => db.all("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot'").map((m: any) => m.text);
  assert.ok(said().includes("The crew uses your AI account. Sign in when you're ready and I'll start."), said().join('\n'));
  assert.equal(db.get("SELECT 1 FROM events WHERE kind = 'run.started'"), undefined, 'nothing ran on anyone else\'s account');
  // The wait on her sign-in reads calm everywhere (ch-ob-calm-wait): the snapshot carries Chief's paused
  // task, so the office counts him as waiting; the live line names the one action, and the setup count is
  // only what her first answer needs. No clock renders for a waiting live line (the screens read its state).
  const snap = crew.snapshot();
  assert.ok(snap.tasks.some((t: any) => t.bot === 'chief' && t.state === 'paused' && t.wake_at == null), 'Chief\u2019s sign-in wait is in the snapshot tasks');
  const page = crew.botPage('chief');
  const line = (side?: 'phone') => A.liveLine({ id: 'chief', name: 'Chief', crew: A.crew(snap), tasks: page.tasks, events: [...page.trail, ...snap.events], heard: [], writing: new Map(), ...(side ? { side } : {}) });
  assert.equal(line()?.state, 'waiting');
  assert.equal(line()?.todos.at(-1)?.text, A.WAIT_SIGNIN, 'the computer names the one action');
  assert.equal(line('phone')?.todos.at(-1)?.text, A.WAIT_SIGNIN_PHONE, 'the phone names where to do it');
  const view = A.office(snap);
  assert.equal(view.lead, 'waiting', 'Chief counts as waiting, never free or at work');
  assert.equal(A.chiefStatus(view).group, 'wait');
  assert.equal(A.summaryOf(view), '1 waiting · 0 at work · 0 done · 0 free');
  assert.equal(A.homeSetup(snap, null, null).left, 1, 'the setup count is only the sign-in the first answer needs');
  // More notes while she waits: Chief notes the next one in other words, then holds the rest quietly, never one sentence twice.
  for (const note of ['Also the school run on Friday', 'And remind me about the dentist']) {
    const { task: n } = await crew.post('chief', note) as { task: number };
    await until('the note waits', () => task(db, n).state === 'paused');
  }
  assert.deepEqual(said(), ["The crew uses your AI account. Sign in when you're ready and I'll start.", "Noted. I'll start on this once you sign in."]);
  // She signs in: it starts by itself, and Chief thanks her.
  await crew.accounts.login('chatgpt');
  await crew.accounts.finished('chatgpt');
  await settled(db, t);
  assert.equal(task(db, t).state, 'done');
  assert.ok(said().includes("You're signed in. I'll start now."));
  done();
});

test('a ChatGPT plan without helpers: said plainly with the way forward; "I changed my plan"', async () => {
  const { cfg, db, crew, done } = setup();
  assert.equal(classifyText("Your plan doesn't include this model.")?.kind, 'not_included');
  assert.equal(classifyText('You have hit your ChatGPT usage limit (plus plan). Try again in ~30 min.')?.kind, 'rate_limit');
  const sara = 1;
  crew.onboard('Sara');
  crew.recruit('scout', 'Scout', 'person');
  disk.setBrains(cfg, 'scout', ['chatgpt']);
  only(crew, ['chatgpt']);
  const { task: t } = await crew.post('scout', 'find a plumber, no helpers in plan', undefined) as { task: number };
  await until('waiting on the plan', () => task(db, t).state === 'paused');
  assert.equal(task(db, t).wake_at, null);
  assert.equal(crew.accounts.notIncluded('chatgpt'), true);
  assert.equal(db.get("SELECT text FROM messages WHERE bot = 'scout' ORDER BY id DESC")!.text,
    "Your ChatGPT plan doesn't include helpers yet. Everything else in ChatGPT is fine. ChatGPT Plus includes it.".replace('Umer', crew.person().name));
  // "I've changed my plan": tried again, and it goes through.
  crew.retryAccount('chatgpt');
  await settled(db, t);
  assert.equal(task(db, t).state, 'done');
  assert.equal(crew.accounts.notIncluded('chatgpt'), false);
  done();
});

test('a Go key without helpers ends on the existing plan card; retry, reopen and other failures stay distinct', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { startServer } = await import('../src/server.ts');
  const { faked } = await import('./kit-fake.ts');
  const restore = opencodeConsole({});
  const s = setup(), f = faked({}, { 'openclaw.setup.activate': (p) => ({ ok: false, status: p.apiKey === 'synthetic-invalid' ? 'auth' : p.apiKey === 'synthetic-network' ? 'network' : 'unavailable' }) });
  s.cfg.port = 0; s.cfg.linkPort = 0;
  s.crew.runtime.signIn = f.runtime.signIn.bind(f.runtime);
  for (const key of Object.keys(PROVIDERS)) s.crew.accounts.ready.set(key, false);
  const server = await startServer(s.cfg, s.db, s.crew);
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const headers = { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${readFileSync(join(s.cfg.stateDir, 'person.key'), 'utf8')}` };
  const api = async (path: string, body?: object) => {
    const r = await fetch(base + '/api/' + path, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    assert.equal(r.status, 200); return r.json();
  };
  const rows = () => api('accounts');
  const go = async () => (await rows()).find((r: any) => r.account === 'opencode-go');
  const action = (act: string, body = {}) => api('accounts/1/opencode-go/' + act, body);
  try {
    await f.started;
    await api('onboard', { address: 'Umer' });
    for (let n = 0; n < 2; n++) {
      await action('login', { via: 'key' });
      await action('paste', { text: 'synthetic-no-helpers' });
      await until('Go key result', async () => { const r = await go(); return r.notIncluded || r.signIn.error; });
      const row = await go();
      assert.equal(row.notIncluded, true, JSON.stringify(row));
      assert.equal(row.signIn.state, 'failed', 'the key wait is over');
      assert.equal(row.signedIn, false);
      assert.equal(A.aiList(await rows()).mine[0].ai.key, 'opencode-go', 'the existing plan card names Go, even after returning to Chief');
      await action('paste', { text: 'synthetic-no-helpers' });
      assert.equal((await go()).notIncluded, true, 'repeat submission cannot restart a finished key wait');
      await action('retry');
      assert.equal((await go()).notIncluded, false, "I've changed my plan clears only the existing exclusion");
    }
    for (const [account, key, state, words] of [['opencode-go', 'synthetic-invalid', 'waiting', /That key didn't work/], ['opencode-go', 'synthetic-network', 'failed', /That didn't go through/], ['minimax', 'synthetic-invalid', 'waiting', /That key didn't work/]] as const) {
      await api(`accounts/1/${account}/login`, { via: 'key' });
      await api(`accounts/1/${account}/paste`, { text: key });
      await until('distinct key failure', async () => (await rows()).find((r: any) => r.account === account).signIn.error);
      const row = (await rows()).find((r: any) => r.account === account);
      assert.equal(row.notIncluded, false);
      assert.equal(row.signIn.state, state);
      assert.match(row.signIn.error, words);
      await api(`accounts/1/${account}/cancel`, {});
    }
    f.fake.handle('wizard.next', () => { throw new Error('Synthetic provider connection failed.'); });
    await api('accounts/1/grok/login', { via: 'code' });
    await until('other provider failure', async () => (await rows()).find((r: any) => r.account === 'grok').signIn.state === 'failed');
    const other = (await rows()).find((r: any) => r.account === 'grok');
    assert.equal(other.notIncluded, false);
    assert.match(other.signIn.error, /Synthetic provider connection failed/);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.done(); await f.done();
  }
});

test('a Go key added with no workspace clears the workspace an earlier pick left on the engine', async () => {
  const { faked } = await import('./kit-fake.ts');
  const restore = opencodeConsole({ 'synthetic-login': [{ id: 'org-a', name: 'Team A' }] });
  const f = faked();
  try {
    await f.started;
    const header = async () => (((await f.runtime.kit.call('config.get', {})) as any).config.models?.providers?.['opencode-go']?.headers ?? {})['x-opencode-org-id'];
    assert.equal((await f.runtime.kit.addKey('m1', { authChoice: 'opencode-go', apiKey: 'synthetic-login', orgId: 'org-a' })).status, 'ok');
    assert.equal(await header(), 'org-a', 'the pick is on the engine');
    // A bound service key lists no workspace, so its add names none: the earlier pick must not ride its calls.
    assert.equal((await f.runtime.kit.addKey('m1', { authChoice: 'opencode-go', apiKey: 'synthetic-service-key' })).status, 'ok');
    assert.equal(await header(), undefined, 'the service key runs with no workspace header');
  } finally {
    restore();
    await f.done();
  }
});

test('a Go key for several workspaces asks which one, then connects with it; one connects unasked', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { startServer } = await import('../src/server.ts');
  const { faked } = await import('./kit-fake.ts');
  const s = setup(), f = faked();
  s.cfg.port = 0; s.cfg.linkPort = 0;
  s.crew.runtime.signIn = f.runtime.signIn.bind(f.runtime);
  for (const key of Object.keys(PROVIDERS)) s.crew.accounts.ready.set(key, false);
  // The kit's own console listing, scripted per pasted key: two workspaces, one, or a refusal.
  const realFetch = globalThis.fetch;
  let heldStarted = false, release: () => void = () => {}, slowStarted = false, releaseSlow: () => void = () => {};
  const gate = new Promise<void>((yes) => { release = () => yes(); });
  const slowGate = new Promise<void>((yes) => { releaseSlow = () => yes(); });
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url) === 'https://opencode.ai/console/api/orgs') {
      const pasted = String(init?.headers?.authorization ?? '').replace(/^Bearer /, '');
      if (pasted === 'synthetic-multi') return Response.json([{ id: 'wrk_personal', name: 'Personal' }, { id: 'wrk_team', name: 'Team' }]);
      if (pasted === 'synthetic-single') return Response.json([{ id: 'wrk_personal', name: 'Personal' }]);
      if (pasted === 'synthetic-unread') return new Response(null, { status: 503 });
      if (pasted === 'synthetic-held') { heldStarted = true; await gate; return Response.json([{ id: 'wrk_personal', name: 'Personal' }, { id: 'wrk_team', name: 'Team' }]); }
      if (pasted === 'synthetic-slow') { slowStarted = true; await slowGate; return Response.json([{ id: 'wrk_personal', name: 'Personal' }]); }
      return new Response(null, { status: 401 });
    }
    return realFetch(url, init);
  }) as any;
  const server = await startServer(s.cfg, s.db, s.crew);
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const headers = { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${readFileSync(join(s.cfg.stateDir, 'person.key'), 'utf8')}` };
  const api = async (path: string, body?: object) => {
    const r = await fetch(base + '/api/' + path, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    assert.equal(r.status, 200); return r.json();
  };
  const rows = () => api('accounts');
  const go = async () => (await rows()).find((r: any) => r.account === 'opencode-go');
  const action = (act: string, body = {}) => api('accounts/1/opencode-go/' + act, body);
  const headerOf = () => {
    const patches = (f.fake.calls as { method: string; params: any }[]).filter((c) => c.method === 'config.patch' && String(c.params?.raw ?? '').includes('x-opencode-org-id'));
    return patches.length ? JSON.parse(patches.at(-1)!.params.raw).models.providers['opencode-go'].headers['x-opencode-org-id'] : undefined;
  };
  try {
    await f.started;
    await api('onboard', { address: 'Umer' });
    // An unreadable listing (console down): nothing connects, and the card never blames the key.
    await action('login', { via: 'key' });
    await action('paste', { text: 'synthetic-unread' });
    await until('unread listing fails the add', async () => !!(await go()).signIn?.error);
    assert.notEqual((await go()).signedIn, true, 'a key whose workspaces could not be read is never connected');
    assert.match((await go()).signIn.error, /Couldn’t reach OpenCode to check this key’s workspaces/, 'an unreadable listing shows the kit words, never a bad key');
    // Several: the card asks which workspace, then connects with the pick.
    await action('login', { via: 'key' });
    await action('paste', { text: 'synthetic-multi' });
    await until('workspace pick', async () => (await go()).signIn?.workspaces?.length === 2);
    assert.deepEqual((await go()).signIn.workspaces.map((w: { name: string }) => w.name), ['Personal', 'Team'], 'the card names workspaces, never ids');
    const shown = A.account(await rows(), 'opencode-go');
    assert.deepEqual(shown.pick?.map((w: { name: string }) => w.name), ['Personal', 'Team'], 'the adapter carries the pick to the sheet');
    assert.ok(shown.key, 'the sheet stays on the key step while it asks');
    await action('workspace', { id: 'wrk_team' });
    await until('Go connected with the pick', async () => (await go()).signedIn === true);
    assert.equal((await go()).signIn.state, 'done');
    assert.equal(headerOf(), 'wrk_team', 'the engine carries the picked workspace on every call');
    // One check at a time: a paste during a check is refused, and the checked key's own listing is what the card shows.
    await action('login', { via: 'key' });
    const held = action('paste', { text: 'synthetic-held' });
    await until('held check running', async () => heldStarted);
    const refused = await fetch(base + '/api/accounts/1/opencode-go/paste', { method: 'POST', headers, body: JSON.stringify({ text: 'synthetic-single' }) });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /Still checking the last key/);
    release();
    await held;
    assert.deepEqual((await go()).signIn.workspaces.map((w: { name: string }) => w.name), ['Personal', 'Team'], 'the held check lists its own workspaces');
    await action('workspace', { id: 'wrk_personal' });
    await until('held key connects with the pick', async () => (await go()).signedIn === true);
    // A cancelled check releases the lock: the next paste is accepted while the cancelled probe is still open.
    await action('login', { via: 'key' });
    action('paste', { text: 'synthetic-slow' }).catch(() => {});
    await until('slow check running', async () => slowStarted);
    await action('cancel');
    await action('login', { via: 'key' });
    action('paste', { text: 'synthetic-single' }).catch(() => {});
    releaseSlow();
    await until('key pasted after a cancel connects', async () => (await go()).signIn?.state === 'done');
    // One: no question, connected with it.
    await action('login', { via: 'key' });
    await action('paste', { text: 'synthetic-single' });
    await until('single-workspace key connects', async () => (await go()).signedIn === true);
    assert.equal((await go()).signIn?.workspaces, undefined, 'no pick shown for one workspace');
    assert.equal(headerOf(), 'wrk_personal', 'the one workspace is used unasked');
    // A refused listing (or a bound service key): connects with no workspace, the old words.
    await action('login', { via: 'key' });
    await action('paste', { text: 'synthetic-bound' });
    await until('bound key connects', async () => (await go()).signedIn === true);
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.done(); await f.done();
  }
});


test('a sign-in that stopped working (a password change): signed out for real, said once, and the task waits for a new one', async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  await crew.accounts.login('grok', 'code');
  await crew.accounts.finished('grok');
  disk.setBrains(cfg, 'scout', ['grok']);
  only(crew, ['grok']);
  const t = delegated(crew, 'scout', 'sign me out').task;
  await until('waiting for a new sign-in', () => task(db, t).state === 'paused');
  assert.equal(await crew.accounts.signedIn('grok'), false, 'its sign-in is gone, so nothing loops on it');
  assert.equal(db.get("SELECT text FROM messages WHERE bot = 'scout' ORDER BY id DESC")!.text,
    'Grok signed you out. That happens after a password change. Sign in again and the crew picks up where it left off.');
  done();
});

test('Claude-only sign-in, nothing chosen for work: Chief names Claude, never ChatGPT, and a model-less message runs on Claude', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sara');
  only(crew, ['claude']);
  crew.accounts.ready.set('claude', true);
  const said = () => db.all("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot'").map((m: any) => m.text).join('\n');
  // Nothing usable (a plan without helpers): the pause names the account she has.
  crew.accounts.notIncluded('claude', true);
  const { task: u } = await crew.post('chief', 'find a plumber') as { task: number };
  await until('waiting on the plan', () => task(db, u).state === 'paused');
  assert.ok(said().includes("Your Claude plan doesn't include helpers yet. Everything else in Claude is fine. A bigger Claude plan includes it."), said());
  assert.ok(!said().includes('ChatGPT'), said());
  // The plan changes: the same model-less message runs on her signed-in account, with no model chosen.
  crew.retryAccount('claude');
  await settled(db, u);
  assert.equal(task(db, u).state, 'done');
  assert.equal(JSON.parse(db.get("SELECT data FROM events WHERE kind = 'run.started' AND json_extract(data, '$.task') = ?", u)!.data).account, 'claude');
  assert.equal(task(db, u).brain, null, 'no model chosen: the signed-in account is the default');
  // Her sign-in stops working instead: Chief names Claude, never a ChatGPT sign-in.
  crew.accounts.expired.add('claude');
  const { task: v } = await crew.post('chief', 'and another job') as { task: number };
  await until('waiting on the sign-in', () => task(db, v).state === 'paused');
  assert.ok(said().includes("I will start the moment you sign in with Claude."), said());
  assert.ok(!said().includes('ChatGPT'), said());
  // Her sign-in fails mid-turn instead: the handoff names the exact account it lost.
  await crew.accounts.login('claude', 'code');
  await crew.accounts.finished('claude');
  const { task: w } = await crew.post('chief', 'sign me out now') as { task: number };
  await until('waiting after the sign-out', () => task(db, w).state === 'paused');
  assert.equal(crew.accounts.expired.has('claude'), true);
  assert.ok(said().includes('Claude signed you out. That happens after a password change. Sign in again and the crew picks up where it left off.'), said());
  assert.ok(!said().includes('ChatGPT'), said());
  done();
});

test('a first request needs no name: it waits for the sign-in and starts by itself', async () => {
  const { db, crew, done } = setup();
  only(crew, []);
  const { task: t } = crew.onboard('', 'Say hello') as { task: number };
  assert.equal(crew.person().address, '', 'no name was asked for');
  assert.equal(crew.person().onboarded, 1);
  await settled(db, t);
  assert.equal(task(db, t).state, 'paused', 'the request waits for a sign-in');
  await crew.accounts.login('chatgpt');
  await crew.accounts.finished('chatgpt');
  await settled(db, t);
  assert.equal(task(db, t).state, 'done');
  done();
});

test('typed-name onboarding ends on ideas, not an open question', async () => {
  const { crew, done } = setup();
  crew.onboard('sir');
  assert.equal(crew.botPage('chief').messages.length, 0, 'the empty thread renders ChiefIdeas');
  assert.equal(crew.person().address, 'sir', 'the address is stored in people');
  done();
});

test('a Hello goal tap goes straight to Research Rae: hired silently with no Chief task; an excluded plan stays with Chief', async () => {
  const { db, crew, done } = setup();
  // An excluded plan first, while Scout is still missing: no hire, Chief instead.
  const sara = 1;
  crew.accounts.notIncluded('chatgpt', true);
  const { task: u } = crew.onboard('Sara', 'Help me earn a little on the side', 'scout') as { task: number };
  await settled(db, u);
  assert.equal(task(db, u).bot, 'chief', 'an excluded plan goes to Chief');
  assert.equal(task(db, u).member, sara);
  assert.equal(crew.bot('scout'), undefined, 'no silent hire on an excluded plan');
  // A usable account: Research Rae is hired silently and her request starts in his thread.
  crew.retryAccount('chatgpt');
  await settled(db, u);
  const { task: t } = crew.onboard('sir', 'Help me earn a little on the side', 'scout') as { task: number };
  await settled(db, t);
  assert.ok(crew.bot('research-rae'), 'Research Rae is hired silently');
  assert.equal(task(db, t).bot, 'research-rae');
  assert.equal(task(db, t).origin, 'person');
  assert.equal(task(db, t).state, 'done');
  assert.equal(db.get("SELECT 1 FROM tasks WHERE bot = 'chief' AND member = 1 AND id != ?", u), undefined, 'no Chief task for the goal tap');
  assert.equal(db.get("SELECT text FROM messages WHERE bot = 'research-rae' AND author = 'person'")!.text, 'Help me earn a little on the side');
  done();
});

test('a Claude sign-in the kit cannot run says so: the sheet gets the run-it-yourself words, and a runnable one offers the sign-in', async () => {
  const { faked } = await import('./kit-fake.ts');
  const { crew, done } = setup(), f = faked();
  crew.runtime.signIn = f.runtime.signIn.bind(f.runtime);
  try {
    await f.started;
    for (const signIn of [false, true]) {
      // The kit's own answer, faked at its boundary: a failed anthropic-cli view carrying the typed cause.
      (f.runtime as any).kit.signIn = (_m: unknown, o: { authChoice: string }, on: (v: object) => void) => {
        assert.equal(o.authChoice, 'anthropic-cli');
        on({ state: 'failed', via: 'browser', why: 'failed', error: 'Claude Code is not signed in.', cause: { code: 'needs_cli_login', cli: 'claude', home: '/home/you', signIn } });
        return { paste() {}, cancel() {}, done: Promise.resolve() };
      };
      await crew.accounts.login('claude');
      await crew.accounts.finished('claude');
      const view = crew.accounts.view('claude')!;
      assert.equal(view.state, 'failed');
      assert.deepEqual(view.cliLogin, { signIn }, 'the sheet is told which variant');
      const g = A.account([{ account: 'claude', signedIn: false, signIn: view }], 'claude');
      assert.deepEqual(g.cliLogin, { signIn });
      const w = A.cliLoginWords(g.cliLogin!, 'Claude');
      assert.equal(w.cmd, signIn ? '' : 'claude', 'only the run-it-yourself variant names the command');
      assert.match(w.action, signIn ? /^Sign in with Claude$/ : /^Try again$/);
      assert.match(w.body, signIn ? /Sign in with your Claude plan/ : /isn't signed in\. Open a command window on this computer/);
      await crew.accounts.cancel('claude'); crew.accounts.stop();
      (crew.accounts as any).views.delete('claude');
    }
  } finally { done(); await f.done(); }
});
