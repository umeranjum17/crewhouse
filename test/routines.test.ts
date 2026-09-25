// Routines: plain-words schedules, next run, catch-up after sleep, overlap, pause, the morning digest. No CLI, no quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup as lab, settled, release, until } from './lab.ts';
import type { Store } from '../src/db.ts';
const { describe, nextRun, parseSchedule } = await import('../src/routines.ts');

const at = (y: number, mo: number, d: number, h = 0, m = 0) => new Date(y, mo - 1, d, h, m).getTime();
const state = (db: Store, t: number) => db.get('SELECT state FROM tasks WHERE id = ?', t)!.state;

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
  const { db, crew, done } = lab();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  return { db, crew, done };
}
const fired = (db: Store, id: number) => db.all("SELECT kind, data FROM events WHERE kind IN ('routine.fired', 'routine.skipped') AND json_extract(data, '$.routine') = ?", id)
  .map((e) => ({ kind: e.kind, ...JSON.parse(e.data) }));

test('routines: fire when due, catch up once after sleep, skip on overlap, pause, run now, per-routine model', async () => {
  const { db, crew, done } = setup();
  assert.throws(() => crew.addRoutine({ bot: 'chief', schedule: 'daily 9', task: 'x' }, 'person'), /no bot/);
  assert.throws(() => crew.addRoutine({ bot: 'reel', schedule: 'whenever', task: 'x' }, 'person'), /can't read/);
  assert.throws(() => crew.addRoutine({ bot: 'reel', schedule: 'daily 9', task: 'x', model: 'nope:x' }, 'person'), /not an AI account/);
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every Monday 9:00', task: 'ask permission: make the weekly demo', model: 'copilot', name: 'Weekly demo' }, 'person');
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
  assert.equal(t.brain, 'copilot', 'the routine picks the AI account');
  assert.equal(crew.routines().find((x) => x.id === r.id)!.thinks, 'GitHub Copilot');
  assert.equal(t.title, 'Weekly demo');
  assert.ok(db.get('SELECT next_at FROM routines WHERE id = ?', r.id)!.next_at > Date.now());
  await until('holding', () => crew.sessionOf('reel'));
  assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', t.id)!.state, 'working', 'the stub holds "ask permission" tasks open');

  // Due again while the last run is still going: skipped, not stacked.
  crew.runRoutine(r.id);
  h = fired(db, r.id);
  assert.equal(h.at(-1).kind, 'routine.skipped');
  assert.equal(h.at(-1).why, 'overlap');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 1);

  // Once it finishes, Run now starts a fresh task.
  await release(crew, 'reel', 'Demo made.');
  await settled(db, t.id);
  crew.runRoutine(r.id);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 2);
  const again = db.get('SELECT id FROM tasks WHERE routine = ? ORDER BY id DESC', r.id)!.id;
  await release(crew, 'reel', 'Demo made again.');
  await settled(db, again);
  assert.equal(state(db, again), 'done');

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

  await settled(db, crew.assign('reel', 'Make the pairing demo', 'chief').task);
  crew.addRoutine({ bot: 'reel', schedule: 'every hour', task: 'Tidy the screenshots' }, 'person');
  db.run("INSERT INTO asks (bot, kind, title, detail, at) VALUES ('reel', 'permission', 'Reel wants to look through your Pictures folder.', '{}', ?)", Date.now());
  crew.runRoutine(digest.id);
  const text = db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' ORDER BY id DESC")!.text;
  assert.match(text, /^Good (morning|afternoon|evening), sir\. While you were away:/);
  assert.match(text, /Finished: Reel, “Make the pairing demo”/);
  assert.match(text, /Needs you: Reel wants to look through your Pictures folder\./);
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
  await settled(db, t.id);
  crew.runRoutine(digests[1].id);
  const mine = db.get("SELECT * FROM messages WHERE bot = 'chief' AND author = 'bot' ORDER BY id DESC")!;
  assert.equal(mine.member, sam);
  assert.match(mine.text, /^Good \w+, Sam\. While you were away:\n- Finished: Reel, “Sam's daily clip”/);
  done();
});

test('quiet check-ins: all clear says nothing and stays out of the digest; anything else speaks up', async () => {
  const { db, crew, done } = setup();
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every day 9:00', task: 'ask permission: check the shared folder for new photos', quiet: true }, 'person');
  const said = () => db.all("SELECT text FROM messages WHERE bot = 'reel' AND author = 'bot'").map((m) => m.text);
  const run = async (reply: string) => {
    crew.runRoutine(r.id);
    const t = db.get('SELECT id FROM tasks WHERE routine = ? ORDER BY id DESC', r.id)!.id;
    await release(crew, 'reel', reply);
    await settled(db, t);
    return t;
  };
  const first = await run('ALL-CLEAR');
  assert.match(readFileSync(db.get('SELECT session FROM tasks WHERE id = ?', first)!.session, 'utf8'), /This is a check-in\. If nothing needs [^,]+, reply exactly ALL-CLEAR/);
  assert.deepEqual(said(), [], 'all clear: nothing in the thread');
  assert.equal(db.get('SELECT result FROM tasks WHERE id = ?', first)!.result, 'All clear');
  assert.equal(crew.routines().find((x) => x.id === r.id)!.history[0].clear, true);
  assert.match(crew.digest(1, 0), /Nothing new was finished/, 'and nothing in the digest');
  await run('Three new photos from Saturday are in the shared folder.');
  assert.deepEqual(said(), ['Three new photos from Saturday are in the shared folder.']);
  assert.match(crew.digest(1, 0), /Finished: Reel/);
  crew.updateRoutine(r.id, { quiet: false });
  assert.equal(db.get('SELECT quiet FROM routines WHERE id = ?', r.id)!.quiet, 0);
  assert.throws(() => crew.updateRoutine(db.get("SELECT id FROM routines WHERE kind = 'digest'")!.id, { quiet: true }), /helper's routine/);
  done();
});

test('sleep: missed routines are named once in each member\'s Chief thread, and a working crew keeps idle sleep away', async () => {
  const { db, crew, done } = setup();
  const said = () => db.all("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND text LIKE 'Your computer was asleep%'").map((m) => m.text);
  const awake: boolean[] = [];
  crew.keepAwake = (on) => awake.push(on);

  // Asleep with nothing missed (the digest speaks for itself): recorded, but nobody hears about it.
  crew.slept(Date.now() - 3_600_000, Date.now());
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'system.slept'")!.n, 1);
  assert.deepEqual(said(), []);

  // A routine came due while it slept: Chief names it, and it runs once, late.
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every day 7:00', task: 'ask permission: check the prices', name: 'Deal check' }, 'person');
  db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 3 * 3_600_000, r.id);
  crew.slept(Date.now() - 8 * 3_600_000, Date.now());
  crew.schedule();
  assert.equal(said().length, 1);
  assert.match(said()[0], /the crew paused\. I'm running “Deal check” now, once, to catch up\.$/);
  assert.equal(fired(db, r.id).at(-1).why, 'late');

  // Its run holds the machine awake; finishing lets it sleep again.
  await until('kept awake', () => awake.at(-1) === true);
  await release(crew, 'reel', 'Prices checked.');
  await until('allowed to sleep', () => awake.at(-1) === false);
  assert.deepEqual(awake, [true, false], 'one hold, one release');
  done();
});
