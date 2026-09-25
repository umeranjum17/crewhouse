// A restart is a non-event: kill crewd mid-run, start it again, and the task carries on in its own session. Stub model, no quota.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type AddressInfo } from 'node:net';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-restart-'));
// A port the OS says is free, not a random guess that another run may hold.
const port = await new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: String(port), CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') };
let daemon: ChildProcess;
const start = () => { daemon = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], { env, stdio: ['ignore', 'ignore', 'inherit'] }); };
after(() => daemon.kill());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, path: string, body?: unknown) =>
  (await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined })).json();
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 10_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = await fn().catch(() => undefined); if (v) return v; }
  throw new Error('timed out');
}

test('crewd killed mid-run: the task resumes in the same conversation and finishes', async () => {
  start();
  await until(async () => (await fetch(`${base}/api/state`)).ok);
  await api('POST', '/api/bots/chief/messages', { text: 'Sir' });
  await api('POST', '/api/recruit', { template: 'reel', name: 'Reel' });
  // The stub model reports progress, then holds the turn ("ask permission") as a long render would.
  const { task } = await api('POST', '/api/bots/reel/messages', { text: 'ask permission to render [tool crew_report {"text":"Rendered the intro"}]' });
  await until(async () => (await api('GET', '/api/bots/reel')).trail.find((e: any) => e.kind === 'task.progress'));

  daemon.kill('SIGKILL');
  await new Promise((r) => daemon.once('exit', r));
  start();

  const page = await until(async () => { const p = await api('GET', '/api/bots/reel'); return p.tasks.find((t: any) => t.id === task && t.state === 'done') && p; });
  assert.ok(page.trail.some((e: any) => e.kind === 'task.progress' && e.data.text === 'Rendered the intro'));
  assert.ok(page.trail.some((e: any) => e.kind === 'run.resumed'), 'picked up where it was');
  const state = await api('GET', '/api/state');
  assert.ok(state.events.some((e: any) => e.kind === 'system.recovered' && e.data.resumed === 1));
  const { DatabaseSync } = await import('node:sqlite');
  const file = (new DatabaseSync(join(root, 'state', 'crew.db')).prepare('SELECT session FROM tasks WHERE id = ?').get(task) as any).session;
  const log = readFileSync(file, 'utf8');
  assert.ok(log.indexOf('ask permission to render') < log.indexOf('Crewhouse restarted. Continue task'), 'one conversation, continued');
});
