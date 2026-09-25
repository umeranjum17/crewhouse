// First run and "Sign in with ChatGPT", on the engine's real ChatGPT sign-in with OpenAI stood in for (a mocked token
// endpoint): the redirect back to this computer, Crewhouse's own page in that tab, and every way it can go wrong.
// Then the plain-words moments after it: a plan without helpers, a work account, a sign-in that stopped working.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
// The callback port is ChatGPT's fixed 1455 in the product; the tests take a free one so they never meet a real sign-in.
process.env.CREWHOUSE_CALLBACK_PORT = String(await free());
process.env.CREWHOUSE_REDIRECT_MS = '600';
const { setup, settled, task, until } = await import('./lab.ts');
const { Accounts, CALLBACK_PORT, OWNER, planOf } = await import('../src/accounts.ts');
const { classify } = await import('../src/crew.ts');
const disk = await import('../src/bots.ts');

/** A ChatGPT access token as OpenAI shapes it: the account, the plan and the email in its claims. */
const jwt = (plan: string, email = 'sara@example.com') => ['x', Buffer.from(JSON.stringify({
  'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1', chatgpt_plan_type: plan }, 'https://api.openai.com/profile': { email },
})).toString('base64url'), 'sig'].join('.');

// OpenAI, stood in for: the engine calls fetch for the token exchange and the device code; everything else is real.
const openai = { plan: 'plus', email: 'sara@example.com', exchange: 200 };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (url === 'https://auth.openai.com/oauth/token') {
    const code = new URLSearchParams(String(init?.body)).get('code');
    if (openai.exchange !== 200 || code !== 'good') return new Response('{"error":{"code":"token_expired"}}', { status: 401 });
    return Response.json({ access_token: jwt(openai.plan, openai.email), refresh_token: 'r', expires_in: 3600 });
  }
  if (url.endsWith('/deviceauth/usercode')) return Response.json({ device_auth_id: 'd1', user_code: 'WB60-FFV06', interval: 1 });
  if (url.endsWith('/deviceauth/token')) return new Response('', { status: 403 }); // still waiting for the person
  return realFetch(input, init);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

/** The real engine's ChatGPT sign-in, on a member's own runtime (no stub model). */
function accounts() {
  const s = setup();
  return { ...s, accounts: new Accounts({ ...s.cfg, engine: 'pi' }) };
}
/** The stub counts every account but Grok as signed in; a real person has only the ones they signed in to. */
function only(crew: any, member: number, keys: string[]) {
  const real = crew.accounts.signedIn.bind(crew.accounts);
  crew.accounts.signedIn = async (m: number, k: string) => {
    if (m !== member || keys.includes(k)) return real(m, k);
    crew.accounts.ready.set(`${m}:${k}`, false);
    return false;
  };
}
const back = async (q: Record<string, string>) => {
  const res = await realFetch(`http://127.0.0.1:${CALLBACK_PORT}/auth/callback?${new URLSearchParams(q)}`);
  return { status: res.status, page: await res.text() };
};
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

test("sign in with ChatGPT: its own page, straight back here; the tab shows Crewhouse's words, and only once they're true", async () => {
  const { accounts: a, done } = accounts();
  try {
    const v = (await a.login(OWNER, 'chatgpt'))!;
    assert.equal(v.state, 'waiting');
    assert.equal(v.via, 'browser', 'the redirect is the default, not a code');
    assert.equal(v.code, undefined);
    const url = new URL(v.url!);
    assert.equal(url.origin + url.pathname, 'https://auth.openai.com/oauth/authorize');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback');
    // A stray or forged return changes nothing.
    const forged = await back({ code: 'good', state: 'not-it' });
    assert.equal(forged.status, 400);
    assert.match(forged.page, /out of date/);
    assert.equal(a.view(OWNER, 'chatgpt')!.state, 'waiting');
    // The real one: exchanged, kept in this person's own file, and the tab says so in Crewhouse's words.
    const ok = await back({ code: 'good', state: stateOf(v.url!) });
    assert.match(ok.page, /You're signed in\. You can go back to Crewhouse now\./);
    assert.doesNotMatch(ok.page, /Authentication successful|\bpi\b/i, "never the engine's own page");
    await a.finished(OWNER, 'chatgpt');
    assert.equal(a.view(OWNER, 'chatgpt')!.state, 'done');
    assert.equal(await a.signedIn(OWNER, 'chatgpt'), true);
    assert.match(readFileSync(a.authPath(OWNER), 'utf8'), /openai-codex/);
    assert.deepEqual(a.chatgptPlan(OWNER), { plan: 'plus', email: 'sara@example.com', work: false });
  } finally { a.stop(); done(); }
});

test('sign-in failures on the page: declined, a failed exchange, the port taken, the page timing out; never half signed in', async () => {
  const { accounts: a, done } = accounts();
  try {
    // Cancel on ChatGPT's page: nothing changed, said kindly, in the tab and in the app.
    let v = (await a.login(OWNER, 'chatgpt'))!;
    const declined = await back({ error: 'access_denied', state: stateOf(v.url!) });
    assert.match(declined.page, /No problem\. Nothing was changed/);
    await a.finished(OWNER, 'chatgpt');
    assert.equal(a.view(OWNER, 'chatgpt')!.why, 'declined');
    assert.equal(await a.signedIn(OWNER, 'chatgpt'), false);

    // OpenAI refuses the exchange after the page said yes: the tab does not claim success, and nothing is kept.
    openai.exchange = 401;
    v = (await a.login(OWNER, 'chatgpt'))!;
    const refused = await back({ code: 'good', state: stateOf(v.url!) });
    assert.doesNotMatch(refused.page, /signed in\./);
    assert.match(refused.page, /ChatGPT didn't finish the sign-in/);
    await a.finished(OWNER, 'chatgpt');
    assert.equal(a.view(OWNER, 'chatgpt')!.error, "ChatGPT didn't finish the sign-in. Tap Sign in with ChatGPT to try again.");
    assert.equal(await a.signedIn(OWNER, 'chatgpt'), false);
    openai.exchange = 200;

    // Something else on this computer is signing in to ChatGPT right now (its port is taken).
    const other: Server = await new Promise((r) => { const s = createServer().listen(CALLBACK_PORT, '127.0.0.1', () => r(s)); });
    v = (await a.login(OWNER, 'chatgpt'))!;
    await new Promise((r) => other.close(r));
    assert.deepEqual([v.state, v.why, v.error], ['failed', 'busy', 'Something else on this computer is signing in to ChatGPT. Try again in a minute.']);

    // Having trouble? The code instead, from the same button; and by itself when the page never comes back.
    v = (await a.login(OWNER, 'chatgpt'))!;
    assert.equal(v.via, 'browser');
    v = (await a.login(OWNER, 'chatgpt', { via: 'code' }))!;
    assert.deepEqual([v.state, v.via, v.code, v.url], ['waiting', 'code', 'WB60-FFV06', 'https://auth.openai.com/codex/device']);
    a.cancel(OWNER, 'chatgpt');
    await a.finished(OWNER, 'chatgpt');
    assert.equal(a.view(OWNER, 'chatgpt'), null, 'cancelled: nothing kept, nothing shown');
    v = (await a.login(OWNER, 'chatgpt'))!;
    assert.equal(v.via, 'browser');
    await until('the code took over', () => a.view(OWNER, 'chatgpt')?.code === 'WB60-FFV06', 5000);
    await assert.rejects(back({ code: 'good', state: stateOf(v.url!) }), 'the old page no longer signs anyone in');
    a.cancel(OWNER, 'chatgpt');

    // "Use my personal account": ChatGPT's page asks which account again.
    v = (await a.login(OWNER, 'chatgpt', { fresh: true }))!;
    assert.equal(new URL(v.url!).searchParams.get('prompt'), 'login');
    a.cancel(OWNER, 'chatgpt');
    assert.equal(await a.signedIn(OWNER, 'chatgpt'), false, 'never half signed in');
  } finally { a.stop(); done(); }
});

test('a work ChatGPT is recognised from the sign-in itself, so the app can steer to a personal one', async () => {
  assert.deepEqual(planOf(jwt('enterprise', 'sara@acme.com')), { plan: 'enterprise', email: 'sara@acme.com', work: true });
  for (const p of ['business', 'team', 'edu']) assert.equal(planOf(jwt(p)).work, true, p);
  for (const p of ['plus', 'pro', 'free', 'go']) assert.equal(planOf(jwt(p)).work, false, p);
  assert.deepEqual(planOf('not-a-token'), { plan: '', email: '', work: false });
  const { accounts: a, done } = accounts();
  try {
    Object.assign(openai, { plan: 'business', email: 'sara@acme.com' });
    const v = (await a.login(OWNER, 'chatgpt'))!;
    await back({ code: 'good', state: stateOf(v.url!) });
    await a.finished(OWNER, 'chatgpt');
    assert.equal(a.chatgptPlan(OWNER)!.work, true);
  } finally { Object.assign(openai, { plan: 'plus', email: 'sara@example.com' }); a.stop(); done(); }
});

test('first run: her first request waits for her own sign-in, Chief says why in one line, and it starts by itself after', async () => {
  const { db, crew, done } = setup();
  const sara = crew.addMember('Sara').id;
  // Nobody signed in: her request is not failed, it waits for her (never the owner's account).
  const real = crew.accounts.signedIn.bind(crew.accounts);
  crew.accounts.signedIn = async (m: number, k: string) => { if (m !== sara) return real(m, k); (crew.accounts as any).ready.set(`${m}:${k}`, false); return false; };
  // The first-run screen: she taps an idea; that is both "call me Sara" and her first request.
  const { task: t } = crew.onboard('Sara', sara, "Plan this week's dinners, with a shopping list") as { task: number };
  await settled(db, t);
  assert.equal(crew.member(sara).address, 'Sara');
  assert.equal(crew.botPage('chief', sara).messages[0].text, "Plan this week's dinners, with a shopping list", 'her thread starts with her request');
  assert.equal(task(db, t).state, 'paused');
  assert.equal(task(db, t).member, sara);
  const said = () => db.all("SELECT text FROM messages WHERE bot = 'chief' AND member = ? AND author = 'bot'", sara).map((m: any) => m.text);
  assert.ok(said().includes('Delighted, Sara. To think, the crew uses your own ChatGPT, the same one you already use.'), said().join('\n'));
  assert.equal(db.get("SELECT 1 FROM events WHERE kind = 'run.started'"), undefined, 'nothing ran on anyone else\'s account');
  // She signs in: it starts by itself, and Chief thanks her.
  crew.accounts.signedIn = real;
  (crew.accounts as any).ready = new Map();
  crew.accounts.onSignedIn!(sara, 'chatgpt');
  await settled(db, t);
  assert.equal(task(db, t).state, 'done');
  assert.ok(said().includes("You're signed in. Thank you, Sara. On it now."));
  done();
});

test('a ChatGPT plan without helpers: said plainly with the way forward; "ask the owner" and "I changed my plan"', async () => {
  const { cfg, db, crew, done } = setup();
  assert.equal(classify('You have hit your ChatGPT usage limit (free plan).')?.why, 'not_included');
  assert.equal(classify('You have hit your ChatGPT usage limit (plus plan). Try again in ~30 min.')?.why, 'rate_limit');
  const sara = crew.addMember('Sara').id;
  crew.onboard('Sara', sara);
  crew.recruit('scout', 'Scout', 'person');
  disk.setBrains(cfg, 'scout', ['chatgpt']);
  db.run('UPDATE bots SET member = ? WHERE id = ?', sara, 'scout');
  only(crew, sara, ['chatgpt']);
  const { task: t } = crew.post('scout', 'find a plumber, no helpers in plan', undefined, sara) as { task: number };
  await until('waiting on the plan', () => task(db, t).state === 'paused');
  assert.equal(task(db, t).wake_at, null);
  assert.equal(crew.accounts.notIncluded(sara, 'chatgpt'), true);
  assert.equal(db.get("SELECT text FROM messages WHERE bot = 'scout' ORDER BY id DESC")!.text,
    "Your ChatGPT plan doesn't include helpers yet. Everything else in ChatGPT is fine. ChatGPT Plus includes it, or you can ask Umer to cover it.".replace('Umer', crew.member(OWNER).name));
  crew.askOwner(sara, 'chatgpt');
  assert.ok(db.get("SELECT 1 FROM messages WHERE bot = 'chief' AND member = ? AND text LIKE 'Sara asked if you could cover their helpers.%'", OWNER), 'the owner hears, in his own thread');
  assert.throws(() => crew.askOwner(OWNER, 'chatgpt'), /owner/);
  // "I've changed my plan": tried again, and it goes through.
  crew.retryAccount(sara, 'chatgpt');
  await settled(db, t);
  assert.equal(task(db, t).state, 'done');
  assert.equal(crew.accounts.notIncluded(sara, 'chatgpt'), false);
  done();
});

test('a sign-in that stopped working (a password change): signed out for real, said once, and the task waits for a new one', async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  await crew.accounts.login(OWNER, 'grok', { via: 'code' });
  await crew.accounts.finished(OWNER, 'grok');
  disk.setBrains(cfg, 'scout', ['grok']);
  only(crew, OWNER, ['grok']);
  const rt: any = await crew.accounts.runtime(OWNER);
  const getAuth = rt.getAuth.bind(rt);
  // Refreshing is refused (the password changed); the sign-in as stored still reaches the model once.
  rt.getAuth = async (p: string, o?: any) => { if (o?.minOAuthValidityMs) throw new Error('invalid_grant: refresh token revoked'); return getAuth(p, o); };
  const t = crew.assign('scout', 'sign me out', 'chief').task;
  await until('waiting for a new sign-in', () => task(db, t).state === 'paused');
  assert.equal(await crew.accounts.signedIn(OWNER, 'grok'), false, 'its sign-in is gone, so nothing loops on it');
  assert.equal(db.get("SELECT text FROM messages WHERE bot = 'scout' ORDER BY id DESC")!.text,
    'Grok signed you out. That happens after a password change. Sign in again and the crew picks up where it left off.');
  done();
});

test('crewd scrubs the environment before anything loads the engine: main.ts imports nothing else statically', () => {
  const main = readFileSync(join(import.meta.dirname, '..', 'src', 'main.ts'), 'utf8');
  const statics = [...main.matchAll(/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.equal(statics[0], './isolate.ts', 'the scrub comes first');
  for (const s of statics) assert.match(s, /^(node:|\.\/isolate\.ts$|\.\/config\.ts$)/, `a static import runs before the scrub: ${s}`);
  assert.match(main, /await import\('\.\/crew\.ts'\)/);
});
