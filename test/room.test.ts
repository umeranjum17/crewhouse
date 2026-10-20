import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, holding, release, settled, until, task } from './lab.ts';
import * as disk from '../src/bots.ts';

test('room replies rejoin a job; plain routed work stays out', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('scout', 'Scout', 'person');
  const room = (await crew.post('scout', 'First request', undefined, true))!.task;
  const follow = (await crew.post('scout', 'One more thing', undefined, true))!.task;
  assert.equal(task(db, room).room, 1); assert.equal(task(db, follow).root, room);
  const plain = (await crew.post('scout', 'Private errand'))!.task;
  assert.equal(task(db, plain).room, 0);
  assert.ok(crew.room().lines.some((l) => l.text === 'One more thing'));
  assert.ok(!crew.room().lines.some((l) => l.text === 'Private errand'));
  assert.equal(crew.snapshot().room.last?.id, crew.room().lines.at(-1)?.id, 'the snapshot keeps the room preview');
  const before = crew.room().lines.at(-1)!.id;
  assert.ok(crew.room(before).lines.every((l) => l.id < before), 'room paging uses the message cursor');
  await settled(db, room); await settled(db, follow); await settled(db, plain);
  done();
});

test('room jobs on one thread settle into exactly one wrap-up without per-task completions', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('scout', 'Scout', 'person');
  const first = (await crew.post('scout', 'ask permission: plan the project', undefined, true))!.task;
  await holding(crew, 'scout');
  const second = (await crew.post('scout', 'Check the facts', undefined, true))!.task;
  await release(crew, 'scout', 'Plan ready.');
  await settled(db, first); await settled(db, second);
  assert.equal(db.all("SELECT seq FROM events WHERE kind = 'room.wrap' AND json_extract(data, '$.root') = ?", first).length, 1);
  assert.equal(db.all("SELECT id FROM messages WHERE bot = 'chief' AND text LIKE '%has finished%' AND task_id = ?", first).length, 0);
  assert.match(db.get("SELECT text FROM messages WHERE bot = 'chief' AND task_id = ? AND text LIKE 'All done.%'", first)?.text ?? '', /Scout finished\..*\nScout finished\./);
  done();
});

test('wrap-up reports an unsure part without saying all done', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('scout', 'Scout', 'person');
  const first = (await crew.post('scout', 'ask permission: look it up', undefined, true))!.task;
  await holding(crew, 'scout');
  const next = (await crew.post('scout', 'Review [tool crew_outcome {"worked":false,"seen":"not confirmed"}]', undefined, true))!.task;
  await release(crew, 'scout', 'Looked it up.');
  await settled(db, next); await settled(db, first);
  assert.equal(task(db, next).state, 'unsure');
  const wrap = db.get("SELECT text FROM messages WHERE bot = 'chief' AND task_id = ? AND text LIKE 'The crew has stopped.%'", first);
  assert.match(wrap?.text ?? '', /Scout isn't sure it worked/);
  done();
});

test('a first look delivered mid-job shows on the person\u2019s desk', async () => {
  const { db, cfg, crew, done } = setup();
  for (const t of ['reel', 'scout', 'scribe', 'helper', 'tracer'])
    assert.match(readFileSync(join(cfg.repoDir, `templates/${t}/AGENTS.md`), 'utf8'), /share a first look with crew_deliver.*note starting `First look:`/, `${t} shares first looks`);
  assert.doesNotMatch(readFileSync(join(cfg.repoDir, 'templates/support/AGENTS.md'), 'utf8'), /First look/, 'support drafts are already reviewed');
  crew.onboard('Sara');
  crew.recruit('scout', 'Scout', 'person');
  const dir = join(disk.botDir(cfg, 'scout'), 'files');
  mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'opening.md'), 'draft');
  const first = (await crew.post('scout', 'ask permission: research the opening'))!.task;
  await holding(crew, 'scout');
  assert.equal((crew.snapshot().bots.find((b: any) => b.id === 'scout')?.task as any)?.state, 'working');
  (crew as any).deliver('scout', 'files/opening.md', 'First look: the opening outline');
  const mine = crew.snapshot().bots.find((b: any) => b.id === 'scout')?.task;
  assert.deepEqual(mine?.files.map((f: any) => f.path), ['files/opening.md'], 'the desk shows the first look mid-job');
  assert.equal(mine?.files[0].note, 'First look: the opening outline');
  await release(crew, 'scout', 'Still working.'); await settled(db, first);
  done();
});

test('Things foregrounds own output ahead of an untagged legacy handoff copy', async () => {
  const { db, cfg, crew, done } = setup();
  crew.onboard('Sara');
  crew.recruit('scout', 'Scout', 'person'); crew.recruit('scribe', 'Scribe', 'person');
  const first = (await crew.post('scribe', 'ask permission: write the one-page family checklist'))!.task;
  await holding(crew, 'scribe');
  // A handoff recorded before the input:true tag: a plain file.delivered event on the handoff-copy path.
  const legacy = join(disk.botDir(cfg, 'scribe'), 'files', 'from-scout');
  mkdirSync(legacy, { recursive: true }); writeFileSync(join(legacy, 'fdic-basics.md'), 'research');
  db.event('file.delivered', 'scribe', { task: first, path: 'files/from-scout/fdic-basics.md', note: 'from Scout', size: 8 });
  writeFileSync(join(disk.botDir(cfg, 'scribe'), 'files', 'family-checklist.md'), 'checklist');
  (crew as any).deliver('scribe', 'files/family-checklist.md', 'checklist');
  await release(crew, 'scribe', 'Checklist ready.'); await settled(db, first);
  const things = crew.snapshot().tasks.filter((t: any) => t.bot === 'scribe' && t.state === 'done');
  assert.equal(things.length, 1);
  assert.equal(things[0].files[0], 'files/family-checklist.md');
  assert.ok(things[0].files.includes('files/from-scout/fdic-basics.md'));
  done();
});

