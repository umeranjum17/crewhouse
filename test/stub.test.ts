// End to end through the real daemon, running the bundled engine on the stub model: no account, no network, no quota.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { setup as lab, settled, release, task } from './lab.ts';
import { createServer, type AddressInfo } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import * as A from '../web/src/adapter.ts';
import { startServer } from '../src/server.ts';
import { engineGaps, missing, probeEngine } from '../src/desktop.ts';

const root = temp('crewhouse-test');
// A port the OS says is free, not a random guess that another run may hold.
const port = await new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const base = `http://127.0.0.1:${port}`;
// Fixture writers share crewd's WAL file and its bounded SQLite contention handler.
const openDb = () => new DatabaseSync(join(root, 'state', 'crew.db'), { timeout: 3000 });
/** A fresh install seeds no digest: plant the one this coverage needs, like an existing install has. */
const seedDigest = () => { const db = openDb(); try { if (!db.prepare("SELECT 1 FROM routines WHERE kind = 'digest'").get()) db.prepare("INSERT INTO routines (bot, name, schedule, kind, next_at, created_at) VALUES ('chief', 'Morning digest', 'every day 8:00', 'digest', ?, ?)").run(Date.now() + 86_400_000, Date.now()); } finally { db.close(); } };
const startDaemon = () => spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
  env: { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_HOLD_MS: '5000', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let daemon = startDaemon();
after(() => daemon.kill());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const personWs = () => new WebSocket(base.replace('http:', 'ws:') + '/ws', `crewhouse-person.${readFileSync(join(root, 'state', 'person.key'), 'utf8')}`);
const { PROVIDERS } = await import('../src/accounts.ts');
async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = { 'x-crewhouse': '1' }) {
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8')}`, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 10_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = await fn(); if (v) return v; }
  throw new Error('timed out');
}
/** A message the stub model answers with one tool call, then a reply saying what the tool returned. */
const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
// The person talks only to Chief: a helper's words go through him, opened with the helper's name (the routing rule that hands them on).
const names: Record<string, string> = { quill: 'Quill', scribe: 'Scribe', reel: 'Reel', 'video-reel': 'Video Reel', 'writer-quill': 'Writer Quill' };
const say = (bot: string, text: string) => api('POST', '/api/bots/chief/messages', { text: bot === 'chief' ? text : `${names[bot]}, ${text}` });
const done = (bot: string, task: number) => until(async () => (await api('GET', `/api/bots/${bot}`)).body.tasks.find((x: any) => x.id === task && ['done', 'failed'].includes(x.state)));
const ready = () => until(async () => (await api('GET', '/api/state').catch(() => null))?.body.person);

test('chief onboarding, recruit, assign, grants', async () => {
  await ready();

  // Chief greets first; an ordinary first request is a task, never a name.
  let page = (await api('GET', '/api/bots/chief')).body;
  assert.match(page.messages[0].text, /I am Chief, of the Crewhouse/);
  assert.match(page.messages[0].text, /What would you like help with/);
  assert.match(page.messages[0].text, /stop and ask you first before sending anything, spending money/, 'his stop-and-ask rules come first');
  assert.doesNotMatch(page.messages[0].text, /Master|aye/i);
  const first = (await say('chief', 'Reply with exactly: Hello.')).body.task;
  await done('chief', first);
  assert.equal((await api('GET', '/api/state')).body.person.address, null);
  assert.equal((await api('GET', '/api/state')).body.person.name, 'Owner');
  await api('POST', '/api/onboard', { address: 'Sir' });
  assert.equal((await api('GET', '/api/state')).body.person.address, 'Sir');

  // Cross-site writes are refused.
  assert.equal((await api('POST', '/api/recruit', { template: 'reel' }, {})).status, 403);

  // Cross-site reads are refused too: a loopback caller without the person's authority reads nothing,
  // and the public header alone never stands in for it.
  const bare = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers }).then((r) => r.status);
  assert.equal(await bare('/api/about'), 403);
  assert.equal(await bare('/api/about', { 'x-crewhouse': '1' }), 403);
  const unpaired = new WebSocket(base.replace('http:', 'ws:') + '/ws');
  await assert.rejects(new Promise((resolve, reject) => { unpaired.on('open', resolve); unpaired.on('error', reject); }), 'the live-event socket is refused without the authority');
  assert.equal((await api('GET', '/api/about')).status, 200);

  // A normal message to Chief is a Chief turn on the engine.
  await say('chief', 'I need a demo video');
  await until(async () => (await api('GET', '/api/bots/chief')).body.messages.find((m: any) => m.text === 'stub chief: done with "The person says: I need a demo video"'));

  // Chief recruits Video Reel with his own tool; the folder is the bot.
  const rec = (await say('chief', `get me a video maker ${call('crew_recruit', { template: 'reel', name: 'Video Reel' })}`)).body.task;
  await done('chief', rec);
  const dir = join(root, 'crew', 'bots', 'video-reel');
  for (const f of ['AGENTS.md', 'soul.md', 'skills/make-reel/SKILL.md']) assert.ok(existsSync(join(dir, f)), f);
  const tried = (await say('video-reel', `get a friend to help ${call('crew_recruit', { template: 'scout' })}`)).body.task;
  await done('video-reel', tried);
  assert.ok(!(await api('GET', '/api/state')).body.bots.some((b: any) => b.id === 'scout'), 'only Chief recruits');

  // Chief hands Video Reel a task; it runs and reports back in Chief's thread.
  const hand = (await say('chief', `please ${call('crew_assign', { bot: 'video-reel', task: 'Make a 10 second demo' })}`)).body.task;
  await done('chief', hand);
  const t = await until(async () => (await api('GET', '/api/bots/video-reel')).body.tasks.find((x: any) => x.title === 'Make a 10 second demo' && x.state === 'done'));
  page = (await api('GET', '/api/bots/chief')).body;
  const said = page.messages.find((m: any) => m.author === 'bot' && m.text.startsWith('All done.'));
  assert.ok(said, 'Chief gives one wrap-up for the assigned work');
  assert.equal(page.messages.filter((m: any) => m.author === 'bot' && m.text.startsWith('All done.') && m.task_id === hand).length, 1, 'the finished helper job closes exactly once');
  assert.equal(said.task_id, hand);
  assert.doesNotMatch(said.text, /#\d|has finished|Sir/, 'no task number or honorific');

  // The helper's delivered file shows as a card on that one wrap line; handoff copies stay out.
  const wrapDb = openDb();
  wrapDb.prepare('INSERT INTO events (at, kind, bot, data) VALUES (?, ?, ?, ?)').run(Date.now(), 'file.delivered', 'video-reel', JSON.stringify({ task: t.id, path: 'files/demo.xlsx', note: 'demo sheet' }));
  wrapDb.prepare('INSERT INTO events (at, kind, bot, data) VALUES (?, ?, ?, ?)').run(Date.now(), 'file.delivered', 'video-reel', JSON.stringify({ task: t.id, path: 'files/from-reel/copy.txt' }));
  wrapDb.close();
  page = (await api('GET', '/api/bots/chief')).body;
  const wrapped = page.messages.find((m: any) => m.author === 'bot' && m.text.startsWith('All done.'));
  assert.equal(page.messages.filter((m: any) => m.author === 'bot' && m.text.startsWith('All done.') && m.task_id === hand).length, 1, 'the finished helper job closes exactly once');
  assert.ok(wrapped.files.some((f: any) => f.path === 'files/demo.xlsx'), "the wrap line carries the helper's file");
  assert.ok(!wrapped.files.some((f: any) => f.path === 'files/from-reel/copy.txt'), 'handoff copies stay off the card');

  // Two helpers on one Chief job: each delivered file shows exactly once on the single wrap line.
  await api('POST', '/api/recruit', { template: 'scout', name: 'Scout' });
  const pair = (await say('chief', `two jobs please ${call('crew_assign', { bot: 'video-reel', task: 'First pair job' })} ${call('crew_assign', { bot: 'scout', task: 'Second pair job' })}`)).body.task;
  const jobA = await until(async () => (await api('GET', '/api/bots/video-reel')).body.tasks.find((x: any) => x.title === 'First pair job' && x.state === 'done'));
  const jobB = await until(async () => (await api('GET', '/api/bots/scout')).body.tasks.find((x: any) => x.title === 'Second pair job' && x.state === 'done'));
  await done('chief', pair);
  const pairDb = openDb();
  for (const [bot, id, label] of [['video-reel', jobA.id, 'first'], ['scout', jobB.id, 'second']] as const) {
    pairDb.prepare('INSERT INTO events (at, kind, bot, data) VALUES (?, ?, ?, ?)').run(Date.now(), 'file.delivered', bot, JSON.stringify({ task: id, path: `files/${label}.xlsx`, note: `${label} sheet` }));
  }
  pairDb.close();
  page = (await api('GET', '/api/bots/chief')).body;
  const both = page.messages.filter((m: any) => m.author === 'bot' && m.text.startsWith('All done.') && m.task_id === pair);
  assert.equal(both.length, 1, 'two helpers still close with one wrap line');
  assert.deepEqual(both[0].files.map((f: any) => f.path).sort(), ['files/first.xlsx', 'files/second.xlsx']);

  // Grants: what the person ticks is what the bot gets.
  const tools = (await api('GET', '/api/bots/video-reel')).body.tools;
  assert.ok(tools.find((x: any) => x.id === 'media').granted);
  await api('PUT', '/api/bots/video-reel/tools', { tools: ['files', 'github'] });
  assert.deepEqual((await api('GET', '/api/bots/video-reel')).body.tools.filter((x: any) => x.granted).map((x: any) => x.id).sort(), ['crew', 'files', 'github']);
  await api('PUT', '/api/bots/video-reel/tools', { tools: ['files', 'media', 'images'] });

});

test('desktop setup refuses a loader failure in doctor, the tool kit and the live state', async () => {
  const s = lab(), before = process.env.DESKLINK_ENGINE;
  s.cfg.port = 0; s.cfg.linkPort = 0;
  const server = await startServer(s.cfg, s.db, s.crew);
  const doctor = () => spawnSync(process.execPath, [join(import.meta.dirname, '..', 'src', 'doctor.ts')], {
    env: { ...process.env, CREWHOUSE_STATE_DIR: s.cfg.stateDir, CREWHOUSE_CREW_DIR: s.cfg.crewDir, CREWHOUSE_TOOLS_DIR: s.cfg.toolsDir }, encoding: 'utf8', timeout: 15_000,
  });
  try {
    for (const library of ['libevdev.so.2', 'libfuture.so.7']) {
      // A task-private native command reproduces the loader's exit/status, not a mocked readiness helper.
      const engine = join(s.root, `unavailable-${library}`);
      writeFileSync(engine, `#!/bin/sh\necho 'error while loading shared libraries: ${library}: cannot open shared object file: No such file or directory' >&2\nexit 127\n`, { mode: 0o700 });
      process.env.DESKLINK_ENGINE = engine;
      const out = doctor();
      assert.equal(out.status, 1, out.stderr);
      assert.match(out.stdout, new RegExp(`missing system library: ${library.replaceAll('.', '\\.')}.*sudo dnf install`));
      assert.doesNotMatch(out.stdout, /desklink engine are ready|\nReady\./);
      assert.match(out.stdout, /Computer \(desklink\).*missing system library/, 'the kit row uses the same runtime check');
      assert.equal(probeEngine().refused, true);
      assert.match(missing().join('\n'), new RegExp(`missing system library: ${library.replaceAll('.', '\\.')}`));
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/state`, {
        headers: { 'x-crewhouse': '1', authorization: `Bearer ${readFileSync(join(s.cfg.stateDir, 'person.key'), 'utf8')}` },
      });
      assert.equal(res.status, 200);
      const state = await res.json() as any;
      assert.equal(state.desktops.ready, false, 'the app must not promise a desktop that cannot load');
    }
    process.env.DESKLINK_ENGINE = join(s.root, 'absent-engine');
    const soft = doctor();
    assert.match(soft.stdout, /· not available: needs .*the desklink engine/, 'an absent engine is an optional gap, not a failure');
    assert.doesNotMatch(soft.stdout, /✗ not available/);
    const slow = join(s.root, 'slow-engine'), once = join(s.root, 'slow-once');
    writeFileSync(slow, `#!/bin/sh\nif [ -e '${once}' ]; then exit 0; fi\n: > '${once}'\nexec sleep 30\n`, { mode: 0o700 });
    process.env.DESKLINK_ENGINE = slow;
    const t0 = Date.now();
    assert.match(probeEngine(t0).engine ?? '', /ETIMEDOUT/, 'a probe past its bound reports the failure');
    assert.match(probeEngine(t0 + 59_000).engine ?? '', /ETIMEDOUT/, 'within a minute the failure is not probed again');
    assert.equal(probeEngine(t0 + 60_001).engine, null, 'after a minute the next probe answers');
    assert.deepEqual(engineGaps(), [], 'the desktop engine is ready once it answers');
  } finally {
    if (before === undefined) delete process.env.DESKLINK_ENGINE; else process.env.DESKLINK_ENGINE = before;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    s.done();
  }
});

test('parked peer reads: both approvals resume one turn and the person gets the finished draft', async () => {
  const s = lab();
  s.cfg.port = 0; s.cfg.linkPort = 0;
  s.crew.onboard('Umer');
  s.crew.recruit('scribe', 'Quill', 'person');
  const server = await startServer(s.cfg, s.db, s.crew);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (method: string, path: string, body?: object) => {
    const res = await fetch(url + path, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${readFileSync(join(s.cfg.stateDir, 'person.key'), 'utf8')}` }, body: body && JSON.stringify(body) });
    assert.equal(res.status, 200);
    return res.json();
  };
  const outside = join(s.root, 'peer', 'files');
  mkdirSync(outside, { recursive: true });
  const paths = ['ask permission-one.md', 'ask permission-two.md'].map((name) => join(outside, name));
  paths.forEach((path) => writeFileSync(path, 'A writing brief'));
  try {
    const results: { mode: string; prompts: number }[] = [];
    for (const mode of ['one ask', 'spaced answers', 'close answers', 'answer before settlement']) {
      const selected = (mode === 'one ask' ? paths.slice(0, 1) : paths).map((path) => path.replace('.md', `-${mode}.md`));
      selected.forEach((path) => writeFileSync(path, 'A writing brief'));
      const { task: id } = await request('POST', '/api/bots/chief/messages', { text: 'Quill, ' + selected.map((path) => call('crew_read', { path })).join(' ') });
      await until(async () => s.db.all("SELECT * FROM events WHERE kind = 'ask.parked' AND json_extract(data, '$.task') = ?", id).length === selected.length);
      if (mode !== 'answer before settlement') {
        await release(s.crew, 'quill'); // fixture control: release the initial hold after its parked-call abort
        await until(async () => !s.crew.busy.has('quill'));
      }
      const asks = s.db.all("SELECT * FROM asks WHERE task_id = ? ORDER BY id", id);
      const answer = (ask: any) => request('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow', scope: 'task' });
      if (mode === 'spaced answers') {
        await answer(asks[0]);
        console.log('only one answered', { state: task(s.db, id).state, busy: s.crew.busy.has('quill') });
        if (s.crew.busy.has('quill')) await release(s.crew, 'quill', 'Waiting on the other read.');
        await until(async () => !s.crew.busy.has('quill'));
        const gap = Date.now() + 2000;
        await until(async () => Date.now() >= gap);
        await answer(asks[1]);
      } else await Promise.all(asks.map(answer));
      if (mode === 'answer before settlement') {
        assert.equal(s.db.all("SELECT * FROM events WHERE kind = 'run.prompted' AND json_extract(data, '$.task') = ?", id).length, 1, 'a queued resume waits for the live turn to settle');
        await release(s.crew, 'quill');
        await until(async () => s.db.all("SELECT * FROM events WHERE kind = 'run.prompted' AND json_extract(data, '$.task') = ?", id).length === 2);
      }
      results.push({ mode, prompts: s.db.all("SELECT * FROM events WHERE kind = 'run.prompted' AND json_extract(data, '$.task') = ?", id).length });
      await release(s.crew, 'quill', 'The writing plan is ready.');
      await until(async () => task(s.db, id).state === 'done');
      assert.match(JSON.stringify(await request('GET', '/api/bots/quill')), /The writing plan is ready/);
    }
    console.log('approval counterfactuals', results);
    assert.deepEqual(results.map((r) => r.prompts), [2, 2, 2, 2], 'one initial turn and one resume after all parked reads are answered');
    const missing = await request('POST', '/api/bots/chief/messages', { text: 'Quill, ' + call('crew_app', { tool: 'write', input: { args: ['platforms'] } }) });
    await until(async () => task(s.db, missing.task).state === 'done');
    const page = await request('GET', '/api/bots/quill');
    const reply = page.messages.find((m: any) => m.task_id === missing.task && m.author === 'bot');
    assert.match(reply.text, /does not have that tool/);
    assert.doesNotMatch(reply.text, /Unknown tool/);
    assert.equal(s.db.all("SELECT * FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') = ?", missing.task).length, 0, 'missing commands never reach execution');
  } finally {
    await s.crew.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    s.done();
  }
});

test('a Chief reply streams partial words before its durable message', async () => {
  await ready();
  if (!(await api('GET', '/api/state')).body.person.onboarded) await say('chief', 'Sir');
  const events: any[] = [];
  const ws = personWs();
  await new Promise<void>((resolve) => ws.on('open', () => resolve()));
  ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
  try {
    const started = Date.now();
    const { body } = await say('chief', 'What is 17 + 29?');
    await until(async () => events.find((e) => e.kind === 'reply.partial' && e.bot === 'chief' && e.data.text.includes('stub chief:')));
    await done('chief', body.task);
    const trace = events.filter((e) => e.bot === 'chief');
    const partial = trace.find((e) => e.kind === 'reply.partial');
    assert.equal(Object.hasOwn(partial.data, 'member'), false, 'live replies have no household selector');
    const final = trace.find((e) => e.kind === 'message' && e.data.author === 'bot');
    assert.ok(partial && final && trace.indexOf(partial) < trace.indexOf(final), 'partial text arrives before the completed reply');
    assert.ok(events.find((e) => e.kind === 'message' && e.data.author === 'person'), 'the send is persisted');
    const created = trace.find((e) => e.kind === 'task.created' && e.data.task === body.task);
    const prompted = trace.find((e) => e.kind === 'run.prompted' && e.data.task === body.task);
    const substantive = trace.find((e) => e.kind === 'reply.partial' && e.data.task === body.task && e.data.text.includes('stub chief:'));
    assert.ok(created && prompted && substantive, 'the real HTTP send reached a task, prompt and stub model words');
    console.log(`stub HTTP arithmetic send→task ${created.at - started}ms; task→prompt ${prompted.at - created.at}ms; prompt→model text ${substantive.at - prompted.at}ms`);
  } finally { ws.close(); }
});

test('Chief streams substantive prose before his tool runs', async () => {
  await ready();
  if (!(await api('GET', '/api/state')).body.person.onboarded) await say('chief', 'Alex');
  const events: any[] = [];
  const ws = personWs();
  await new Promise<void>((resolve) => ws.on('open', () => resolve()));
  ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
  try {
    const { body } = await say('chief', `Sort this first [first words] ${call('crew_report', { text: 'started' })}`);
    await done('chief', body.task);
    await until(async () => events.find((e) => e.kind === 'task.progress' && e.data.task === body.task));
    const trace = events.filter((e) => e.bot === 'chief' && e.data?.task === body.task);
    const first = trace.findIndex((e) => e.kind === 'reply.partial' && e.data.text.includes('checking the next step'));
    const tool = trace.findIndex((e) => e.kind === 'task.progress');
    assert.ok(first >= 0 && tool > first, 'the first streamed words precede tool execution');
  } finally { ws.close(); }
});

// This verifies the real tool-fetch mechanics and scripted wording contract, not model judgement.
test('two-source fare backtest: both local sources fetched and the reply names them plus an unchecked item', async () => {
  await ready();
  await api('PUT', '/api/bots/chief/tools', { tools: ['crew', 'web'] });
  const fetched = new Set<string>();
  const source = (name: string, fare: number) => createHttpServer((_req, res) => {
    fetched.add(name);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`${name}: fare $${fare}`);
  }).listen(0, '127.0.0.1');
  const narrow = source('Narrowfare', 1999), fareboard = source('Fareboard', 799);
  try {
    await Promise.all([narrow, fareboard].map((s) => new Promise<void>((resolve) => s.once('listening', resolve))));
    const url = (s: ReturnType<typeof createHttpServer>) => `http://127.0.0.1:${(s.address() as AddressInfo).port}/fare`;
    const text = `[two-fare-backtest] Compare these fares. ${call('crew_web_fetch', { url: url(narrow) })} ${call('crew_web_fetch', { url: url(fareboard) })}`;
    const task = (await say('chief', text)).body.task;
    await done('chief', task);
    assert.deepEqual([...fetched].sort(), ['Fareboard', 'Narrowfare']);
    const messages = (await api('GET', '/api/bots/chief')).body.messages;
    const reply = messages.findLast((m: any) => m.author === 'bot' && /Fareboard/.test(m.text))?.text;
    assert.ok(reply);
    assert.match(reply, /Fareboard.*Narrowfare|Narrowfare.*Fareboard/);
    assert.match(reply, /didn't check/);
  } finally { narrow.close(); fareboard.close(); }
});

test('nothing technical reaches the app; the person\'s own files ask in one plain sentence', async () => {
  await ready();
  const seen = JSON.stringify([(await api('GET', '/api/state')).body, (await api('GET', '/api/bots/video-reel')).body, (await api('GET', '/api/bots/chief')).body, (await api('GET', '/api/accounts')).body, (await api('GET', '/api/connections')).body]);
  for (const bad of [root, homedir() + '/', 'openai-codex', 'gpt-', 'grok-4', 'Muse', 'Meta', 'bwrap', 'ffmpeg -', '[Crewhouse', 'Your id in Crewhouse', 'token']) {
    assert.ok(!seen.includes(bad), `the app was sent "${bad}": …${seen.slice(Math.max(0, seen.indexOf(bad) - 120), seen.indexOf(bad) + 80)}…`);
  }
  assert.doesNotMatch(seen, /\d%/, 'no usage percentages');
  const accounts = (await api('GET', '/api/accounts')).body;
  assert.ok(accounts.every((a: any) => !('member' in a)), 'account rows belong to the person');
  assert.deepEqual(accounts.map((a: any) => a.name), ['ChatGPT', 'Grok', 'GitHub Copilot', 'OpenRouter', 'MiniMax', 'Claude', 'OpenCode Go']);
  assert.deepEqual(accounts.map((a: any) => a.signedOut), [false, false, false, false, false, false, false], 'nothing signed out on a fresh sign-in');

  // Touching the person's own files asks, in one plain sentence; the answer comes from the app.
  const outside = join(root, 'Documents', 'plan.txt');
  const w = (await say('video-reel', `save the plan ${call('crew_write', { path: outside, content: 'plan' })}`)).body.task;
  const ask = await until(async () => (await api('GET', '/api/state')).body.asks[0]);
  assert.equal(ask.title, 'Video Reel wants to change a file in a folder outside your home: “plan.txt”.');
  assert.deepEqual(ask.detail, { effect: 'files', words: ask.title, spends: false, covers: 'a folder outside your home', always: 'a folder outside your home' });
  assert.equal((await api('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow' })).status, 200);
  await done('video-reel', w);
  assert.equal(readFileSync(outside, 'utf8'), 'plan');
  // The answered card stays in the thread as a receipt: crewd keeps it (state.answered) and the adapter words it.
  const st = (await api('GET', '/api/state')).body;
  assert.ok(st.answered.find((a: any) => a.id === ask.id)?.answered_at, 'the answered ask is kept, not dropped');
  assert.match(A.answeredReceipts(st).find((r: any) => r.id === ask.id)!.line, /^Allowed · \d{1,2}:\d{2} (am|pm)$/);
});

test('connecting an app, as the app screen asks for it: not yet, or the app\'s own page', async () => {
  await ready();
  assert.equal((await api('POST', '/api/connections/outlook')).status, 404, 'cut from v1');
  assert.equal((await api('POST', '/api/connections/gmail')).status, 409, 'Google waits for its one-time setup');
  assert.equal((await api('GET', '/api/state')).body.house.google, false);
  assert.equal((await api('PUT', '/api/house/google', { id: 'nope', secret: 's' })).status, 400, "Google setup checks what was pasted");
  assert.deepEqual((await api('GET', '/api/connections/notion')).body, { state: 'cancelled' });
  assert.deepEqual((await api('GET', '/api/state')).body.connections, []);
  assert.equal((await api('DELETE', '/api/connections/notion', undefined, {})).status, 403, 'cross-site pages cannot touch connections');
});

test('skills: the reviewed starter set lists with on/off; switching needs the real engine', async () => {
  await ready();
  const skills = (await api('GET', '/api/skills')).body;
  assert.equal(skills.live, false, 'the stand-in engine holds nothing');
  assert.deepEqual(skills.starter.map((s: any) => s.slug), ['weather', 'github', 'obsidian', 'homeassistant-skill']);
  for (const s of skills.starter) {
    assert.equal(s.on, false);
    for (const words of [s.summary, s.why, ...s.needs])
      assert.doesNotMatch(words, /token|host\b|engine|grant|command|`|\/home\/|\.md\b|\/api\//i, `${s.slug} speaks plainly`);
  }
  // Add to your crew: crewd's reviewed list places every reviewed row (app, skill, plugin) in a section, mail and calendar first.
  const placed = Object.keys(skills.purposes), apps = Object.keys((await import('../src/connections.ts')).APPS);
  for (const id of [...skills.starter.map((s: any) => s.slug), ...apps, 'herdr']) assert.ok(['mail', 'home', 'code', 'design'].includes(skills.purposes[id]), `${id} has a section`);
  assert.deepEqual(placed.slice(0, 2), ['gmail', 'calendar'], 'mail and calendar lead the list');
  assert.deepEqual((await api('GET', '/api/skills/search?q=weather')).body, { results: [] }, 'search waits for the engine');
  const switched = await api('POST', '/api/skills/weather/on', {});
  assert.equal(switched.status, 400, 'the stand-in cannot switch');
  assert.doesNotMatch(switched.body.error, /ECONNREFUSED|gateway|skillKey|clawhub:/i, 'the refusal is plain words');
  assert.equal((await api('POST', '/api/skills/made-up/on', {})).body.error.includes('reviewed starter'), true, 'outside the set stays outside');
});

test('sign in from the app: a code to show and a page to open, then signed in', async () => {
  await ready();
  const grok = async () => (await api('GET', '/api/accounts')).body.find((a: any) => a.account === 'grok');
  assert.equal((await grok()).signedIn, false);
  // Claude is offered through the engine's own route; the card labels its prerequisite as a product name, not an acronym.
  assert.equal((PROVIDERS.claude?.cli ?? '').includes('Claude Code'), true, 'the prerequisite is said plainly');
  assert.equal((await api('POST', '/api/accounts/1/grok/login', { via: 'code' }, {})).status, 403, 'cross-site pages cannot start a sign-in');
  const started = await api('POST', '/api/accounts/999/grok/login', { via: 'code' });
  assert.equal(started.status, 200);
  assert.deepEqual([started.body.signIn.code, started.body.signIn.url], ['CREW-2026', 'https://example.test/xai/device'], 'a code to show and a page to open');
  await until(async () => (await grok()).signedIn);
  assert.equal((await api('POST', '/api/accounts/1/grok/logout', {})).status, 200);
  assert.equal((await grok()).signedIn, false);
});

test('screen: take over and give back through the API; watching needs the Computer grant', async () => {
  await ready();
  assert.equal((await api('POST', '/api/bots/video-reel/takeover')).status, 200);
  assert.equal((await api('GET', '/api/state')).body.bots.find((b: any) => b.id === 'video-reel').controls, 'person');
  assert.equal((await api('POST', '/api/bots/video-reel/giveback', { note: 'signed in' })).status, 200);
  assert.equal((await api('POST', '/api/bots/video-reel/giveback', {})).status, 409);
  assert.equal((await api('POST', '/api/bots/video-reel/takeover', undefined, {})).status, 403, 'cross-site pages cannot take over');
  assert.equal((await api('POST', '/api/bots/video-reel/steer', { text: 'faster' })).status, 409, 'nothing running to steer');

  // Set this test's own grant precondition, even if an earlier onboarding assertion fails.
  await api('PUT', '/api/bots/video-reel/tools', { tools: ['files', 'media', 'images'] });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/desktop/video-reel`, `crewhouse-person.${readFileSync(join(root, 'state', 'person.key'), 'utf8')}`);
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ id: 1, method: 'session.open', params: { permissions: ['view'] } }));
  const reply = JSON.parse(String(await new Promise((r) => ws.once('message', r))));
  assert.equal(reply.error.code, 'no-screen');
  ws.close();
  const unauthenticated = new WebSocket(`ws://127.0.0.1:${port}/ws/desktop/video-reel`);
  assert.equal(await new Promise((r) => { unauthenticated.once('open', () => r('open')); unauthenticated.once('error', () => r('refused')); }), 'refused', 'loopback alone cannot control a desktop');
  const foreign = new WebSocket(`ws://127.0.0.1:${port}/ws/desktop/video-reel`, { origin: 'https://evil.example' });
  assert.equal(await new Promise((r) => { foreign.once('open', () => r('open')); foreign.once('error', () => r('refused')); }), 'refused');
});

test('routine PUT validates the whole update and commits fields and event together', async (t) => {
  await ready();
  await api('POST', '/api/recruit', { template: 'scout', name: 'Scout' });
  const rejected = [
    { quiet: true, state: 'invalid' },
    { quiet: true, state: 'paused', schedule: 'invalid' },
    { state: 'invalid' },
    { schedule: 'invalid' },
    { quiet: 'true', state: 'paused', schedule: 'weekdays 10am' },
    { quiet: true, schedule: 'every minute' },
  ];
  for (const body of rejected) await t.test(`reject ${JSON.stringify(body)} without writing`, async () => {
    const made = await api('POST', '/api/routines', { bot: 'scout', schedule: 'weekdays 9am', task: 'Check the synthetic list', quiet: false });
    assert.equal(made.status, 200);
    const db = openDb();
    try {
      const row = () => db.prepare('SELECT * FROM routines WHERE id = ?').get(made.body.id);
      const events = () => db.prepare("SELECT * FROM events WHERE json_extract(data, '$.routine') = ?").all(made.body.id);
      const before = { row: row(), events: events() };
      assert.equal((await api('PUT', `/api/routines/${made.body.id}`, body)).status, 400);
      const after = { row: row(), events: events() };
      console.log(JSON.stringify({ body, before, after }));
      assert.deepEqual(after, before, '400 preserves quiet/state/schedule/next_at and events');
      daemon.kill();
      await until(async () => daemon.exitCode !== null || daemon.signalCode !== null);
      daemon = startDaemon();
      await ready();
      const reloaded = (await api('GET', '/api/state')).body.routines.find((r: any) => r.id === made.body.id);
      for (const key of ['quiet', 'state', 'schedule', 'next_at']) assert.equal(reloaded[key], before.row![key]);
    } finally { db.close(); await api('DELETE', `/api/routines/${made.body.id}`); }
  });
  await t.test('valid mixed PUT persists, and a failed event rolls back every field', async () => {
    const made = await api('POST', '/api/routines', { bot: 'scout', schedule: 'weekdays 9am', task: 'Check the synthetic list', quiet: false });
    const id = made.body.id;
    const db = openDb();
    try {
      const row = () => db.prepare('SELECT * FROM routines WHERE id = ?').get(id)!;
      const events = () => db.prepare("SELECT COUNT(*) AS n FROM events WHERE json_extract(data, '$.routine') = ?").get(id)!.n;
      const before = { row: row(), events: events() };
      db.exec("CREATE TRIGGER reject_routine_event BEFORE INSERT ON events WHEN NEW.kind = 'routine.paused' BEGIN SELECT RAISE(ABORT, 'synthetic event failure'); END");
      const refused = await api('PUT', `/api/routines/${id}`, { quiet: true, state: 'paused', schedule: 'weekdays 10am' });
      assert.equal(refused.status, 400);
      assert.match(refused.body.error, /synthetic event failure/);
      assert.deepEqual({ row: row(), events: events() }, before, 'event failure rolls back quiet too');
      db.exec('DROP TRIGGER reject_routine_event');
      assert.equal((await api('PUT', `/api/routines/${id}`, { quiet: true, state: 'paused', schedule: 'weekdays 10am' })).status, 200);
      assert.equal(events(), Number(before.events) + 1);
      const updated = row();
      assert.deepEqual([updated.quiet, updated.state, updated.schedule], [1, 'paused', 'weekdays 10am']);
      assert.equal(new Date(Number(updated.next_at)).getHours(), 10);
      assert.equal((await api('PUT', `/api/routines/${id}`, { quiet: false })).status, 200);
      assert.deepEqual([row().quiet, row().state, row().schedule, row().next_at], [0, updated.state, updated.schedule, updated.next_at], 'quiet-only keeps the run time');
      const reopened = openDb();
      try { assert.deepEqual(reopened.prepare('SELECT * FROM routines WHERE id = ?').get(id), row(), 'fresh connection confirms durable fields'); } finally { reopened.close(); }
      daemon.kill();
      await until(async () => daemon.exitCode !== null || daemon.signalCode !== null);
      daemon = startDaemon();
      await ready();
      const reloaded = (await api('GET', '/api/state')).body.routines.find((r: any) => r.id === id);
      for (const key of ['quiet', 'state', 'schedule', 'next_at']) assert.equal(reloaded[key], row()[key]);
      seedDigest();
      const digest = (await api('GET', '/api/state')).body.routines.find((r: any) => r.kind === 'digest');
      assert.equal((await api('PUT', `/api/routines/${digest.id}`, { quiet: true, state: 'paused' })).status, 400);
    } finally { db.exec('DROP TRIGGER IF EXISTS reject_routine_event'); db.close(); await api('DELETE', `/api/routines/${id}`); }
  });
});

test('routines: Chief offers one as a card, the person starts it (or changes the time), it fires on schedule, the person manages it', async () => {
  await ready();
  const sched = (await api('GET', '/api/schedule?text=' + encodeURIComponent('weekdays at 8am'))).body;
  assert.equal(sched.words, 'Weekdays at 8:00 am');
  assert.match(sched.first, /am|pm/, "the first run in the computer's own words, so every screen reads the same");
  // The first run must name the day `next` really falls on. Which words it uses is the product's call (a bare time for
  // today, a weekday near by, a date further out), so the check asks only that every form is `next`'s own day — never
  // the wall clock's, which is what made this red whenever the suite ran on the wrong side of a day boundary.
  const dayWords = (at: number, time: string) => [time, `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${time}`,
    `${new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`];
  assert.ok(dayWords(sched.next, sched.words.split(' at ')[1]).includes(sched.first), `the first run never reads as some other day: ${sched.first}`);
  assert.equal((await api('GET', '/api/schedule?text=' + encodeURIComponent('every Monday'))).body.guessed, true, 'words that never named a time are a guess, and say so');
  const monday = (await api('GET', '/api/schedule?text=' + encodeURIComponent('every Monday'))).body;
  assert.ok(dayWords(monday.next, '9:00 am').includes(monday.first), 'even a guessed hour is read on the day it lands');
  // Whichever hour the suite runs at, at most one of the seven weekdays is today: every other one names the day it lands
  // on, so this guard can never go quiet just because the clock is on a Monday morning.
  for (const name of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
    const each = (await api('GET', `/api/schedule?text=${encodeURIComponent(`every ${name} 23:59`)}`)).body;
    if (new Date(each.next).toDateString() === new Date().toDateString()) continue;
    assert.ok(dayWords(each.next, '11:59 pm').includes(each.first), `every ${name} 23:59 must name the day it lands on, got "${each.first}"`);
  }
  assert.equal(sched.guessed, false, 'words that named a time are not a guess');
  assert.equal(typeof sched.zone, 'string', 'the computer names its zone, so a screen away from home can too');
  const bad = await api('GET', '/api/schedule?text=someday');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /"the 1st of every month 9:00"/, 'the refusal names a monthly example too');
  // A date each month, not only a weekday: the same plain words, and the next run really lands on that date.
  const monthly = (await api('GET', '/api/schedule?text=' + encodeURIComponent('on the 1st of every month at 9am'))).body;
  assert.equal(monthly.words, 'On the 1st of every month at 9:00 am');
  assert.equal(new Date(monthly.next).getDate(), 1, 'the next run lands on the 1st');
  assert.equal(new Date(monthly.next).getHours(), 9);
  assert.ok(dayWords(monthly.next, '9:00 am').includes(monthly.first), `a monthly first run never reads as some other day: ${monthly.first}`);
  assert.equal((await api('GET', '/api/schedule?text=' + encodeURIComponent('every month on the 15th'))).body.words, 'On the 15th of every month at 9:00 am');

  // Chief's crew_routine is a confirmed request now: a card with cadence, what, quiet and first run — no routine yet.
  const t = (await say('chief', `every friday ${call('crew_routine', { bot: 'video-reel', when: 'every Friday 17:00', task: 'Make a demo of what shipped this week' })}`)).body.task;
  await done('chief', t);
  const card = await until(async () => (await api('GET', '/api/state')).body.asks.find((a: any) => a.kind === 'propose' && a.detail.routine));
  assert.equal(card.detail.words, 'Every Friday at 5:00 pm, Video Reel will make a demo of what shipped this week.');
  assert.equal(card.detail.preview.head, 'A new routine');
  assert.equal(card.detail.preview.body.split('\n')[0], 'Every Friday at 5:00 pm');
  // The same words everywhere: the card's last line is the schedule preview's own first run.
  const friday = (await api('GET', '/api/schedule?text=' + encodeURIComponent('every Friday 17:00'))).body;
  assert.equal(card.detail.preview.body.split('\n').at(-1), `First time: ${friday.first}`, 'the card and the preview name one first run');
  assert.match(card.detail.preview.body, /Video Reel will make a demo of what shipped this week/);
  assert.equal((await api('GET', '/api/state')).body.routines.some((x: any) => x.name === 'Make a demo of what shipped this week'), false, 'nothing runs before the yes');

  // The person changes the time on the card, then starts it: the routine takes the new time.
  assert.equal((await api('POST', `/api/asks/${card.id}/answer`, { answer: 'allow', scope: 'once', schedule: 'every Friday 9am' })).status, 200);
  const chiefSays = (await api('GET', '/api/bots/chief')).body.messages.map((m: any) => m.text);
  const start = chiefSays.indexOf('New routine “Make a demo of what shipped this week”');
  assert.ok(start >= 0, 'approval writes the routine-start event');
  assert.match(chiefSays[start + 1], /^I'll have Video Reel make a demo of what shipped this week\. Every Friday at 9:00 am\. First check: /);
  assert.match(chiefSays[start + 1], /I'll bring the result back here each time\.$/, 'Chief explains the actual reporting cadence right after the event');
  let r = (await api('GET', '/api/state')).body.routines.find((x: any) => x.name === 'Make a demo of what shipped this week');
  assert.equal(r.words, 'Every Friday at 9:00 am');

  // Chief offers another, this time without a time of day: the card asks about the hour before anything runs. "Not now" leaves nothing behind.
  await done('chief', (await say('chief', `and ${call('crew_routine', { bot: 'video-reel', when: 'every Monday', task: 'Tidy the screenshots folder' })}`)).body.task);
  const again = await until(async () => (await api('GET', '/api/state')).body.asks.find((a: any) => a.kind === 'propose' && a.detail.routine));
  assert.ok(again.detail.preview.body.split('\n').includes('Did you mean 9:00 am?'), 'an odd schedule asks instead of quietly passing a guess as the person\'s');
  assert.equal((await api('POST', `/api/asks/${again.id}/answer`, { answer: 'deny' })).status, 200);
  assert.equal((await api('GET', '/api/state')).body.routines.some((x: any) => x.name === 'Tidy the screenshots folder'), false);

  // A quiet check-in the model wrote as the string "true": the card must still say it stays quiet, and the routine it
  // makes must be quiet. Chief promises "you only hear when it changes" in the same breath, so a card reading the
  // opposite — or an hourly helper speaking up on a flat day — is the person told two different things.
  await done('chief', (await say('chief', `and ${call('crew_routine', { bot: 'video-reel', when: 'every 2 hours', task: 'Watch the shared folder for new photos', quiet: 'true' })}`)).body.task);
  const hush = await until(async () => (await api('GET', '/api/state')).body.asks.find((a: any) => a.kind === 'propose' && a.detail.routine));
  assert.ok(hush.detail.preview.body.split('\n').includes('Tells you only when something changed'), `a quiet watch must not be previewed as a noisy one: ${hush.detail.preview.body}`);
  assert.equal((await api('POST', `/api/asks/${hush.id}/answer`, { answer: 'allow' })).status, 200);
  assert.equal((await api('GET', '/api/state')).body.routines.find((x: any) => x.name === 'Watch the shared folder for new photos').quiet, 1, 'the routine the person approved is the quiet one they were shown');

  // Its time comes (moved into the past, as after a sleep): crewd's own clock fires it and Video Reel does the work.
  const routineDb = openDb();
  try { routineDb.prepare('UPDATE routines SET next_at = ? WHERE id = ?').run(Date.now() - 1000, r.id); } finally { routineDb.close(); }
  r = await until(async () => (await api('GET', '/api/state')).body.routines.find((x: any) => x.id === r.id && x.history[0]?.state === 'done'));
  assert.equal(r.history[0].why, 'schedule');
  assert.ok(r.next_at > Date.now());

  // The person pauses it, runs it now, and removes it.
  assert.equal((await api('PUT', `/api/routines/${r.id}`, { state: 'paused' })).status, 200);
  assert.equal((await api('POST', `/api/routines/${r.id}/run`)).status, 200);
  await until(async () => (await api('GET', '/api/state')).body.routines.find((x: any) => x.id === r.id && x.history[0]?.why === 'now' && x.history[0]?.state === 'done'));
  // The morning recap over the same door: the run lands in Chief's thread, and a second run that sends nothing is a
  // failure naming why, not an ok for a call that returned.
  seedDigest();
  const digest = (await api('GET', '/api/state')).body.routines.find((x: any) => x.kind === 'digest');
  const thread = async () => (await api('GET', '/api/bots/chief')).body.messages.map((m: any) => m.text);
  const before = (await thread()).length;
  assert.equal((await api('POST', `/api/routines/${digest.id}/run`)).status, 200);
  const recap = (await thread()).slice(before);
  assert.equal(recap.length, 1, 'the recap really reached Chief');
  assert.match(recap[0], /^Good (morning|afternoon|evening)/);
  const second = await api('POST', `/api/routines/${digest.id}/run`);
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already in Chief's chat/, 'the launcher is told what really happened');
  assert.equal((await thread()).length, before + 1, 'nothing was sent the second time');
  const own = (await api('POST', '/api/routines', { bot: 'video-reel', schedule: 'every 2 hours', task: 'Tidy the screenshots folder' })).body;
  assert.equal((await api('DELETE', `/api/routines/${own.id}`)).status, 200);
  // The person's own words for a date each month: the routine keeps that date, and the card's words are the preview's.
  const bill = (await api('POST', '/api/routines', { bot: 'video-reel', schedule: 'the 1st of every month 9am', task: 'Check the monthly statement' })).body;
  assert.equal(bill.words, 'On the 1st of every month at 9:00 am');
  assert.equal(new Date(bill.next_at).getDate(), 1);
  assert.equal(new Date(bill.next_at).getHours(), 9);
  assert.ok(bill.next_at > Date.now());
  assert.equal((await api('DELETE', `/api/routines/${bill.id}`)).status, 200);
  assert.equal((await api('POST', '/api/routines', { bot: 'video-reel', schedule: 'daily 9', task: 'x' }, {})).status, 403, 'cross-site pages cannot add routines');
});

test('memory: the bot proposes a note, crewd caps and commits it, Undo reverts it', async () => {
  await ready();
  const hire = (await say('chief', `a writer please ${call('crew_recruit', { template: 'scribe', name: 'Writer Quill' })}`)).body.task;
  await done('chief', hire);
  // What Writer Quill learned about the owner lives in the owner's own folder.
  const dir = join(root, 'crew', 'people', '1');
  const notes = () => readFileSync(join(dir, 'notes', 'writer-quill.md'), 'utf8');
  const log = () => execFileSync('git', ['log', '--format=%s'], { cwd: dir }).toString().trim().split('\n');
  const learned = async () => (await api('GET', '/api/bots/writer-quill')).body.trail.filter((e: any) => e.kind === 'memory.learned');
  const remember = async (input: object) => { const t = (await say('writer-quill', `note this ${call('crew_remember', input)}`)).body.task; return done('writer-quill', t); };

  // The debrief asks for it at the end of every task.
  const first = (await say('writer-quill', 'Draft a note')).body.task;
  await done('writer-quill', first);
  // The debrief travels in the run's prompt; the engine keeps the conversation itself (its key is on the task).
  const sessionDb = openDb();
  const session = sessionDb.prepare('SELECT session FROM tasks WHERE id = ?').get(first) as any;
  sessionDb.close();
  assert.match(session.session, /^agent:m1:crewhouse:writer-quill$/, 'the run has its own session key');

  await remember({ text: 'Prefers 0.5 s transitions' });
  await remember({ text: 'Signs off with "Best"' });
  await remember({ text: 'Prefers ~0.8 s transitions', replaces: '0.5 s' });
  assert.equal(notes(), '- Prefers ~0.8 s transitions\n- Signs off with "Best"\n', 'a correction rewrites, it does not append');
  assert.match((await remember({ text: 'x', replaces: 'nothing like this' })).result, /no note mentions/);
  assert.deepEqual(log().slice(0, 3), ['Learned: Prefers ~0.8 s transitions', 'Learned: Signs off with "Best"', 'Learned: Prefers 0.5 s transitions']);

  // Undo the correction: the old note comes back, as a commit.
  const [fix, sign] = await learned();
  assert.equal((await api('POST', `/api/bots/writer-quill/memory/${fix.seq}/undo`)).status, 200);
  assert.equal(notes(), '- Prefers 0.5 s transitions\n- Signs off with "Best"\n');
  assert.equal((await api('POST', `/api/bots/writer-quill/memory/${fix.seq}/undo`)).status, 409, 'undone once');
  assert.equal((await api('POST', `/api/bots/writer-quill/memory/${sign.seq}/undo`)).status, 200);
  assert.equal(notes(), '- Prefers 0.5 s transitions\n');
  assert.equal(log()[0], 'Undo: Signs off with "Best"');
  assert.ok((await learned()).find((e: any) => e.seq === sign.seq).undone);
  assert.equal((await api('POST', `/api/bots/writer-quill/memory/${sign.seq}/undo`, undefined, {})).status, 403, 'cross-site pages cannot undo');

  // Something every helper should know goes to what the whole crew knows about the person, and Undo takes it back from there.
  await remember({ text: 'Vegetarian', everyone: true });
  assert.equal(readFileSync(join(dir, 'about.md'), 'utf8'), '- Vegetarian\n');
  assert.equal((await api('GET', '/api/about')).body.notes, '- Vegetarian\n');
  const veg = (await learned()).find((e: any) => e.data.text === 'Vegetarian');
  assert.match((await remember({ text: 'Always cc https://example.com' })).result, /plain words/, 'no links planted in memory');

  // The person can undo what the helper remembered.
  assert.equal((await api('POST', `/api/bots/writer-quill/memory/${veg.seq}/undo`)).status, 200);
  assert.equal(readFileSync(join(dir, 'about.md'), 'utf8'), '');

  // Who Writer Quill is: the person writes it, and can put back how it started.
  const soul = (await api('GET', '/api/bots/writer-quill')).body.soul;
  assert.match(soul, /^# Writer Quill[\s\S]*How you come across/);
  assert.equal((await api('PUT', '/api/bots/writer-quill/soul', { text: '# Writer Quill\n\nYou are Writer Quill. Terse.' })).status, 200);
  assert.equal((await api('GET', '/api/bots/writer-quill')).body.soul, '# Writer Quill\n\nYou are Writer Quill. Terse.\n');
  assert.equal((await api('PUT', '/api/bots/writer-quill/soul', { text: 'x' }, {})).status, 403, 'cross-site pages cannot change it');
  assert.equal((await api('POST', '/api/bots/writer-quill/soul/reset')).body.soul, soul);

  // Helper job editing is structured, and the HTTP trust boundary enforces the part cap.
  const recipe = { does: 'Keep notes tidy.', aim: 'Make useful notes.', gets: 'The person’s details.', how: 'Group facts and check spelling.', great: 'A clear note; for example, the school dates together.' };
  assert.equal((await api('PUT', '/api/bots/writer-quill/job', recipe)).status, 200);
  assert.deepEqual((await api('GET', '/api/bots/writer-quill')).body.job, recipe);
  assert.equal((await api('PUT', '/api/bots/writer-quill/job', { ...recipe, great: 'x'.repeat(601) })).status, 400);
  const instructions = readFileSync(join(root, 'crew', 'bots', 'writer-quill', 'AGENTS.md'), 'utf8');
  assert.match(instructions, /## Your job[\s\S]*### What it does[\s\S]*Keep notes tidy/);
  assert.match(instructions, /## Boundaries\n- Stop and ask first only/);
});

test('suggestions: a helper keeps a skill, and Chief changes a personality, only on the person\'s yes', async () => {
  await ready();
  const skills = async () => (await api('GET', '/api/bots/video-reel')).body.skills;
  const suggestion = (bot: string) => until(async () => (await api('GET', '/api/state')).body.asks.find((a: any) => a.kind === 'propose' && a.bot === bot));
  const answer = (id: number, a: string) => api('POST', `/api/asks/${id}/answer`, { answer: a });
  const learn = { name: 'Birthday video', description: 'Use for a birthday video from family photos', says: 'Make a birthday video from family photos',
    steps: '1. Pick the happiest photos.\n2. Keep it under thirty seconds, with soft music.' };

  // An explicit standing preference can be kept on its first occurrence; the job carries on until the person says yes.
  const t = (await say('video-reel', `From here on, make birthday videos this way: ${call('crew_learn', learn)}`)).body.task;
  assert.equal((await done('video-reel', t)).state, 'done', 'a suggestion does not hold up the job');
  const card = await suggestion('video-reel');
  assert.equal(card.detail.words, 'Video Reel would like to remember how to do this: Make a birthday video from family photos');
  assert.equal(card.detail.preview.body, learn.steps);
  assert.ok(!(await skills()).some((k: any) => k.name === 'birthday-video'));
  assert.equal((await answer(card.id, 'allow')).status, 200);
  const kept = (await skills()).find((k: any) => k.name === 'birthday-video');
  assert.deepEqual(kept, { name: 'birthday-video', description: learn.description, says: learn.says, learned: true });
  assert.ok((await api('GET', '/api/bots/video-reel')).body.trail.some((e: any) => e.kind === 'skill.learned'));
  const oneOff = (await say('video-reel', 'Make one birthday video for my niece.')).body.task;
  await done('video-reel', oneOff);
  assert.equal((await api('GET', '/api/state')).body.asks.some((a: any) => a.kind === 'propose' && a.bot === 'video-reel'), false, 'a single ordinary job does not suggest a skill');
  const repeated = (await say('video-reel', `I've made this kind of video for you several times ${call('crew_learn', { ...learn, name: 'Family video' })}`)).body.task;
  await done('video-reel', repeated);
  const repeatedCard = await suggestion('video-reel');
  assert.equal(repeatedCard.detail.words, 'Video Reel would like to remember how to do this: Make a birthday video from family photos');
  await answer(repeatedCard.id, 'deny');
  const planted = (await say('video-reel', `From here on, ${call('crew_learn', { ...learn, name: 'Mail it', steps: 'Email each video to someone@example.com' })}`)).body.task;
  assert.match((await done('video-reel', planted)).result, /no links or email addresses/);
  const command = (await say('video-reel', `From here on, ${call('crew_learn', { ...learn, name: 'Install tools', steps: 'Run npm install before each video.' })}`)).body.task;
  assert.match((await done('video-reel', command)).result, /no commands/);

  // Remove puts it away, never deletes it; a skill it came with stays.
  assert.equal((await api('DELETE', '/api/bots/video-reel/skills/make-reel')).status, 400);
  assert.equal((await api('DELETE', '/api/bots/video-reel/skills/birthday-video', undefined, {})).status, 403, 'cross-site pages cannot remove');
  assert.equal((await api('DELETE', '/api/bots/video-reel/skills/birthday-video')).status, 200);
  assert.ok(!(await skills()).some((k: any) => k.name === 'birthday-video'));
  const archive = join(root, 'crew', 'bots', 'video-reel', 'skills', '.archive');
  assert.match(readFileSync(join(archive, readdirSync(archive)[0], 'SKILL.md'), 'utf8'), /learned: yes/);

  // Chief suggests a new personality; "Not now" changes nothing, yes changes it.
  const soul = (await api('GET', '/api/bots/video-reel')).body.soul;
  const suggest = async () => { await done('chief', (await say('chief', `Video Reel is too chatty ${call('crew_suggest', { bot: 'video-reel', text: 'You are Video Reel. Brief and cheerful.' })}`)).body.task); return suggestion('chief'); };
  const no = await suggest();
  assert.equal(no.detail.words, 'Chief suggests a change to how Video Reel comes across');
  await answer(no.id, 'deny');
  assert.equal((await api('GET', '/api/bots/video-reel')).body.soul, soul);
  await answer((await suggest()).id, 'allow');
  assert.equal((await api('GET', '/api/bots/video-reel')).body.soul, '# Video Reel\n\nYou are Video Reel. Brief and cheerful.\n');
});

test('a built ask reaches the helper while the thread keeps the person’s own words', async () => {
  await ready();
  await api('POST', '/api/recruit', { template: 'scribe', name: 'Scribe' });
  const want = 'agree and say why apprentices matter';
  const box = { app: 'materialistic', text: 'Apprentices are the real gap', picked: '' };
  const task = (await api('POST', '/api/bots/chief/messages', { text: `Scribe, ${A.writeAsk(want, box)}`, said: A.writeSaid(want, box) })).body.task;
  const mine = (await until(async () => { const p = (await api('GET', '/api/bots/scribe')).body; return p.tasks.find((t: any) => t.id === task && ['done', 'failed'].includes(t.state)) && p; }));
  const thread = (await api('GET', '/api/bots/chief')).body;
  assert.ok(thread.messages.some((m: any) => m.author === 'person' && m.text.startsWith(`${want}\nApprentices are the real gap`)), 'Chief’s thread shows their own words, never our ask');
  assert.match(mine.tasks.find((t: any) => t.id === task).body, /short labelled notes/, 'the helper still reads the whole ask');
  // The stub's echo is not an answer, so the thread, Made in this chat and the rail cannot disagree about a job with none.
  assert.deepEqual(A.lines(mine, 'scribe').filter((l) => l.from === 'them'), [], 'no reply to read');
  assert.deepEqual(A.things({ tasks: mine.tasks.filter((t: any) => t.bot === 'scribe') }), [], 'nothing was made');
  const state = (await api('GET', '/api/state')).body;
  const view = A.office({ ...state, tasks: mine.tasks });
  assert.equal(A.statusOf(view.crew.find((c) => c.id === 'scribe')!, view).word, 'Free', 'the rail never says Done for a job with nothing to show');
});

test('room API: a message starts and rejoins the person’s room job', async () => {
  await ready();
  const first = (await api('POST', '/api/bots/chief/messages', { text: 'Video Reel, A room job', room: true })).body.task;
  await done('video-reel', first);
  const second = (await api('POST', '/api/bots/chief/messages', { text: 'Video Reel, More on that room job', room: true })).body.task;
  await done('video-reel', second);
  const room = (await api('GET', '/api/room')).body;
  assert.ok(room.lines.some((l: any) => l.text === 'Video Reel, More on that room job'));
  assert.equal(room.lines.filter((l: any) => l.text === 'Video Reel, A room job').length, 1);
  const db = openDb();
  assert.equal(db.prepare('SELECT root FROM tasks WHERE id = ?').get(second)?.root, first);
  db.close();
});

test('the person talks directly to a helper: the helper owns the task and Chief gets no synthetic request', async () => {
  await ready();
  await api('POST', '/api/recruit', { template: 'reel', name: 'Reel' });
  const text = 'save [tool crew_write {"path":"files/via-chief.txt","content":"x"}]';
  const posted = (await api('POST', '/api/bots/reel/messages', { text, move: 'direct-chat-test' })).body.task;
  await done('reel', posted);
  const job = (await api('GET', '/api/bots/reel')).body.tasks.find((t: any) => t.id === posted);
  assert.equal(job.origin, 'person', 'the helper task originates with the person');
  assert.ok(existsSync(join(root, 'crew', 'bots', 'reel', 'files', 'via-chief.txt')), 'and the helper did the job');
  assert.ok(!(await api('GET', '/api/bots/chief')).body.messages.some((m: any) => m.author === 'person' && m.text.includes(text)), 'Chief gets no synthetic request');
  const again = (await api('POST', '/api/bots/reel/messages', { text, move: 'direct-chat-test' })).body.task;
  assert.equal(again, posted, 'reconnect retry returns the original task');
});

test('the person’s bot page, events and live activity keep their delivered work', async () => {
  await ready();
  await api('POST', '/api/recruit', { template: 'reel', name: 'Reel' });
  const db = openDb();
  try {
    const id = Number(db.prepare("INSERT INTO tasks (bot, title, body, result, state, member) VALUES ('reel', 'my work', 'my request', 'my result', 'done', 1)").run().lastInsertRowid);
    for (const [kind, data] of [['task.done', { task: id, title: 'my activity' }], ['file.delivered', { task: id, path: 'files/mine.txt', note: 'my file' }]] as const)
      db.prepare('INSERT INTO events (at, kind, bot, data) VALUES (?, ?, ?, ?)').run(Date.now(), kind, 'reel', JSON.stringify(data));
    writeFileSync(join(root, 'crew', 'bots', 'reel', 'files', 'mine.txt'), 'my words');
    const page = (await api('GET', '/api/bots/reel')).body;
    assert.ok(page.tasks.some((t: any) => t.id === id));
    assert.ok(page.files.some((f: any) => f.path === 'mine.txt'));
    assert.ok(JSON.stringify(page.trail).includes('my activity'));
    assert.ok(JSON.stringify((await api('GET', '/api/state')).body.events).includes('my activity'));
    assert.ok(JSON.stringify((await api('GET', '/api/events')).body).includes('my activity'));
    const socket = personWs();
    const received: any[] = [];
    socket.on('message', (raw) => received.push(JSON.parse(String(raw))));
    try {
      await new Promise<void>((resolve) => socket.once('open', () => resolve()));
      await api('PUT', '/api/bots/reel/notes', { text: 'my live notes' });
      const edited = await until(async () => received.find((e) => e.kind === 'memory.edited'));
      assert.equal(edited.data.member, undefined);
      await api('PUT', '/api/accounts/1/chatgpt/model', { model: 'strong-1' });
      const models = await until(async () => received.find((e) => e.kind === 'bot.models'));
      assert.deepEqual(models.data, { by: 'person' }, 'model choices emit only person-facing metadata');
      const state = (await api('GET', '/api/state')).body;
      assert.ok(state.events.some((e: any) => e.seq === models.seq));
      assert.ok(state.events.length <= 80, 'snapshot keeps its bounded event window');
      const history = (await api('GET', `/api/events?after=${edited.seq}`)).body;
      assert.ok(history.some((e: any) => e.seq === models.seq));
      assert.ok(history.every((e: any) => e.seq > edited.seq), 'event paging keeps its after cursor');
      const trail = (await api('GET', '/api/bots/reel')).body.trail;
      assert.ok(trail.some((e: any) => e.kind === 'task.done') && trail.some((e: any) => e.kind === 'file.delivered'), 'trail retains multiple events');
    } finally { socket.close(); }
  } finally { db.close(); }
});

test('Forget this file: the person takes a document back out of the helper\'s folder over the API', async () => {
  await ready();
  await api('POST', '/api/recruit', { template: 'reel', name: 'Reel' });
  const pdf = { type: 'application/pdf', data: Buffer.from('%PDF-1.4 a receipt').toString('base64'), name: 'statement.pdf' };
  const task = (await api('POST', '/api/bots/chief/messages', { text: 'Reel, here is a file.', files: [pdf] })).body.task;
  await done('reel', task);
  const rel = `files/inbox/${task}-1.pdf`, full = join(root, 'crew', 'bots', 'reel', rel);
  assert.ok(existsSync(full), 'the document the person sent is in the helper\'s folder');
  const card = async () => A.lines((await api('GET', '/api/bots/reel')).body, 'reel', (await api('GET', '/api/state')).body).flatMap((l) => l.files);
  assert.deepEqual((await card()).map((f: any) => f.name), ['statement.pdf'], 'and it shows as a card in the chat');
  const gone = await api('POST', '/api/bots/reel/forget-file', { path: rel });
  assert.equal(gone.status, 200);
  assert.ok(!existsSync(full), 'the file is out of the helper\'s folder');
  assert.deepEqual(await card(), [], 'and the chat keeps no card for it');
  assert.ok((await api('GET', '/api/bots/reel')).body.messages.some((m: any) => m.author === 'system' && /^Removed \S+ from Reel's folder\.$/.test(m.text)), 'the person is told, in plain words');
  assert.ok((await api('GET', '/api/state')).body.forgotten.some((f: any) => f.path === rel), 'crewd records it as gone');
  assert.ok((await api('GET', '/api/bots/reel')).body.messages.some((m: any) => /\(in files\/inbox/.test(m.text)), 'the person\'s own words are untouched');
  assert.equal((await api('POST', '/api/bots/reel/forget-file', { path: rel })).status, 400, 'and a second try says it is not there');
  assert.equal((await api('POST', '/api/bots/reel/forget-file', { path: 'soul.md' })).status, 400, 'only a file the helper holds');
  assert.equal((await api('POST', '/api/bots/reel/forget-file', { path: '../state/crew.db' })).status, 400, 'never outside its folder');
  const noKey = await fetch(`${base}/api/bots/reel/forget-file`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-crewhouse': '1' }, body: JSON.stringify({ path: rel }) });
  assert.equal(noKey.status, 403, 'the person\'s authority is the only way to forget a file');
});

test('raw /files/ only opens delivered files, and only for the person', async () => {
  await ready();
  await api('POST', '/api/recruit', { template: 'reel', name: 'Reel' });
  const db = openDb();
  const id = Number(db.prepare("INSERT INTO tasks (bot, title, body, result, state, member) VALUES ('reel', 'owner file', 'body', 'result', 'done', 1)").run().lastInsertRowid);
  db.prepare('INSERT INTO events (at, kind, bot, data) VALUES (?, ?, ?, ?)').run(Date.now(), 'file.delivered', 'reel', JSON.stringify({ task: id, path: 'files/owner-file.txt', note: 'private' }));
  db.close();
  mkdirSync(join(root, 'crew', 'bots', 'reel', 'files'), { recursive: true });
  writeFileSync(join(root, 'crew', 'bots', 'reel', 'files', 'owner-file.txt'), 'owner words');
  mkdirSync(join(root, 'crew', 'bots', 'reel', 'work'), { recursive: true });
  writeFileSync(join(root, 'crew', 'bots', 'reel', 'work', 'secret.webm'), 'raw take bytes');
  // A helper's shell shares this loopback: without the person's authority a delivered file stays shut.
  const person = { authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8')}` };
  for (const headers of [{}, person, { 'x-crewhouse': '1' }, { cookie: `crewhouse-files=${'0'.repeat(64)}` }] as Record<string, string>[]) {
    const res = await fetch(`${base}/files/reel/owner-file.txt`, { headers });
    assert.equal(res.status, 403, 'a loopback caller without the browser cookie is refused');
    assert.ok(!(await res.text()).includes('owner words'), 'and reads nothing');
  }
  const unsigned = await fetch(`${base}/api/files/session`, { method: 'POST', headers: { 'x-crewhouse': '1' } });
  assert.equal(unsigned.status, 403, 'minting the browser cookie needs the person key');
  assert.equal(unsigned.headers.get('set-cookie'), null);
  const minted = await fetch(`${base}/api/files/session`, { method: 'POST', headers: { ...person, 'x-crewhouse': '1' } });
  const set = minted.headers.get('set-cookie') ?? '';
  assert.ok(set.startsWith('crewhouse-files=') && /HttpOnly/.test(set) && /SameSite=Strict/.test(set) && /Path=\/files/.test(set), 'the cookie is HttpOnly, strict, for /files only');
  assert.ok(!set.includes(person.authorization.slice('Bearer '.length)), 'and never carries the key itself');
  const cookie = { cookie: set.split(';')[0] };
  assert.equal(await (await fetch(`${base}/files/reel/owner-file.txt`, { headers: cookie })).text(), 'owner words', 'the owner keeps the trail');
  const range = await fetch(`${base}/files/reel/owner-file.txt`, { headers: { ...cookie, range: 'bytes=0-4' } });
  assert.equal(range.status, 206, 'a video can seek with the cookie alone');
  assert.equal(await range.text(), 'owner');
  for (const sneak of ['..%2Fwork%2Fsecret.webm', '..%252Fwork%252Fsecret.webm', '../work/secret.webm', '..%2F..%2Fcrew%2Fbots%2Freel%2Fwork%2Fsecret.webm']) {
    const res = await fetch(`${base}/files/reel/${sneak}`, { headers: cookie });
    assert.notEqual(res.status, 200, `${sneak} never serves`);
    assert.ok(!(await res.text()).includes('raw take'), `${sneak} leaks nothing`);
  }
});

test('one chat end to end on the stub: excel request, one question, bookings, then the xlsx card and its roles', async () => {
  const { db, crew, done } = lab();
  crew.onboard('sir');
  const chiefSays = () => db.all("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' ORDER BY id").map((m: any) => m.text);
  // A small but real workbook spec: the follow-up run builds it for the card.
  const sheets = [{ name: 'Bookings', columns: [{ header: 'Guest' }, { header: 'Status', options: ['Booked', 'Checked in'] }], rows: [['Amina Khan', 'Booked']] }];
  const marker = call('crew_workbook', { name: 'Reception log', sheets });

  // The request names a workbook, so it goes straight to the silently hired Writer Will; "ask permission" holds the turn.
  const first = (await crew.post('chief', 'make me an Excel for reception, ask permission before you build anything'))!.task;
  assert.equal(task(db, first).bot, 'writer-will');
  assert.equal(task(db, first).origin, 'chief');
  await release(crew, 'writer-will', `${marker} Visitor log, bookings, or something else?`);
  await settled(db, first);

  // The question reaches Chief's thread word for word, ending in "?", carrying its task but no card.
  const question = chiefSays().at(-1)!;
  assert.ok(question.endsWith(' Visitor log, bookings, or something else?') && !question.includes('asks:'), 'in the helper\'s own words, no "asks:" prefix');
  assert.ok(question.endsWith('?'));
  assert.equal((await crew.botPage('chief')).messages.find((m: any) => m.text === question)?.helper, 'writer-will', 'the app shows Writer Will said it');

  // Posting the answer builds the workbook, and its card lands in Chief's thread.
  const second = (await crew.post('chief', 'bookings'))!.task;
  assert.equal(task(db, second).bot, 'writer-will');
  await release(crew, 'writer-will', 'The reception workbook is ready.');
  await settled(db, second);
  const page = await crew.botPage('chief');
  const card = page.messages.find((m: any) => m.task_id === second)?.files.find((f: any) => f.path.endsWith('.xlsx'));
  assert.ok(card, "the finished spreadsheet's card is in Chief's thread");

  // The preview behind the card carries row numbers and cell roles, in plain words.
  const view = await crew.workbookView('writer-will', card.path) as any;
  assert.deepEqual(view.sheets.map((s: any) => s.name), ['Bookings']);
  assert.ok(view.sheets[0].roles.flat().includes('head'), 'header cells read as headers');
  assert.ok(view.sheets[0].roles.flat().includes('in'), 'dropdown cells read as inputs');
  assert.equal(view.sheets[0].nums.length, view.sheets[0].rows.length, 'every row has a number');
  done();
});

// ch-ux-memory-one-section: Chief remembering with crew_profile records the facts it added on the trail, so the
// chat can announce them once as "Saved: …" with an Undo, and the next job reads the saved record.
test('chief remembers with crew_profile: the save lands on the trail and in the record', async () => {
  await ready();
  const t = (await say('chief', `note this ${call('crew_profile', { text: 'I run Morning Loaf bakery. My voice is warm and plain.' })}`)).body.task;
  await done('chief', t);
  const page = (await api('GET', '/api/bots/chief')).body;
  const edit = page.trail.find((e: any) => e.kind === 'profile.edited' && e.data?.added?.length);
  assert.ok(edit, 'the save is on the trail, so the chat can show it');
  assert.deepEqual(edit.data.added, ['I run Morning Loaf bakery.', 'My voice is warm and plain.']);
  assert.equal((await api('GET', '/api/profile')).body.text.trim(), 'I run Morning Loaf bakery. My voice is warm and plain.');
  // The adapter turns the trail into exactly one "Saved:" line per added fact, each with a way to take it back.
  const saved = A.savedNotes(page.trail, []).filter((l: any) => l.text.startsWith('Saved:'));
  assert.deepEqual(saved.map((l: any) => l.text), ['Saved: I run Morning Loaf bakery.', 'Saved: My voice is warm and plain.']);
  assert.deepEqual(saved.map((l: any) => l.saved), ['I run Morning Loaf bakery.', 'My voice is warm and plain.']);
  // Undo drops the sentence from the record; the "Saved:" line is the record, not history, so it goes with it and never returns.
  await api('PUT', '/api/profile', { text: 'I run Morning Loaf bakery.' });
  const kept = A.savedNotes(page.trail, [], 'I run Morning Loaf bakery.').filter((l: any) => l.text.startsWith('Saved:'));
  assert.deepEqual(kept.map((l: any) => l.text), ['Saved: I run Morning Loaf bakery.']);
});
