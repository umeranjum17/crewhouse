// End to end through the real daemon with the stub runner: no CLI, no model quota.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-test-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const daemon = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
  env: { ...process.env, CREWHOUSE_RUNNER: 'stub', CREWHOUSE_PORT: String(port), CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew') },
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
  assert.match(page.messages[0].text, /I'm Chief/);
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
  assert.match(readFileSync(join(dir, '.crewhouse/person.md'), 'utf8'), /Sir/);
  assert.equal((await tool('reel', 'recruit', { template: 'scout' })).status, 403, 'only Chief recruits');

  // Chief hands Reel a task; it runs and reports back in Chief's thread.
  const t = (await tool('chief', 'assign', { bot: 'reel', text: 'Make a 10 second demo' })).body.task;
  await until(async () => (await api('GET', '/api/bots/reel')).body.tasks.find((x: any) => x.id === t && x.state === 'done'));
  page = (await api('GET', '/api/bots/chief')).body;
  assert.ok(page.messages.some((m: any) => m.author === 'system' && m.text.includes(`Reel finished task #${t}`)));

  // Tool grants become the CLI's own allow list; credential folders are always denied.
  const settings = JSON.parse(readFileSync(join(dir, '.claude/settings.local.json'), 'utf8'));
  assert.ok(settings.permissions.allow.includes('Bash(crew *)'));
  assert.ok(settings.permissions.deny.includes('Read(~/.claude/**)'));
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'crew hook stop');
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

  // Delivery is confined to the bot's folder; memory is capped.
  assert.equal((await tool('reel', 'deliver', { path: '../../../etc/passwd' })).status, 400);
  assert.equal((await tool('reel', 'remember', { text: 'Likes 0.8 s transitions' })).status, 200);
  let refused = false;
  for (let i = 0; i < 40 && !refused; i++) refused = (await tool('reel', 'remember', { text: 'x'.repeat(100) })).status !== 200;
  assert.ok(refused, 'notes cap enforced');
  assert.ok(readFileSync(join(dir, 'notes.md'), 'utf8').length <= 2500);
});
