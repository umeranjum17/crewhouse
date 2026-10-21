import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, holding, release, settled, until, task, delegated } from './lab.ts';
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

test('Chief’s hand-offs to two helpers are the crew’s teamwork, and his closing words are the standup', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('scout', 'Scout', 'person'); crew.recruit('scribe', 'Scribe', 'person');
  const errand = (await crew.post('chief', 'ask permission: look one thing up'))!.task;
  await holding(crew, 'chief');
  const solo = delegated(crew, 'scout', 'Look up the school run times').task;
  await settled(db, solo); await release(crew, 'chief', 'Scout has it.'); await settled(db, errand);
  assert.ok(!crew.room().lines.some((l) => l.text.includes('school run')), 'one hand-off is an errand: it stays in the chats');
  const job = (await crew.post('chief', 'ask permission: stories, then a draft'))!.task;
  await holding(crew, 'chief');
  const a = delegated(crew, 'scout', 'Find three stories about the park').task, b = delegated(crew, 'scribe', 'Draft a note about the first story').task;
  await settled(db, a); await settled(db, b); await release(crew, 'chief', 'Scout found the stories and Scribe drafted the note.'); await settled(db, job);
  const { lines } = crew.room();
  assert.deepEqual(lines.filter((l) => l.from).map((l) => [l.from, l.to, l.text]), [['chief', 'scout', 'Find three stories about the park'], ['chief', 'scribe', 'Draft a note about the first story']], 'each hand-off carries what Chief asked');
  assert.deepEqual(lines.filter((l) => l.standup).map((l) => l.text), ['Scout found the stories and Scribe drafted the note.'], 'his own closing words are the one standup');
  assert.equal(db.all("SELECT seq FROM events WHERE kind = 'room.wrap'").length, 0, 'crewd writes no second one when his job ended well');
  done();
});

test('when Chief’s job does not end well, crewd stands in with what each helper came to', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('scout', 'Scout', 'person'); crew.recruit('scribe', 'Scribe', 'person');
  const job = (await crew.post('chief', 'ask permission: stories, then a draft [tool crew_outcome {"worked":false,"seen":"not confirmed"}]'))!.task;
  await holding(crew, 'chief');
  const a = delegated(crew, 'scout', 'Find three stories').task, b = delegated(crew, 'scribe', 'Draft a note [tool crew_outcome {"worked":false,"seen":"not confirmed"}]').task;
  await settled(db, a); await settled(db, b); await release(crew, 'chief', 'Both are back.'); await settled(db, job);
  assert.equal(task(db, job).state, 'unsure');
  const last = crew.room().lines.at(-1)!;
  assert.ok(last.standup && /^The crew has stopped\./.test(last.text) && /Scribe isn't sure it worked/.test(last.text), last.text);
  assert.equal(db.all("SELECT seq FROM events WHERE kind = 'room.wrap'").length, 1);
  done();
});

test('a reply that is only the engine\u2019s silence token is no reply: crewd writes the standup', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('scout', 'Scout', 'person'); crew.recruit('scribe', 'Scribe', 'person');
  const job = (await crew.post('chief', 'ask permission: stories, then a draft'))!.task;
  await holding(crew, 'chief');
  const a = delegated(crew, 'scout', 'Find three stories').task, b = delegated(crew, 'scribe', 'Draft a note').task;
  await settled(db, a); await settled(db, b); await release(crew, 'chief', 'REPLY_SKIP'); await settled(db, job);
  const last = crew.room().lines.at(-1)!;
  assert.ok(last.standup && /^The crew has stopped|^Scout/.test(last.text) && !/REPLY_SKIP/.test(last.text), last.text);
  assert.equal(db.all("SELECT 1 FROM messages WHERE text LIKE '%REPLY_SKIP%'").length, 0, 'the token is never kept as words');
  assert.equal(db.all("SELECT seq FROM events WHERE kind = 'room.wrap'").length, 1);
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

