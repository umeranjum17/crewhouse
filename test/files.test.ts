import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, after } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileTool } from '../src/files.ts';
import { temp } from './tmp.ts';

test('bot file tools write where the gate allowed, and never travel through a symlink', () => {
  const bot = mkdtempSync(join(tmpdir(), 'crewhouse-files-'));
  const outside = mkdtempSync(join(tmpdir(), 'crewhouse-outside-'));
  try {
    writeFileSync(join(outside, 'secret'), 'the person said yes');
    symlinkSync(outside, join(bot, 'escape'));
    // A symlink in the bot's folder is never followed, whatever it points at.
    assert.throws(() => fileTool(bot, 'crew_read', { path: 'escape/secret' }), /symlink|ENOTDIR|ELOOP/);
    assert.throws(() => fileTool(bot, 'crew_write', { path: 'escape/new', content: 'oops' }), /symlink|ENOTDIR|ELOOP/);
    // A path outside the folder works: the gate asked for it and the person allowed it (src/policy.ts `files`).
    assert.match(fileTool(bot, 'crew_write', { path: join(outside, 'allowed.txt'), content: 'hello' }), /Wrote/);
    assert.equal(readFileSync(join(outside, 'allowed.txt'), 'utf8'), 'hello');
    assert.match(fileTool(bot, 'crew_write', { path: 'files/result.txt', content: 'safe' }), /Wrote/);
    assert.equal(readFileSync(join(bot, 'files/result.txt'), 'utf8'), 'safe');
    assert.equal(fileTool(bot, 'crew_edit', { path: 'files/result.txt', oldText: 'safe', newText: 'done' }), 'Edited files/result.txt');
    assert.equal(fileTool(bot, 'crew_read', { path: 'files/result.txt' }), 'done');
  } finally { rmSync(bot, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

// The spreadsheet preview over HTTP: plain words only for a delivered file.
const root = temp('crewhouse-files-http');
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
const finished = (bot: string, task: number) => until(async () => (await api('GET', `/api/bots/${bot}`)).body.tasks.find((x: any) => x.id === task && ['done', 'failed'].includes(x.state)));
const ready = () => until(async () => (await fetch(`${base}/api/state`).catch(() => null))?.ok);
// Whatever crewd sends, nothing a person reads may show a path, a command, an engine name or a percentage.
const FORBIDDEN = /fc-list|2>&1|\| ?head|\bBash\b|claude|anthropic|codex|sonnet|haiku|opus|gpt-|mcp__|\/home\/|~\/|files\/|\.md\b|\bpane\b|terminal|\d+ ?%|a command|ffmpeg|magick|\bls -la\b|```|`|\besc\b|529/i;

test('GET /api/workbook is plain words only for a delivered file', async () => {
  await ready();
  await say('chief', 'Sir');
  await api('POST', '/api/recruit', { template: 'scribe', name: 'Scribe' });
  const spec = { name: 'Reception preview', sheets: [
    { name: 'Bookings', columns: [{ header: 'Guest' }, { header: 'Status', options: ['Booked', 'Checked in'] }], rows: [['Amina Khan', 'Booked']] },
  ] };
  const t = (await say('scribe', `please build this now ${call('crew_workbook', spec)}`)).body.task;
  const rel = JSON.parse((await finished('scribe', t)).result.match(/\{.*\}/s)[0]).path as string;
  assert.match(rel, /^files\/[\w./-]+\.xlsx$/, 'the run reports the finished spreadsheet');

  const view = await api('GET', `/api/workbook?bot=scribe&path=${encodeURIComponent(rel)}`);
  assert.equal(view.status, 200, 'the person reads the delivered preview');
  assert.deepEqual(view.body.sheets.map((s: any) => s.name), ['Bookings']);
  assert.ok(view.body.sheets[0].roles.flat().includes('head'), 'header cells read as headers');
  assert.ok(view.body.sheets[0].roles.flat().includes('in'), 'dropdown cells read as inputs');
  assert.equal(view.body.sheets[0].nums.length, view.body.sheets[0].rows.length, 'every row has a number');
  assert.doesNotMatch(JSON.stringify(view.body), FORBIDDEN, 'the preview is words and counts, never machinery');


});
