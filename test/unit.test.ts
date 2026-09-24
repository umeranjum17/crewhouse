// Unit checks for the deterministic half: store, queue, approvals, tool grants, memory. No CLI, no quota.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CREWHOUSE_HOLD_MS = '300';
const { Store } = await import('../src/db.ts');
const { Crew } = await import('../src/crew.ts');
const { StubRunner } = await import('../src/runner.ts');
const disk = await import('../src/bots.ts');
const { loadConfig } = await import('../src/config.ts');

function setup(maxConcurrent = 3) {
  const root = mkdtempSync(join(tmpdir(), 'crewhouse-unit-'));
  const cfg = { ...loadConfig(), stateDir: join(root, 'state'), crewDir: join(root, 'crew'), maxConcurrent, runner: 'stub' as const };
  const db = new Store(cfg.stateDir);
  const runner = new StubRunner();
  const crew = new Crew(cfg, db, runner, 'http://127.0.0.1:1');
  runner.onTurn = (bot, reply) => crew.finish(bot, reply);
  crew.init();
  let closed = false;
  const done = () => { if (!closed) { closed = true; crew.stop(); db.close(); } };
  after(done); // a failed assertion must not leave the watch loop running
  return { root, cfg, db, runner, crew, done };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const task = (db: any, id: number) => db.get('SELECT * FROM tasks WHERE id = ?', id);

test('store: a failed transaction leaves nothing behind; events fan out after commit', async () => {
  const { db, done } = setup();
  const seen: string[] = [];
  db.onEvent((e) => seen.push(e.kind));
  assert.throws(() => db.tx(() => { db.event('x.one', null); throw new Error('boom'); }));
  assert.equal(db.all("SELECT * FROM events WHERE kind = 'x.one'").length, 0);
  const e = db.event('x.two', null, { a: 1 });
  await sleep(0);
  assert.ok(seen.includes('x.two'));
  assert.deepEqual(db.events(e.seq - 1).map((x) => x.data), [{ a: 1 }]);
  done();
});

test('queue: one task at a time per bot, and a global cap across bots', async () => {
  const { db, crew, runner, done } = setup(1);
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  crew.recruit('scout', 'Scout', 'person');
  const a = crew.assign('reel', 'ask permission first', 'chief').task; // the stub keeps this one working
  const b = crew.assign('reel', 'second job', 'chief').task;
  const c = crew.assign('scout', 'look something up', 'chief').task;
  await sleep(100);
  assert.equal(task(db, a).state, 'working');
  assert.equal(task(db, b).state, 'queued', 'same bot waits its turn');
  assert.equal(task(db, c).state, 'queued', 'global cap of 1 holds the other bot');
  runner.complete('reel', 'done with the first');
  await sleep(300);
  assert.equal(task(db, a).state, 'done');
  assert.equal(task(db, b).state, 'done', 'next task for the bot ran');
  assert.equal(task(db, c).state, 'done', 'then the other bot');
  done();
});

test('approvals: held answer allows; no answer denies with "wait" and parks the task', async () => {
  const { db, crew, runner, done } = setup();
  crew.onboard("ma'am");
  crew.recruit('reel', 'Reel', 'person');
  const t = crew.assign('reel', 'ask permission to write', 'chief').task;
  await sleep(100);
  const held = crew.permission('reel', { tool_name: 'Write', tool_input: { file_path: '/elsewhere/x.txt' } });
  await sleep(20);
  const ask = db.get("SELECT * FROM asks WHERE state = 'open'")!;
  assert.equal(task(db, t).state, 'needs_you');
  await crew.answer(ask.id, { answer: 'allow' });
  assert.deepEqual(await held, { behavior: 'allow' });
  assert.equal(task(db, t).state, 'working');

  const late = await crew.permission('reel', { tool_name: 'Bash', tool_input: { command: 'rm -r /tmp/x' } });
  assert.equal(late.behavior, 'deny');
  assert.match(late.message!, /hasn't answered/);
  runner.complete('reel', 'Waiting on you.');
  assert.equal(task(db, t).state, 'needs_you', 'parked, not done');
  await assert.rejects(crew.answer(9999, { answer: 'allow' }), /already settled/);
  const parked = db.get("SELECT * FROM asks WHERE state = 'open'")!;
  await assert.rejects(crew.answer(parked.id, { answer: 'maybe' }), /allow or deny/);
  await crew.answer(parked.id, { answer: 'deny' });
  await sleep(200);
  assert.equal(task(db, t).state, 'done', 'the answer resumed the same session and it finished');
  done();
});

test('tool grants: only granted, installed tools reach the CLI; credentials always denied', () => {
  const { root, cfg, crew, done } = setup();
  const bot = crew.recruit('reel', 'Reel', 'person');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const b of ['ffmpeg', 'ffprobe', 'node']) { writeFileSync(join(bin, b), '#!/bin/sh\n'); chmodSync(join(bin, b), 0o755); }
  const path = process.env.PATH;
  process.env.PATH = bin; // ffmpeg present, gh and magick absent
  try {
    assert.throws(() => disk.setGrants(cfg, 'reel', ['files', 'teleport']), /unknown tools: teleport/);
    disk.setGrants(cfg, 'reel', ['files', 'media', 'github', 'images', 'computer']);
    const tools = disk.botTools(cfg, 'reel');
    assert.equal(tools.find((t) => t.id === 'media')!.ready, true);
    assert.deepEqual(tools.find((t) => t.id === 'github')!.missing, ['gh']);
    disk.launchSpec(cfg, bot as any, 'http://127.0.0.1:1');
    const s = JSON.parse(readFileSync(join(disk.botDir(cfg, 'reel'), '.claude', 'settings.local.json'), 'utf8'));
    assert.ok(s.permissions.allow.includes('Bash(ffmpeg *)'));
    assert.ok(s.permissions.allow.includes('Bash(crew *)'), 'crew is always granted');
    assert.ok(!s.permissions.allow.some((a: string) => a.startsWith('Bash(gh ')), 'missing tool not offered');
    assert.ok(!s.permissions.allow.includes('Bash(magick *)'));
    assert.ok(s.permissions.deny.includes('Read(~/.ssh/**)'));
    assert.ok(s.permissions.deny.includes('CronCreate'), 'crewd owns schedules');
  } finally {
    process.env.PATH = path;
    done();
  }
});

test('bots on disk: persona rename, capped notes, folder confinement, slugs', () => {
  const { cfg, crew, done } = setup();
  crew.recruit('reel', 'Frames', 'person');
  const dir = disk.botDir(cfg, 'frames');
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /^# Frames/);
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /You are Frames/);
  assert.throws(() => crew.recruit('reel', 'Frames', 'person'), /already a bot/);
  assert.throws(() => crew.recruit('chief', 'Deputy', 'person'), /only one Chief/);
  disk.remember(cfg, 'frames', 'Likes slow transitions');
  assert.throws(() => disk.remember(cfg, 'frames', 'x'.repeat(disk.NOTES_CAP)), /notes are full/);
  assert.equal(disk.readNotes(cfg, 'frames'), '- Likes slow transitions\n');
  assert.throws(() => disk.insideBot(cfg, 'frames', '../chief/notes.md'), /outside/);
  assert.equal(disk.slug('Ma Reel 2!'), 'ma-reel-2');
  assert.match(disk.addressLine('Umer'), /chosen name, "Umer", never as "sir"/);
  assert.equal(disk.addressLine("Ma'am"), 'Address the person as "ma\'am".');
  done();
});
