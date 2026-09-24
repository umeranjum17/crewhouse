// End to end through the real daemon with the stub runner: no CLI, no model quota.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-test-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const daemon = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
  env: { ...process.env, CREWHOUSE_RUNNER: 'stub', CREWHOUSE_HOLD_MS: '1500', CREWHOUSE_PORT: String(port), CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
after(() => daemon.kill());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = { 'x-crewhouse': '1' }) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
const token = (bot: string) => (new DatabaseSync(join(root, 'state', 'crew.db')).prepare('SELECT token FROM bots WHERE id = ?').get(bot) as any).token;
const tool = (bot: string, cmd: string, body: unknown) => api('POST', `/crew/${cmd}`, body, { 'x-crew-token': token(bot) });
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 5000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = await fn(); if (v) return v; }
  throw new Error('timed out');
}

test('chief onboarding, recruit, assign, asks, memory', async () => {
  await until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);

  // Chief greets first and asks how to address the person; the first reply is stored as the address.
  let page = (await api('GET', '/api/bots/chief')).body;
  assert.match(page.messages[0].text, /I am Chief, of the Crewhouse/);
  assert.match(page.messages[0].text, /how would you like me to address you/);
  assert.doesNotMatch(page.messages[0].text, /Master|aye/i);
  await api('POST', '/api/bots/chief/messages', { text: 'Sir' });
  assert.equal((await api('GET', '/api/state')).body.person.address, 'Sir');

  // Cross-site writes are refused.
  assert.equal((await api('POST', '/api/recruit', { template: 'reel' }, {})).status, 403);

  // A normal message to Chief is a Chief turn on the runner.
  await api('POST', '/api/bots/chief/messages', { text: 'I need a demo video' });
  await until(async () => (await api('GET', '/api/bots/chief')).body.messages.find((m: any) => m.text.startsWith('stub chief')));

  // Chief recruits Reel from the template; the folder is the bot.
  const rec = await tool('chief', 'recruit', { template: 'reel', name: 'Reel' });
  assert.equal(rec.body.recruited.id, 'reel');
  const dir = join(root, 'crew', 'bots', 'reel');
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'notes.md', 'skills/make-reel/SKILL.md', '.claude/skills/make-reel/SKILL.md', '.crewhouse/person.md']) assert.ok(existsSync(join(dir, f)), f);
  assert.match(readFileSync(join(dir, '.crewhouse/person.md'), 'utf8'), /Address the person as "sir"/);
  assert.equal((await tool('reel', 'recruit', { template: 'scout' })).status, 403, 'only Chief recruits');

  // Chief hands Reel a task; it runs and reports back in Chief's thread.
  const t = (await tool('chief', 'assign', { bot: 'reel', text: 'Make a 10 second demo' })).body.task;
  await until(async () => (await api('GET', '/api/bots/reel')).body.tasks.find((x: any) => x.id === t && x.state === 'done'));
  page = (await api('GET', '/api/bots/chief')).body;
  assert.ok(page.messages.some((m: any) => m.author === 'system' && m.text.includes(`Reel has finished task #${t}`)));

  // Tool grants become the CLI's own allow list; credential folders are always denied.
  const settings = JSON.parse(readFileSync(join(dir, '.claude/settings.local.json'), 'utf8'));
  assert.ok(settings.permissions.allow.includes('Bash(crew *)'));
  assert.ok(settings.permissions.deny.includes('Read(~/.claude/**)'));
  assert.match(settings.hooks.Stop[0].hooks[0].command, /bin\/crew" hook stop$/);
  const tools = (await api('GET', '/api/bots/reel')).body.tools;
  assert.ok(tools.find((x: any) => x.id === 'media').granted);
  await api('PUT', '/api/bots/reel/tools', { tools: ['files', 'github'] });
  assert.deepEqual((await api('GET', '/api/bots/reel')).body.tools.filter((x: any) => x.granted).map((x: any) => x.id).sort(), ['crew', 'files', 'github']);
  await api('PUT', '/api/bots/reel/tools', { tools: ['files', 'media', 'images'] });

  // A blocked CLI becomes a "needs you" item with the terminal text; answering sends keys and resumes.
  await api('POST', '/api/bots/reel/messages', { text: 'this needs approval' });
  const ask = await until(async () => (await api('GET', '/api/state')).body.asks.find((a: any) => a.kind === 'blocked'));
  assert.match(ask.detail.pane, /Do you want to proceed/);
  assert.equal((await api('POST', `/api/asks/${ask.id}/answer`, { keys: ['1'] })).status, 200);
  await until(async () => (await api('GET', '/api/bots/reel')).body.messages.find((m: any) => m.text.includes('continued after your answer')));

  // The permission hook holds the tool call until the person answers in the app.
  const held = tool('reel', 'hook/permission', { tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' } });
  const perm = await until(async () => (await api('GET', '/api/state')).body.asks.find((a: any) => a.kind === 'permission'));
  assert.equal(perm.detail.summary, 'rm -rf /tmp/x');
  await api('POST', `/api/asks/${perm.id}/answer`, { answer: 'deny' });
  assert.equal((await held).body.hookSpecificOutput.decision.behavior, 'deny');

  // Past the hold, the hook denies with "wait" and the ask stays open; a later "allow" resumes the same session.
  const { task: pt } = (await api('POST', '/api/bots/reel/messages', { text: 'ask permission to copy' })).body;
  await until(async () => (await api('GET', '/api/bots/reel')).body.tasks.find((x: any) => x.id === pt && x.state === 'working'));
  const late = await tool('reel', 'hook/permission', { tool_name: 'Bash', tool_input: { command: 'cp a b' } });
  assert.equal(late.body.hookSpecificOutput.decision.behavior, 'deny');
  assert.match(late.body.hookSpecificOutput.decision.message, /hasn't answered/);
  await tool('reel', 'hook/stop', { last_assistant_message: 'Waiting for permission to copy.' });
  const parkedTask = (await api('GET', '/api/bots/reel')).body.tasks.find((x: any) => x.id === pt);
  assert.equal(parkedTask.state, 'needs_you', 'a turn that ends on a parked ask does not finish the task');
  const parked = (await api('GET', '/api/state')).body.asks.find((a: any) => a.kind === 'permission');
  assert.ok(parked, 'parked ask stays open');
  await api('POST', `/api/asks/${parked.id}/answer`, { answer: 'allow' });
  await until(async () => (await api('GET', '/api/bots/reel')).body.tasks.find((x: any) => x.id === pt && x.state === 'done'));
  const again = await tool('reel', 'hook/permission', { tool_name: 'Bash', tool_input: { command: 'cp a b' } });
  assert.equal(again.body.hookSpecificOutput.decision.behavior, 'allow', 'the retried call goes through once');

  // Statusline limits are recorded; tool activity reaches the feed.
  const line = await tool('reel', 'hook/statusline', { rate_limits: { five_hour: { used_percentage: 43, resets_at: 1790280000 }, seven_day: { used_percentage: 5 } } });
  assert.equal(line.body.text, 'Crewhouse · Reel · 5h 43%');
  assert.equal((await api('GET', '/api/state')).body.limits.claude.fiveHour.used, 43);
  await tool('reel', 'hook/tool', { tool_name: 'Bash', tool_input: { command: 'ffmpeg -y -i a.png out.mp4' } });
  assert.ok((await api('GET', '/api/state')).body.events.some((e: any) => e.kind === 'run.tool' && e.data.summary.startsWith('ffmpeg')));

  // The browser's page comes from its own tool results; acting on a payment page asks first, reading does not.
  await tool('reel', 'hook/tool', { tool_name: 'mcp__browser__browser_navigate', tool_input: { url: 'https://shop.example/' },
    tool_response: [{ type: 'text', text: '### Page\n- Page URL: https://shop.example/checkout\n- Page Title: Pay' }] });
  assert.deepEqual((await tool('reel', 'hook/pretool', { tool_name: 'mcp__browser__browser_snapshot', tool_input: {} })).body, {});
  const click = tool('reel', 'hook/pretool', { tool_name: 'mcp__browser__browser_click', tool_input: { ref: 'e12' } });
  const pay = await until(async () => (await api('GET', '/api/state')).body.asks.find((a: any) => a.kind === 'permission'));
  assert.match(pay.detail.summary, /click on a checkout or payment page \(shop\.example\): https:\/\/shop\.example\/checkout/);
  await api('POST', `/api/asks/${pay.id}/answer`, { answer: 'allow' });
  assert.equal((await click).body.hookSpecificOutput.permissionDecision, 'allow');

  // Delivery is confined to the bot's folder; memory is capped.
  assert.equal((await tool('reel', 'deliver', { path: '../../../etc/passwd' })).status, 400);
  assert.equal((await tool('reel', 'remember', { text: 'Likes 0.8 s transitions' })).status, 200);
  let refused = false;
  for (let i = 0; i < 40 && !refused; i++) refused = (await tool('reel', 'remember', { text: 'x'.repeat(100) })).status !== 200;
  assert.ok(refused, 'notes cap enforced');
  assert.ok(readFileSync(join(dir, 'notes.md'), 'utf8').length <= 2500);
});

test('screen: take over and give back through the API; watching needs the Computer grant', async () => {
  await until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
  assert.equal((await api('POST', '/api/bots/reel/takeover')).status, 200);
  assert.equal((await api('GET', '/api/state')).body.bots.find((b: any) => b.id === 'reel').controls, 'person');
  assert.equal((await tool('reel', 'hook/pretool', { tool_name: 'Bash' })).body.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal((await api('POST', '/api/bots/reel/giveback', { note: 'signed in' })).status, 200);
  assert.deepEqual((await tool('reel', 'hook/pretool', { tool_name: 'Bash' })).body, {});
  assert.equal((await api('POST', '/api/bots/reel/giveback', {})).status, 409);
  assert.equal((await api('POST', '/api/bots/reel/takeover', undefined, {})).status, 403, 'cross-site pages cannot take over');

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
