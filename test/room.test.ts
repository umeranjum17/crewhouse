import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, holding, release, settled, until, task } from './lab.ts';
import * as disk from '../src/bots.ts';

const pass = '[tool crew_pass {"bot":"scout","task":"Find the sources. Done means: three links","files":["files/story.md"]}]';

test('handoff copies only the passer’s files into the crew room', async () => {
  const { db, cfg, crew, done } = setup();
  crew.onboard('Sara');
  crew.recruit('reel', 'Reel', 'person'); crew.recruit('scout', 'Scout', 'person');
  const file = join(disk.botDir(cfg, 'reel'), 'files', 'story.md');
  mkdirSync(join(disk.botDir(cfg, 'reel'), 'files'), { recursive: true }); writeFileSync(file, 'A source');
  const first = (await crew.assign('reel', `ask permission: please hand it on ${pass}`, 'chief'))!.task;
  await until('pass', () => db.get("SELECT id FROM tasks WHERE bot = 'scout'"));
  const next = db.get("SELECT * FROM tasks WHERE bot = 'scout'")!;
  assert.equal(next.parent, first); assert.equal(next.root, first);
  assert.ok(existsSync(join(disk.botDir(cfg, 'scout'), 'files/from-reel/story.md')));
  assert.ok(crew.room().lines.some((l) => l.from === 'reel' && l.files.some((f: any) => f.path === 'files/from-reel/story.md')));
  assert.equal(crew.snapshot().room.last?.id, crew.room().lines.at(-1)?.id, 'the snapshot keeps the room preview');
  const before = crew.room().lines.at(-1)!.id;
  assert.ok(crew.room(before).lines.every((l) => l.id < before), 'room paging uses the message cursor');
  await holding(crew, 'reel');
  await assert.rejects(async () => (crew as any).pass('reel', 'scout', 'bad', ['../secret']), /outside|ENOENT/);
  await release(crew, 'reel', 'Passed it on.'); await settled(db, first); await settled(db, next.id);
  const wraps = db.all("SELECT * FROM events WHERE kind = 'room.wrap' AND json_extract(data, '$.root') = ?", first);
  assert.equal(wraps.length, 1);
  assert.ok(db.get("SELECT text FROM messages WHERE bot = 'chief' AND task_id = ? AND author = 'bot'", next.id));
  done();
});

test('two passes close the room once and each Chief review retains its exact task identity', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('reel', 'Reel', 'person'); crew.recruit('scout', 'Scout', 'person');
  const first = (await crew.assign('reel', 'ask permission: plan the project', 'chief'))!.task;
  await holding(crew, 'reel');
  (crew as any).pass('reel', 'scout', 'Find links');
  (crew as any).pass('reel', 'scout', 'Check the facts');
  await release(crew, 'reel', 'Plan ready.');
  const parts = db.all("SELECT id FROM tasks WHERE bot = 'scout' ORDER BY id");
  await settled(db, first); for (const p of parts) await settled(db, p.id);
  assert.equal(db.all("SELECT seq FROM events WHERE kind = 'room.wrap' AND json_extract(data, '$.root') = ?", first).length, 1);
  assert.equal(db.all("SELECT id FROM messages WHERE bot = 'chief' AND text LIKE '%has finished%' AND task_id = ?", first).length, 0);
  for (const p of parts) assert.equal(db.get("SELECT COUNT(*) AS n FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ?", p.id)!.n, 1);
  done();
});

test('handoff check waits, survives a restart, and never has a standing answer', async () => {
  const { db, cfg, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('reel', 'Reel', 'person'); crew.recruit('scout', 'Scout', 'person');
  disk.setSettings(cfg, 'reel', { handoff: 'ask' });
  writeFileSync(join(disk.botDir(cfg, 'reel'), 'files/story.md'), 'A source');
  const first = (await crew.assign('reel', `ask permission: pass it ${pass}`, 'chief'))!.task;
  await until('check card', () => db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open' AND json_extract(detail, '$.pass.to') = 'scout'"));
  const card = db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'")!;
  assert.equal(db.get("SELECT 1 FROM tasks WHERE bot = 'scout'"), undefined);
  const shown = crew.snapshot().asks.find((a: any) => a.id === card.id)!;
  assert.equal(shown.detail.always, undefined); assert.equal(shown.detail.pass.root, first);
  assert.ok(crew.room().asks.some((a) => a.id === card.id));
  await release(crew, 'reel', 'Waiting for your check.'); await settled(db, first);
  // Rebuild on the same database: a proposal is durable even when the passer finished.
  crew.stop();
  const { Crew } = await import('../src/crew.ts');
  const resumed = new Crew(cfg, db); resumed.init();
  try { await resumed.answer(card.id, { answer: 'allow' });
  const second = db.get("SELECT * FROM tasks WHERE bot = 'scout'")!;
  assert.equal(second.root, first);
  await settled(db, second.id);
  assert.equal(db.all("SELECT seq FROM events WHERE kind = 'room.wrap' AND json_extract(data, '$.root') = ?", first).length, 1);
  } finally { resumed.stop(); done(); }
});

test('denied handoff creates no task', async () => {
  const { db, cfg, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('reel', 'Reel', 'person'); crew.recruit('scout', 'Scout', 'person');
  disk.setSettings(cfg, 'reel', { handoff: 'ask' });
  const first = (await crew.assign('reel', 'ask permission [tool crew_pass {"bot":"scout","task":"Review it"}]', 'chief'))!.task;
  await until('check', () => db.get("SELECT id FROM asks WHERE kind = 'propose' AND state = 'open'"));
  await crew.answer(db.get("SELECT id FROM asks WHERE state = 'open'")!.id, { answer: 'deny' });
  assert.equal(db.get("SELECT id FROM tasks WHERE bot = 'scout'"), undefined);
  await release(crew, 'reel', 'Stopped here.'); await settled(db, first);
  done();
});

test('the final Chief review uses the finished successor, not the earlier handoff progress (D37)', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('scout', 'Scout', 'person'); crew.recruit('scribe', 'Scribe', 'person');
  const first = (await crew.assign('scout', 'ask permission: research FDIC basics then hand on', 'chief'))!.task;
  await holding(crew, 'scout');
  (crew as any).pass('scout', 'scribe', 'ask permission: write the one-page family checklist from the research');
  await release(crew, 'scout', 'The FDIC research is complete and sourced; Scribe is preparing the one-page checklist now.');
  const second = db.get("SELECT id FROM tasks WHERE bot = 'scribe'")!.id;
  await release(crew, 'scribe', 'Finished the one-page FDIC family checklist with coverage limits and what to do next.');
  await settled(db, first); await settled(db, second);
  const wrap = db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ? ORDER BY id DESC", second)?.text ?? '';
  assert.match(wrap, /Chief has the report/);
  assert.match(wrap, /FDIC family checklist/);
  assert.doesNotMatch(wrap, /is preparing/i);
  done();
});

test('wrap-up reports an unsure part without saying all done', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('reel', 'Reel', 'person'); crew.recruit('scout', 'Scout', 'person');
  const request = 'Review [tool crew_outcome {"worked":false,"seen":"not confirmed"}]';
  const first = (await crew.assign('reel', 'ask permission: hand this on', 'chief'))!.task;
  await holding(crew, 'reel');
  (crew as any).pass('reel', 'scout', request);
  await release(crew, 'reel', 'Passed on.');
  await until('scout part', () => db.get("SELECT id FROM tasks WHERE bot = 'scout'"));
  const next = db.get("SELECT id FROM tasks WHERE bot = 'scout'")!.id;
  await settled(db, next); await settled(db, first);
  assert.equal(task(db, next).state, 'unsure');
  const wrap = db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ? ORDER BY id DESC", next);
  assert.match(wrap?.text ?? '', /Chief cannot confirm this result[\s\S]*not confirmed/);
  assert.doesNotMatch(wrap?.text ?? '', /All done/);
  done();
});

test('Things foregrounds a task’s own output ahead of handed-over input', async () => {
  const { db, cfg, crew, done } = setup();
  crew.onboard('Sara');
  crew.recruit('scout', 'Scout', 'person'); crew.recruit('scribe', 'Scribe', 'person');
  const scoutFiles = join(disk.botDir(cfg, 'scout'), 'files');
  mkdirSync(scoutFiles, { recursive: true }); writeFileSync(join(scoutFiles, 'fdic-basics.md'), 'research');
  const first = (await crew.assign('scout', 'ask permission: research FDIC insurance', 'chief'))!.task;
  await holding(crew, 'scout');
  (crew as any).deliver('scout', 'files/fdic-basics.md', 'research');
  // Scribe's run holds on "ask permission", so its own delivery lands on the handoff task, as in production.
  (crew as any).pass('scout', 'scribe', 'ask permission: write the one-page family checklist. Done means: a checklist', ['files/fdic-basics.md']);
  await until('scribe task', () => db.get("SELECT id FROM tasks WHERE bot = 'scribe'"));
  const next = db.get("SELECT id FROM tasks WHERE bot = 'scribe'")!.id;
  await holding(crew, 'scribe');
  writeFileSync(join(disk.botDir(cfg, 'scribe'), 'files', 'family-checklist.md'), 'checklist');
  (crew as any).deliver('scribe', 'files/family-checklist.md', 'checklist');
  await release(crew, 'scribe', 'Checklist ready.'); await settled(db, next);
  await release(crew, 'scout', 'Passed it on.'); await settled(db, first);
  const things = crew.snapshot().tasks.filter((t: any) => t.bot === 'scribe' && t.state === 'done');
  assert.equal(things.length, 1);
  assert.equal(things[0].files[0], 'files/family-checklist.md');
  assert.ok(things[0].files.includes('files/from-scout/fdic-basics.md'));
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
  const first = (await crew.assign('scout', 'ask permission: research the opening', 'chief'))!.task;
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
  const first = (await crew.assign('scribe', 'ask permission: write the one-page family checklist', 'chief'))!.task;
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

test('public room requests go to Chief; plain internal work stays out', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sara'); crew.recruit('scout', 'Scout', 'person');
  const room = (await crew.post('scout', 'First request', undefined, undefined, true))!.task;
  const follow = (await crew.post('scout', 'One more thing', undefined, undefined, true))!.task;
  assert.equal(task(db, room).bot, 'chief'); assert.equal(task(db, room).room, 1);
  assert.equal(task(db, follow).bot, 'chief'); assert.equal(task(db, follow).root, follow);
  const plain = (await crew.assign('scout', 'Private errand', 'chief'))!.task;
  assert.equal(task(db, plain).room, 0);
  assert.ok(crew.room().lines.some((l) => l.text === 'One more thing'));
  assert.ok(!crew.room().lines.some((l) => l.text === 'Private errand'));
  await settled(db, room); await settled(db, follow); await settled(db, plain);
  done();
});
