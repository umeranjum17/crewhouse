// First run and "Sign in with ChatGPT", against the account shim over the runtime (the engine's own wizard is wired in
// the sign-in step of the build; these pin the product words and states around it, which never change).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { setup, settled, task, until } = await import('./lab.ts');
const { classify: classifyText } = await import('@byokit/accounts');
const disk = await import('../src/bots.ts');

/** A user message the stub model turns into one tool call. */
const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
/** Only the named accounts count as signed in for the person; the rest wait for sign-in. */
function only(crew: any, keys: string[]) {
  for (const k of ['chatgpt', 'grok', 'copilot', 'openrouter', 'minimax', 'claude']) {
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

test('a sign-in that stopped working (a password change): signed out for real, said once, and the task waits for a new one', async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  await crew.accounts.login('grok', 'code');
  await crew.accounts.finished('grok');
  disk.setBrains(cfg, 'scout', ['grok']);
  only(crew, ['grok']);
  const t = crew.assign('scout', 'sign me out', 'chief').task;
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
  done();
});

test('typed-name onboarding ends on ideas, not an open question', async () => {
  const { crew, done } = setup();
  crew.onboard('sir');
  assert.equal(crew.botPage('chief').messages.length, 0, 'the empty thread renders ChiefIdeas');
  assert.equal(crew.person().address, 'sir', 'the address is stored in people');
  done();
});

test('a Hello goal tap goes straight to Scout: hired silently with no Chief task; an excluded plan stays with Chief', async () => {
  const { db, crew, done } = setup();
  // An excluded plan first, while Scout is still missing: no hire, Chief instead.
  const sara = 1;
  crew.accounts.notIncluded('chatgpt', true);
  const { task: u } = crew.onboard('Sara', 'Help me earn a little on the side', 'scout') as { task: number };
  await settled(db, u);
  assert.equal(task(db, u).bot, 'chief', 'an excluded plan goes to Chief');
  assert.equal(task(db, u).member, sara);
  assert.equal(crew.bot('scout'), undefined, 'no silent hire on an excluded plan');
  // A usable account: Scout is hired silently and her request starts in his thread.
  crew.retryAccount('chatgpt');
  await settled(db, u);
  const { task: t } = crew.onboard('sir', 'Help me earn a little on the side', 'scout') as { task: number };
  await settled(db, t);
  assert.ok(crew.bot('scout'), 'Scout is hired silently');
  assert.equal(task(db, t).bot, 'scout');
  assert.equal(task(db, t).origin, 'person');
  assert.equal(task(db, t).state, 'done');
  assert.equal(db.get("SELECT 1 FROM tasks WHERE bot = 'chief' AND member = 1 AND id != ?", u), undefined, 'no Chief task for the goal tap');
  assert.equal(db.get("SELECT text FROM messages WHERE bot = 'scout' AND author = 'person'")!.text, 'Help me earn a little on the side');
  done();
});
