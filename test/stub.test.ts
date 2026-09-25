// End to end through the real daemon, running the bundled engine on the stub model: no account, no network, no quota.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-test-'));
// A port the OS says is free, not a random guess that another run may hold.
const port = await new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const base = `http://127.0.0.1:${port}`;
const daemon = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
  env: { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_HOLD_MS: '5000', CREWHOUSE_PORT: String(port), CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
after(() => daemon.kill());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = { 'x-crewhouse': '1' }) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 10_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = await fn(); if (v) return v; }
  throw new Error('timed out');
}
/** A message the stub model answers with one tool call, then a reply saying what the tool returned. */
const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
const say = (bot: string, text: string) => api('POST', `/api/bots/${bot}/messages`, { text });
const done = (bot: string, task: number) => until(async () => (await api('GET', `/api/bots/${bot}`)).body.tasks.find((x: any) => x.id === task && ['done', 'failed'].includes(x.state)));
const ready = () => until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);

test('chief onboarding, recruit, assign, grants', async () => {
  await ready();

  // Chief greets first and asks how to address the person; the first reply is stored as the address.
  let page = (await api('GET', '/api/bots/chief')).body;
  assert.match(page.messages[0].text, /I am Chief, of the Crewhouse/);
  assert.match(page.messages[0].text, /how would you like me to address you/);
  assert.match(page.messages[0].text, /stop and ask you first before anything leaves this house, costs money/, 'his stop-and-ask rules come first');
  assert.doesNotMatch(page.messages[0].text, /Master|aye/i);
  await say('chief', 'Sir');
  assert.equal((await api('GET', '/api/state')).body.person.address, 'Sir');

  // Cross-site writes are refused.
  assert.equal((await api('POST', '/api/recruit', { template: 'reel' }, {})).status, 403);

  // A normal message to Chief is a Chief turn on the engine.
  await say('chief', 'I need a demo video');
  await until(async () => (await api('GET', '/api/bots/chief')).body.messages.find((m: any) => m.text === 'stub chief: done with "The person says: I need a demo video"'));

  // Chief recruits Reel with his own tool; the folder is the bot.
  const rec = (await say('chief', `get me a video maker ${call('crew_recruit', { template: 'reel', name: 'Reel' })}`)).body.task;
  await done('chief', rec);
  const dir = join(root, 'crew', 'bots', 'reel');
  for (const f of ['AGENTS.md', 'notes.md', 'skills/make-reel/SKILL.md']) assert.ok(existsSync(join(dir, f)), f);
  const tried = (await say('reel', `hire a friend ${call('crew_recruit', { template: 'scout' })}`)).body.task;
  await done('reel', tried);
  assert.ok(!(await api('GET', '/api/state')).body.bots.some((b: any) => b.id === 'scout'), 'only Chief recruits');

  // Chief hands Reel a task; it runs and reports back in Chief's thread.
  const hand = (await say('chief', `please ${call('crew_assign', { bot: 'reel', task: 'Make a 10 second demo' })}`)).body.task;
  await done('chief', hand);
  const t = await until(async () => (await api('GET', '/api/bots/reel')).body.tasks.find((x: any) => x.title === 'Make a 10 second demo' && x.state === 'done'));
  page = (await api('GET', '/api/bots/chief')).body;
  assert.ok(page.messages.some((m: any) => m.author === 'system' && m.text.includes(`Reel has finished task #${t.id}`)));

  // Grants: what the person ticks is what the bot gets.
  const tools = (await api('GET', '/api/bots/reel')).body.tools;
  assert.ok(tools.find((x: any) => x.id === 'media').granted);
  await api('PUT', '/api/bots/reel/tools', { tools: ['files', 'github'] });
  assert.deepEqual((await api('GET', '/api/bots/reel')).body.tools.filter((x: any) => x.granted).map((x: any) => x.id).sort(), ['crew', 'files', 'github']);
  await api('PUT', '/api/bots/reel/tools', { tools: ['files', 'media', 'images'] });

});

test('nothing technical reaches the app; the person\'s own files ask in one plain sentence', async () => {
  await ready();
  const seen = JSON.stringify([(await api('GET', '/api/state')).body, (await api('GET', '/api/bots/reel')).body, (await api('GET', '/api/bots/chief')).body, (await api('GET', '/api/accounts')).body, (await api('GET', '/api/connections')).body]);
  for (const bad of [root, homedir() + '/', 'openai-codex', 'gpt-', 'grok-4', 'Muse', 'Meta', 'bwrap', 'ffmpeg -', '[Crewhouse', 'Your id in Crewhouse', 'claude', 'CLAUDE', 'token']) {
    assert.ok(!seen.includes(bad), `the app was sent "${bad}": …${seen.slice(Math.max(0, seen.indexOf(bad) - 120), seen.indexOf(bad) + 80)}…`);
  }
  assert.doesNotMatch(seen, /\d%/, 'no usage percentages');
  const accounts = (await api('GET', '/api/accounts')).body;
  assert.deepEqual(accounts.filter((a: any) => a.member === 1).map((a: any) => a.name), ['ChatGPT', 'Grok', 'GitHub Copilot', 'OpenRouter']);

  // Touching the person's own files asks, in one plain sentence; the answer comes from the app.
  const outside = join(root, 'Documents', 'plan.txt');
  const w = (await say('reel', `save the plan ${call('write', { path: outside, content: 'plan' })}`)).body.task;
  const ask = await until(async () => (await api('GET', '/api/state')).body.asks[0]);
  assert.equal(ask.title, 'Reel wants to change a file in a folder outside your home: “plan.txt”.');
  assert.deepEqual(ask.detail, { effect: 'files', words: ask.title, spends: false, covers: 'a folder outside your home', always: 'a folder outside your home' });
  assert.equal((await api('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow' })).status, 200);
  await done('reel', w);
  assert.equal(readFileSync(outside, 'utf8'), 'plan');
});

test('connecting an app, as the app screen asks for it: not yet, or the app\'s own page', async () => {
  await ready();
  assert.equal((await api('POST', '/api/connections/outlook')).status, 404, 'cut from v1');
  assert.equal((await api('POST', '/api/connections/gmail')).status, 409, 'Google waits for the owner to switch it on for the house');
  assert.equal((await api('GET', '/api/state')).body.house.google, false);
  assert.equal((await api('PUT', '/api/house/google', { id: 'nope', secret: 's' })).status, 400, "the owner's setup checks what was pasted");
  assert.deepEqual((await api('GET', '/api/connections/notion')).body, { state: 'cancelled' });
  assert.deepEqual((await api('GET', '/api/state')).body.connections, []);
  assert.equal((await api('DELETE', '/api/connections/notion', undefined, {})).status, 403, 'cross-site pages cannot touch connections');
});

test('sign in from the app: a code to show and a page to open, then signed in', async () => {
  await ready();
  const grok = async () => (await api('GET', '/api/accounts')).body.find((a: any) => a.member === 1 && a.account === 'grok');
  assert.equal((await grok()).signedIn, false);
  assert.equal((await api('POST', '/api/accounts/1/claude/login', {})).status, 404, 'no Claude');
  assert.equal((await api('POST', '/api/accounts/1/grok/login', { via: 'code' }, {})).status, 403, 'cross-site pages cannot start a sign-in');
  const started = await api('POST', '/api/accounts/1/grok/login', { via: 'code' });
  assert.equal(started.status, 200);
  assert.deepEqual([started.body.signIn.code, started.body.signIn.url], ['CREW-2026', 'https://example.test/xai/device'], 'a code to show and a page to open');
  await until(async () => (await grok()).signedIn);
  assert.equal((await api('POST', '/api/accounts/1/grok/logout', {})).status, 200);
  assert.equal((await grok()).signedIn, false);
});

test('screen: take over and give back through the API; watching needs the Computer grant', async () => {
  await ready();
  assert.equal((await api('POST', '/api/bots/reel/takeover')).status, 200);
  assert.equal((await api('GET', '/api/state')).body.bots.find((b: any) => b.id === 'reel').controls, 'person');
  assert.equal((await api('POST', '/api/bots/reel/giveback', { note: 'signed in' })).status, 200);
  assert.equal((await api('POST', '/api/bots/reel/giveback', {})).status, 409);
  assert.equal((await api('POST', '/api/bots/reel/takeover', undefined, {})).status, 403, 'cross-site pages cannot take over');
  assert.equal((await api('POST', '/api/bots/reel/steer', { text: 'faster' })).status, 409, 'nothing running to steer');

  // Reel's grants were narrowed above (no Computer), so its screen refuses to open.
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/desktop/reel`);
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ id: 1, method: 'session.open', params: { permissions: ['view'] } }));
  const reply = JSON.parse(String(await new Promise((r) => ws.once('message', r))));
  assert.equal(reply.error.code, 'no-screen');
  ws.close();
  const foreign = new WebSocket(`ws://127.0.0.1:${port}/ws/desktop/reel`, { origin: 'https://evil.example' });
  assert.equal(await new Promise((r) => { foreign.once('open', () => r('open')); foreign.once('error', () => r('refused')); }), 'refused');
});

test('routines: Chief sets one up from chat, it fires on schedule through the daemon, the person manages it', async () => {
  await ready();
  assert.equal((await api('GET', '/api/schedule?text=' + encodeURIComponent('weekdays at 8am'))).body.words, 'Weekdays at 8:00 am');
  assert.equal((await api('GET', '/api/schedule?text=someday')).status, 400);

  const t = (await say('chief', `every friday ${call('crew_routine', { bot: 'reel', when: 'every Friday 17:00', task: 'Make a demo of what shipped this week' })}`)).body.task;
  await done('chief', t);
  const chiefSays = (await api('GET', '/api/bots/chief')).body.messages.map((m: any) => m.text);
  assert.ok(chiefSays.some((x: string) => /^Routine added: “Make a demo of what shipped this week” for Reel, every friday at 5:00 pm\. First run/.test(x)));
  let r = (await api('GET', '/api/state')).body.routines.find((x: any) => x.name === 'Make a demo of what shipped this week');
  assert.equal(r.words, 'Every Friday at 5:00 pm');

  // Its time comes (moved into the past, as after a sleep): crewd's own clock fires it and Reel does the work.
  new DatabaseSync(join(root, 'state', 'crew.db')).prepare('UPDATE routines SET next_at = ? WHERE id = ?').run(Date.now() - 1000, r.id);
  r = await until(async () => (await api('GET', '/api/state')).body.routines.find((x: any) => x.id === r.id && x.history[0]?.state === 'done'));
  assert.equal(r.history[0].why, 'schedule');
  assert.ok(r.next_at > Date.now());

  // The person pauses it, runs it now, and removes it.
  assert.equal((await api('PUT', `/api/routines/${r.id}`, { state: 'paused' })).status, 200);
  assert.equal((await api('POST', `/api/routines/${r.id}/run`)).status, 200);
  await until(async () => (await api('GET', '/api/state')).body.routines.find((x: any) => x.id === r.id && x.history[0]?.why === 'now' && x.history[0]?.state === 'done'));
  const own = (await api('POST', '/api/routines', { bot: 'reel', schedule: 'every 2 hours', task: 'Tidy the screenshots folder', model: 'copilot' })).body;
  assert.equal(own.thinks, 'GitHub Copilot');
  assert.equal((await api('DELETE', `/api/routines/${own.id}`)).status, 200);
  assert.equal((await api('POST', '/api/routines', { bot: 'reel', schedule: 'daily 9', task: 'x' }, {})).status, 403, 'cross-site pages cannot add routines');
});

test('memory: the bot proposes a note, crewd caps and commits it, Undo reverts it', async () => {
  await ready();
  const hire = (await say('chief', `a writer please ${call('crew_recruit', { template: 'scribe', name: 'Quill' })}`)).body.task;
  await done('chief', hire);
  const dir = join(root, 'crew', 'bots', 'quill');
  const notes = () => readFileSync(join(dir, 'notes.md'), 'utf8');
  const log = () => execFileSync('git', ['log', '--format=%s'], { cwd: dir }).toString().trim().split('\n');
  const learned = async () => (await api('GET', '/api/bots/quill')).body.trail.filter((e: any) => e.kind === 'memory.learned');
  const remember = async (input: object) => { const t = (await say('quill', `note this ${call('crew_remember', input)}`)).body.task; return done('quill', t); };

  // The debrief asks for it at the end of every task.
  const first = (await say('quill', 'Draft a note')).body.task;
  await done('quill', first);
  const session = new DatabaseSync(join(root, 'state', 'crew.db')).prepare('SELECT session FROM tasks WHERE id = ?').get(first) as any;
  assert.match(readFileSync(session.session, 'utf8'), /When you finish: if this task showed/);

  await remember({ text: 'Prefers 0.5 s transitions' });
  await remember({ text: 'Signs off with "Best"' });
  await remember({ text: 'Prefers ~0.8 s transitions', replaces: '0.5 s' });
  assert.equal(notes(), '- Prefers ~0.8 s transitions\n- Signs off with "Best"\n', 'a correction rewrites, it does not append');
  assert.match((await remember({ text: 'x', replaces: 'nothing like this' })).result, /no note mentions/);
  assert.deepEqual(log().slice(0, 3), ['Learned: Prefers ~0.8 s transitions', 'Learned: Signs off with "Best"', 'Learned: Prefers 0.5 s transitions']);

  // Undo the correction: the old note comes back, as a commit.
  const [fix, sign] = await learned();
  assert.equal((await api('POST', `/api/bots/quill/memory/${fix.seq}/undo`)).status, 200);
  assert.equal(notes(), '- Prefers 0.5 s transitions\n- Signs off with "Best"\n');
  assert.equal((await api('POST', `/api/bots/quill/memory/${fix.seq}/undo`)).status, 409, 'undone once');
  assert.equal((await api('POST', `/api/bots/quill/memory/${sign.seq}/undo`)).status, 200);
  assert.equal(notes(), '- Prefers 0.5 s transitions\n');
  assert.equal(log()[0], 'Undo: Signs off with "Best"');
  assert.ok((await learned()).find((e: any) => e.seq === sign.seq).undone);
  assert.equal((await api('POST', `/api/bots/quill/memory/${sign.seq}/undo`, undefined, {})).status, 403, 'cross-site pages cannot undo');
});
