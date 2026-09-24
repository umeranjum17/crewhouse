// Routines: plain-words schedules, next run, catch-up after sleep, overlap, pause, the morning digest. No CLI, no quota.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, nextRun, parseSchedule } from '../src/routines.ts';
import { Store } from '../src/db.ts';
import { Crew } from '../src/crew.ts';
import { StubRunner } from '../src/runner.ts';
import { loadConfig } from '../src/config.ts';

const at = (y: number, mo: number, d: number, h = 0, m = 0) => new Date(y, mo - 1, d, h, m).getTime();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('schedule words: parse, describe, reject', () => {
  const cases: [string, string][] = [
    ['every Monday 9:00', 'Every Monday at 9:00 am'],
    ['mondays at 9', 'Every Monday at 9:00 am'],
    ['every mon, wed and fri 5:30pm', 'Every Monday, Wednesday and Friday at 5:30 pm'],
    ['fri 17:00', 'Every Friday at 5:00 pm'],
    ['weekdays at 8 am', 'Weekdays at 8:00 am'],
    ['every day 7:15', 'Every day at 7:15 am'],
    ['daily at noon', 'Every day at 12:00 pm'],
    ['weekends 12am', 'Weekends at 12:00 am'],
    ['every Tuesday', 'Every Tuesday at 9:00 am'],
    ['every hour', 'Every hour'],
    ['every 2 hours', 'Every 2 hours'],
    ['every 30 minutes', 'Every 30 minutes'],
  ];
  for (const [text, words] of cases) assert.equal(describe(parseSchedule(text)), words, text);
  for (const text of ['', 'sometimes', 'every 25:00 monday', 'monday 13pm', 'every 0 minutes', 'at 9']) assert.throws(() => parseSchedule(text), /can't read/, text);
});

test('next run: same day if still ahead, else the next matching day; intervals count from now', () => {
  const mon9 = parseSchedule('every Monday 9:00');
  // 2026-09-21 is a Monday.
  assert.equal(nextRun(mon9, at(2026, 9, 21, 8, 59)), at(2026, 9, 21, 9, 0));
  assert.equal(nextRun(mon9, at(2026, 9, 21, 9, 0)), at(2026, 9, 28, 9, 0), 'strictly after');
  assert.equal(nextRun(mon9, at(2026, 9, 24, 12)), at(2026, 9, 28, 9, 0));
  const weekdays = parseSchedule('weekdays 8am');
  assert.equal(nextRun(weekdays, at(2026, 9, 25, 9)), at(2026, 9, 28, 8), 'Friday after 8 goes to Monday');
  assert.equal(nextRun(parseSchedule('every 2 hours'), 1_000), 1_000 + 2 * 3_600_000);
  // Local wall-clock time holds across a daylight-saving change (a no-op where the zone has none).
  assert.equal(new Date(nextRun(parseSchedule('every day 9:00'), at(2026, 3, 28, 12))).getHours(), 9);
  assert.equal(new Date(nextRun(parseSchedule('every day 9:00'), at(2026, 10, 24, 12))).getHours(), 9);
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'crewhouse-routines-'));
  const cfg = { ...loadConfig(), stateDir: join(root, 'state'), crewDir: join(root, 'crew'), toolsDir: join(root, 'tools'), runner: 'stub' as const };
  const db = new Store(cfg.stateDir);
  const runner = new StubRunner();
  const crew = new Crew(cfg, db, runner, 'http://127.0.0.1:1');
  runner.onTurn = (bot, reply) => crew.finish(bot, reply);
  crew.init();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  let closed = false;
  const done = () => { if (!closed) { closed = true; crew.stop(); db.close(); } };
  after(done);
  return { db, runner, crew, done };
}
const fired = (db: Store, id: number) => db.all("SELECT kind, data FROM events WHERE kind IN ('routine.fired', 'routine.skipped') AND json_extract(data, '$.routine') = ?", id)
  .map((e) => ({ kind: e.kind, ...JSON.parse(e.data) }));

test('routines: fire when due, catch up once after sleep, skip on overlap, pause, run now, per-routine model', async () => {
  const { db, runner, crew, done } = setup();
  assert.throws(() => crew.addRoutine({ bot: 'chief', schedule: 'daily 9', task: 'x' }, 'person'), /no bot/);
  assert.throws(() => crew.addRoutine({ bot: 'reel', schedule: 'whenever', task: 'x' }, 'person'), /can't read/);
  assert.throws(() => crew.addRoutine({ bot: 'reel', schedule: 'daily 9', task: 'x', model: 'nope:x' }, 'person'), /not a model/);
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every Monday 9:00', task: 'ask permission: make the weekly demo', model: 'claude:haiku', name: 'Weekly demo' }, 'person');
  assert.ok(r.next_at > Date.now());
  assert.equal(new Date(r.next_at).getDay(), 1);

  // Not due yet: nothing happens.
  crew.schedule();
  assert.equal(fired(db, r.id).length, 0);

  // The machine slept through three Mondays: it fires once, late, and the next run is in the future.
  db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 21 * 86_400_000, r.id);
  crew.schedule();
  crew.schedule();
  let h = fired(db, r.id);
  assert.equal(h.length, 1, 'latest only');
  assert.equal(h[0].why, 'late');
  const t = db.get('SELECT * FROM tasks WHERE id = ?', h[0].task)!;
  assert.equal(t.brain, 'claude:haiku', 'the routine picks the model');
  assert.equal(t.title, 'Weekly demo');
  assert.ok(db.get('SELECT next_at FROM routines WHERE id = ?', r.id)!.next_at > Date.now());
  await sleep(100);
  assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', t.id)!.state, 'working', 'the stub holds "ask permission" tasks open');

  // Due again while the last run is still going: skipped, not stacked.
  crew.runRoutine(r.id);
  h = fired(db, r.id);
  assert.equal(h.at(-1).kind, 'routine.skipped');
  assert.equal(h.at(-1).why, 'overlap');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 1);

  // Once it finishes, Run now starts a fresh task.
  runner.complete('reel', 'Demo made.');
  crew.runRoutine(r.id);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 2);
  await sleep(100);
  runner.complete('reel', 'Demo made again.');
  await sleep(50);

  // Paused routines never fire, and never catch up when resumed.
  crew.updateRoutine(r.id, { state: 'paused' });
  db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 1000, r.id);
  crew.schedule();
  assert.equal(fired(db, r.id).length, 3);
  crew.updateRoutine(r.id, { state: 'on' });
  assert.ok(db.get('SELECT next_at FROM routines WHERE id = ?', r.id)!.next_at > Date.now());
  crew.updateRoutine(r.id, { schedule: 'every 2 hours' });
  assert.equal(crew.routines().find((x) => x.id === r.id)!.words, 'Every 2 hours');
  assert.throws(() => crew.updateRoutine(r.id, { schedule: 'blah' }), /can't read/);
  crew.deleteRoutine(r.id);
  assert.equal(crew.routines().some((x) => x.id === r.id), false);
  done();
});

test('morning digest: on by default at 8:00, says what finished, what needs you, what is coming up', async () => {
  const { db, crew, done } = setup();
  const digest = crew.routines().find((r) => r.kind === 'digest')!;
  assert.equal(digest.state, 'on');
  assert.equal(digest.words, 'Every day at 8:00 am');
  assert.throws(() => crew.deleteRoutine(digest.id), /paused, not removed/);

  crew.assign('reel', 'Make the pairing demo', 'chief');
  await sleep(200);
  crew.addRoutine({ bot: 'reel', schedule: 'every hour', task: 'Tidy the screenshots' }, 'person');
  db.run("INSERT INTO asks (bot, kind, title, detail, at) VALUES ('reel', 'permission', 'Reel would like to run a command', '{}', ?)", Date.now());
  crew.runRoutine(digest.id);
  const text = db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' ORDER BY id DESC")!.text;
  assert.match(text, /^Good (morning|afternoon|evening), sir\. While you were away:/);
  assert.match(text, /Finished: Reel, “Make the pairing demo”/);
  assert.match(text, /Needs you: Reel would like to run a command/);
  assert.match(text, /Coming up: “Tidy the screenshots” with Reel/);
  assert.doesNotMatch(text, /Master|aye|!/);
  done();
});

test('household: a member\'s routines run as them, and each member gets their own digest in their own thread', async () => {
  const { db, crew, done } = setup();
  const sam = crew.addMember('Sam').id;
  crew.onboard('Sam', sam);
  const digests = db.all("SELECT * FROM routines WHERE kind = 'digest' ORDER BY member");
  assert.deepEqual(digests.map((r) => r.member), [1, sam], 'one digest each');
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every day 9:00', task: 'Sam\'s daily clip' }, 'person', sam);
  assert.equal(crew.routines(1).some((x) => x.id === r.id), false, 'the owner does not see Sam\'s routines');
  assert.ok(crew.routines(sam).some((x) => x.id === r.id));
  crew.runRoutine(r.id);
  const t = db.get('SELECT * FROM tasks WHERE routine = ?', r.id)!;
  assert.equal(t.member, sam, 'runs on Sam\'s accounts');
  // Wait for the run, not a fixed time: CI runs the test files side by side on two cores.
  for (let i = 0; i < 50 && db.get('SELECT state FROM tasks WHERE id = ?', t.id)!.state !== 'done'; i++) await sleep(100);
  crew.runRoutine(digests[1].id);
  const mine = db.get("SELECT * FROM messages WHERE bot = 'chief' AND author = 'bot' ORDER BY id DESC")!;
  assert.equal(mine.member, sam);
  assert.match(mine.text, /^Good \w+, Sam\. While you were away:\n- Finished: Reel, “Sam's daily clip”/);
  done();
});
