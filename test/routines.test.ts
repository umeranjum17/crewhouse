// Routines: plain-words schedules, next run, catch-up after sleep, overlap, pause, the morning digest. No CLI, no quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup as lab, settled, release, holding, until, lastSaid, sleep, task } from './lab.ts';
import * as disk from '../src/bots.ts';
import * as A from '../web/src/adapter.ts';
import type { Store } from '../src/db.ts';
const { describe, describeTrigger, nextRun, parseSchedule, parseTrigger } = await import('../src/routines.ts');

const at = (y: number, mo: number, d: number, h = 0, m = 0) => new Date(y, mo - 1, d, h, m).getTime();
const state = (db: Store, t: number) => db.get('SELECT state FROM tasks WHERE id = ?', t)!.state;

test('schedule words: parse, describe, reject', () => {
  const cases: [string, string][] = [
    ['every Monday 9:00', 'Every Monday at 9:00 am'],
    ['mondays at 9', 'Every Monday at 9:00 am'],
    ['every mon, wed and fri 5:30pm', 'Every Monday, Wednesday and Friday at 5:30 pm'],
    ['fri 17:00', 'Every Friday at 5:00 pm'],
    ['weekdays at 8 am', 'Weekdays at 8:00 am'],
    ['every weekday morning', 'Weekdays at 9:00 am'],
    ['every Friday at five', 'Every Friday at 5:00 pm'],
    ['every evening', 'Every day at 6:00 pm'],
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
  const { db, crew, cfg, done } = lab();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  return { db, crew, cfg, done };
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
  assert.match(text, /Give your decision to Chief[\s\S]*Helper: Reel[\s\S]*Pictures folder[\s\S]*Give your decision on this card/);
  assert.match(text, /Coming up: “Tidy the screenshots” with Reel/);
  assert.doesNotMatch(text, /Master|aye|!/);
  done();
});

test('recap keeps an unknown name out, stays quiet on an empty day, and is a separate daily message', async () => {
  const { db, crew, cfg, done } = lab();
  const first = await crew.post('chief', 'Reply with exactly: Hello.');
  await settled(db, first!.task);
  assert.equal(crew.person().address, null);
  assert.equal(disk.readNotes(cfg, { bot: null }), '');
  assert.equal(disk.readNotes(cfg, { bot: 'chief' }), '');
  assert.match(crew.digest(0), /^Good \w+\. Everything is quiet\.$/);
  crew.recruit('reel', 'Reel', 'person');
  crew.addRoutine({ bot: 'reel', schedule: 'every hour', task: 'Check the school letter' }, 'person');
  assert.match(crew.digest(0), /^Good \w+\. While you were away:/);
  assert.doesNotMatch(crew.digest(0), /Nothing new|Nothing needs|Nothing is scheduled|Tap to begin/);
  crew.setAddress('Umer.');
  const digest = crew.routines().find((r) => r.kind === 'digest')!;
  crew.runRoutine(digest.id);
  const recap = crew.botPage('chief').messages.at(-1)!;
  assert.equal(recap.recap, true);
  assert.equal(recap.task_id, null);
  const answer = crew.botPage('chief').messages.find((m: any) => m.author === 'bot' && m.task_id === first!.task)!;
  assert.ok(answer, 'the ordinary answer stays in the thread');
  assert.doesNotMatch(answer.text, /While you were away|Everything is quiet/);
  assert.match(recap.text, /^Good \w+, Umer\. While you were away:/);
  assert.doesNotMatch(recap.text, /\.\./);
  crew.runRoutine(digest.id);
  assert.equal(crew.botPage('chief').messages.at(-1)!.id, recap.id, 'manual reruns keep one recap per day');
  db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 1000, digest.id);
  crew.schedule();
  assert.equal(crew.botPage('chief').messages.at(-1)!.id, recap.id, 'the tick also keeps one recap per day');
  const { Crew } = await import('../src/crew.ts');
  const restarted = new Crew(cfg, db);
  restarted.runRoutine(digest.id);
  assert.equal(restarted.botPage('chief').messages.at(-1)!.id, recap.id, 'a new crew reads the same daily record');
  db.run('UPDATE routines SET last_at = ? WHERE id = ?', Date.now() - 86_400_000, digest.id);
  restarted.runRoutine(digest.id);
  assert.ok(restarted.botPage('chief').messages.at(-1)!.id > recap.id, 'the following day gets its own recap');
  restarted.stop();
  done();
});

test('one morning digest reports the person’s routines in Chief’s thread', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Sam');
  const digests = db.all("SELECT * FROM routines WHERE kind = 'digest'");
  assert.equal(digests.length, 1);
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every day 9:00', task: "Sam's daily clip" }, 'person');
  assert.ok(crew.routines().some((x) => x.id === r.id));
  crew.runRoutine(r.id);
  const t = db.get('SELECT * FROM tasks WHERE routine = ?', r.id)!;
  await settled(db, t.id);
  crew.runRoutine(digests[0].id);
  const mine = db.get("SELECT * FROM messages WHERE bot = 'chief' AND author = 'bot' ORDER BY id DESC")!;
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
  assert.match((crew.runtime as any).specOf(db.get('SELECT session FROM tasks WHERE id = ?', first)!.session)?.message ?? '', /This is a check-in\. If nothing needs [^,]+, reply exactly ALL-CLEAR/);
  assert.deepEqual(said(), [], 'all clear: nothing in the thread');
  assert.equal(db.get('SELECT result FROM tasks WHERE id = ?', first)!.result, 'All clear');
  assert.equal(crew.routines().find((x) => x.id === r.id)!.history[0].clear, true);
  assert.doesNotMatch(crew.digest(0), /Finished:|Nothing new/, 'no all-clear result or negative filler in the digest');
  await run('Three new photos from Saturday are in the shared folder.');
  assert.deepEqual(said(), ['Three new photos from Saturday are in the shared folder.']);
  assert.match(crew.digest(0), /Finished: Reel/);
  crew.updateRoutine(r.id, { quiet: false });
  assert.equal(db.get('SELECT quiet FROM routines WHERE id = ?', r.id)!.quiet, 0);
  assert.throws(() => crew.updateRoutine(db.get("SELECT id FROM routines WHERE kind = 'digest'")!.id, { quiet: true }), /helper's routine/);
  done();
});

test('sleep: missed routines are named once in Chief\'s thread, and a working crew keeps idle sleep away', async () => {
  const { db, crew, done } = setup();
  const said = () => db.all("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND text LIKE 'The crew was off%'").map((m) => m.text);
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
  assert.match(said()[0], /tasks stopped\. Chief started “Deal check” once after the computer resumed\.$/);
  assert.equal(fired(db, r.id).at(-1).why, 'late');

  // Its run holds the machine awake; finishing lets it sleep again.
  await until('kept awake', () => awake.at(-1) === true);
  await release(crew, 'reel', 'Prices checked.');
  await until('allowed to sleep', () => awake.at(-1) === false);
  assert.deepEqual(awake, [true, false], 'one hold, one release');
  done();
});

test('the crew\'s share: routines wait for tomorrow once it is used up, what the person asks for still runs, and nothing faster than 15 minutes', async () => {
  const { db, crew, done } = setup();
  assert.throws(() => crew.addRoutine({ bot: 'reel', schedule: 'every 5 minutes', task: 'check' }, 'person'), /at most every 15 minutes/);
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every 15 minutes', task: 'check the prices', name: 'Deal check' }, 'person');
  assert.throws(() => crew.updateRoutine(r.id, { schedule: 'every minute' }), /at most every 15 minutes/);
  const before = process.env.CREWHOUSE_DAY_TOKENS;
  process.env.CREWHOUSE_DAY_TOKENS = '1'; // any turn at all uses up a Light share
  try {
    assert.deepEqual([crew.snapshot().share.choice, crew.snapshot().share.used], ['light', false]);
    const { task: asked } = (crew as any).addTask('reel', 'make the card', 'person', undefined);
    await settled(db, asked);
    assert.equal(state(db, asked), 'done');
    assert.ok(db.get('SELECT tokens FROM usage WHERE member = 1')!.tokens > 0, 'the turn was counted');
    assert.deepEqual([crew.snapshot().share.choice, crew.snapshot().share.used, crew.snapshot().share.week], ['light', true, 'most']);

    // An unattended run waits for local midnight, and Chief says so once.
    db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 1000, r.id);
    crew.schedule();
    const t = db.get('SELECT * FROM tasks WHERE routine = ? ORDER BY id DESC', r.id)!;
    await until('waiting for tomorrow', () => state(db, t.id) === 'paused');
    const wake = db.get('SELECT wake_at FROM tasks WHERE id = ?', t.id)!.wake_at;
    assert.equal(new Date(wake).getHours(), 0);
    assert.ok(wake > Date.now() && wake - Date.now() <= 86_400_000);
    const chief = () => db.all("SELECT text FROM messages WHERE bot = 'chief' AND text LIKE 'Chief stopped the routines%'");
    assert.equal(chief().length, 1);
    const reached = db.events().find((e) => e.kind === 'share.reached')!;
    assert.equal(reached.data.member, undefined);
    const second = crew.addRoutine({ bot: 'reel', schedule: 'every day 9:00', task: 'check again' }, 'person');
    db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 1000, second.id);
    crew.schedule();
    await until('second routine waiting for tomorrow', () => db.get('SELECT state FROM tasks WHERE routine = ?', second.id)?.state === 'paused');
    assert.equal(chief().length, 1, 'a member-free share event still suppresses the next notice that day');
    assert.equal(db.all("SELECT 1 FROM events WHERE kind = 'share.reached'").length, 1);
    const parked = crew.routines().find((x) => x.id === r.id)!.history[0];
    assert.doesNotMatch(A.routines(crew.snapshot()).find((x: any) => x.id === r.id)!.last, /Last ran/);
    assert.match(A.routines(crew.snapshot()).find((x: any) => x.id === r.id)!.last, /This job waits until tomorrow/);
    assert.equal(parked.state, 'paused');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'task.done' AND json_extract(data, '$.task') = ?", t.id)!.n, 0, 'no completion event for the phone');
    assert.equal(A.work(crew.snapshot()).some((w) => w.title === 'Deal check'), false, 'Home does not claim parked work is running');
    crew.runRoutine(r.id); // the person's tap resumes the parked job, rather than stacking a second one
    await settled(db, t.id);
    assert.equal(state(db, t.id), 'done');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'task.done' AND json_extract(data, '$.task') = ?", t.id)!.n, 1);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 1);
    assert.match(A.routines(crew.snapshot()).find((x: any) => x.id === r.id)!.last, /Last ran/);
    assert.equal(chief().length, 1);

    // A fresh Do it now also goes ahead above the share; no claim of completion while queued.
    crew.runRoutine(r.id);
    const direct = db.get('SELECT * FROM tasks WHERE routine = ? ORDER BY id DESC', r.id)!;
    assert.equal(direct.origin, 'routine.now');
    assert.doesNotMatch(A.routines(crew.snapshot()).find((x: any) => x.id === r.id)!.last, /Last ran/);
    await settled(db, direct.id);
    assert.equal(state(db, direct.id), 'done');

    // What the person asks for goes ahead anyway.
    const { task: again } = (crew as any).addTask('reel', 'one more card', 'person', undefined);
    await settled(db, again);
    assert.equal(state(db, again), 'done');

    // "As much as it needs" lifts it; a made-up choice is refused.
    assert.throws(() => crew.updatePerson({ share: 'lots' }), /light, normal or full/);
    crew.updatePerson({ share: 'full' });
    assert.deepEqual(crew.snapshot().share, { choice: 'full', used: false, week: null });
  } finally {
    if (before === undefined) delete process.env.CREWHOUSE_DAY_TOKENS; else process.env.CREWHOUSE_DAY_TOKENS = before;
  }
  done();
});

test('Do it now on a share-parked routine restarts the run clock: an hour-old task runs, and never fails with a false long-run', async () => {
  const { db, crew, done } = setup();
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every day 7:00', task: 'ask permission: check the deals', name: 'Deal check' }, 'person');
  const before = process.env.CREWHOUSE_DAY_TOKENS;
  process.env.CREWHOUSE_DAY_TOKENS = '1'; // any turn at all uses up a Light share
  try {
    // The person's own ask uses up the day's share, so the routine's own run parks for tomorrow.
    const { task: asked } = (crew as any).addTask('reel', 'make the card', 'person', undefined);
    await settled(db, asked);
    db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 1000, r.id);
    crew.schedule();
    const t = db.get('SELECT * FROM tasks WHERE routine = ? ORDER BY id DESC', r.id)!;
    await until('waiting for tomorrow', () => state(db, t.id) === 'paused');
    // In a real day the parked run began over an hour before the person taps Do it now: the routine fired that morning.
    db.run('UPDATE tasks SET created_at = ? WHERE id = ?', Date.now() - 2 * 3_600_000, t.id);
    crew.runRoutine(r.id); // the tap: the same task, run now, above the share (origin routine.now)
    await holding(crew, 'reel'); // the manual run is genuinely under way
    (crew as any).tick(); // the engine's own clock passes over it
    assert.equal(state(db, t.id), 'working', 'a manual run is a new run: its hour starts at the tap');
    await release(crew, 'reel', 'Prices checked.');
    await settled(db, t.id);
    assert.equal(state(db, t.id), 'done');
    assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'task.failed' AND json_extract(data, '$.task') = ?", t.id)!.n, 0,
      'no false "took longer than an hour" told to the person');
  } finally {
    if (before === undefined) delete process.env.CREWHOUSE_DAY_TOKENS; else process.env.CREWHOUSE_DAY_TOKENS = before;
  }
  done();
});

test('Do it now recovers a sign-in-parked routine once signed in, and refuses honestly while still signed out', async () => {
  const { db, crew, done } = setup();
  const keys = ['chatgpt', 'grok', 'copilot', 'openrouter', 'minimax', 'claude'];
  for (const k of keys) (crew.accounts as any).ready.set(k, false);
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every day 7:00', task: 'check the prices', name: 'Deal check' }, 'person');
  crew.runRoutine(r.id);
  const t = db.get('SELECT * FROM tasks WHERE routine = ?', r.id)!;
  await settled(db, t.id);
  assert.equal(state(db, t.id), 'paused');
  assert.match(db.get('SELECT result FROM tasks WHERE id = ?', t.id)!.result, /Waiting for you to sign in/);
  assert.match(A.routines(crew.snapshot()).find((x: any) => x.id === r.id)!.last, /Waiting for you to sign in/);

  // Still signed out: the tap retries the same task rather than stacking or silently skipping, and it waits again.
  crew.runRoutine(r.id);
  await settled(db, t.id);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 1, 'no second task stacked');
  assert.equal(fired(db, r.id).at(-1).kind, 'routine.fired', 'a manual retry, not a silent skip');
  assert.equal(fired(db, r.id).at(-1).task, t.id);
  assert.equal(state(db, t.id), 'paused');

  // Signed in since, with no sign-in event reaching it: the same tap runs the parked task.
  for (const k of keys) (crew.accounts as any).ready.delete(k);
  crew.runRoutine(r.id);
  await settled(db, t.id);
  assert.equal(state(db, t.id), 'done', 'the parked task runs once the account is back');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 1);
  assert.match(A.routines(crew.snapshot()).find((x: any) => x.id === r.id)!.last, /Last ran/);
  done();
});

test('a scheduled tick recovers a sign-in-parked routine once signed in, and stays quiet while signed out', async () => {
  const { db, crew, done } = setup();
  const keys = ['chatgpt', 'grok', 'copilot', 'openrouter', 'minimax', 'claude'];
  for (const k of keys) (crew.accounts as any).ready.set(k, false);
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every day 7:00', task: 'check the prices', name: 'Deal check' }, 'person');
  crew.runRoutine(r.id);
  const t = db.get('SELECT * FROM tasks WHERE routine = ?', r.id)!;
  await settled(db, t.id);
  assert.equal(state(db, t.id), 'paused');

  // Due while still signed out: nothing new runs, and the screen keeps its honest reason.
  db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 1000, r.id);
  crew.schedule();
  await sleep(100);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 1);
  assert.equal(state(db, t.id), 'paused');

  // Due once signed in: the parked task runs by itself.
  for (const k of keys) (crew.accounts as any).ready.delete(k);
  db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 1000, r.id);
  crew.schedule();
  await until('scheduled tick retries the parked task', () => state(db, t.id) !== 'paused');
  await settled(db, t.id);
  assert.equal(state(db, t.id), 'done');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 1);
  done();
});

test('money settings retain historical spend, but uncovered purchases remain unavailable at any cap', async () => {
  const { db, crew, done } = setup();
  crew.recruit('tracer', 'Tracer', 'person');
  const gate = (cost: number) => (crew as any).gate('tracer', 'people_search', { args: ['call', 'treg.people.phone.find', '--header', `X-Treg-Route-Max-Cost: ${cost}`] });
  assert.deepEqual(crew.snapshot().money, { cap: 20, spent: 0 });
  // A controlled older record remains accounting history; no purchase is executed here.
  db.event('money.spent', 'tracer', { amount: 15, month: new Date().toLocaleDateString('en-CA').slice(0, 7), ask: -1 });
  assert.deepEqual(crew.snapshot().money, { cap: 20, spent: 15 });
  for (const cost of [15, 10]) {
    const blocked = await gate(cost); assert.equal(blocked.block, true); assert.match(blocked.reason, /unavailable/);
  }
  assert.throws(() => crew.setMoneyCap(-1), /between/);
  crew.setMoneyCap(40);
  assert.equal((await gate(10)).block, true);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE bot = 'tracer'")!.n, 0);
  assert.equal(crew.snapshot().money!.spent, 15, 'a blocked request does not spend');
  done();
});
test('watches: crewd reads the page, says nothing and uses no AI while it is the same, and wakes the helper when it changes', async () => {
  const { createServer } = await import('node:http');
  let page = '<html><body><h1>Flats</h1><p>Rent: $950 a month</p><script>track()</script></body></html>';
  let up = true;
  const site = createServer((_q, res) => { if (!up) return void res.writeHead(503).end(); res.writeHead(200, { 'content-type': 'text/html' }).end(page); });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(site.address() as any).port}/listing`;
  const { db, crew, done } = setup();
  try {
    assert.throws(() => crew.addRoutine({ bot: 'reel', schedule: 'every hour', watch: 'file:///etc/passwd' }, 'person'), /starts with https/);
    const r = crew.addRoutine({ bot: 'reel', schedule: 'every hour', watch: url }, 'person');
    assert.equal(r.name, '127.0.0.1', 'a watch keeps the one word: routine; the line says "Keeps an eye on …"');
    assert.equal(r.quiet, 1, 'a watch is a quiet check-in');
    const prompts = () => db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'run.prompted'")!.n;
    const watched = async (n: number) => { await until(`check ${n}`, () => fired(db, r.id).length >= n); return fired(db, r.id).at(-1); };

    crew.runRoutine(r.id);
    assert.equal((await watched(1)).watch, 'started', 'the first look is the baseline');
    crew.runRoutine(r.id);
    assert.equal((await watched(2)).watch, 'same');
    assert.equal(prompts(), 0, 'nothing changed, so no AI was used');
    up = false;
    crew.runRoutine(r.id);
    assert.equal((await watched(3)).watch, 'unreachable');

    up = true;
    page = page.replace('$950', '$850');
    crew.runRoutine(r.id);
    const hit = await watched(4);
    assert.equal(hit.watch, 'changed');
    const t = db.get('SELECT * FROM tasks WHERE id = ?', hit.task)!;
    assert.match(t.body, /Before: .*\$950.*\nNow: .*\$850/);
    assert.doesNotMatch(t.body, /track\(\)/, 'readable text, not scripts');
    assert.doesNotMatch(db.get("SELECT text FROM messages WHERE task_id = ? AND author = 'system'", t.id)!.text, /\/listing|Before:/, 'the chat shows the routine, not the page address');
    await settled(db, t.id);
    assert.equal(state(db, t.id), 'done');
    assert.deepEqual(crew.routines().find((x) => x.id === r.id)!.history.map((h: any) => h.watch), ['changed', 'unreachable', 'same', 'started']);
  } finally { site.close(); }
  done();
});

test('tell me when something\'s wrong: a watched page that stays down is said once, and again when it\'s back', async () => {
  const { createServer } = await import('node:http');
  let up = false;
  const site = createServer((_q, res) => { if (!up) return void res.writeHead(500).end(); res.writeHead(200, { 'content-type': 'text/html' }).end('<p>Rent $950</p>'); });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const { db, crew, done } = setup();
  try {
    const r = crew.addRoutine({ bot: 'reel', schedule: 'every hour', watch: `http://127.0.0.1:${(site.address() as any).port}/`, name: 'Rentals' }, 'person');
    const lines = () => db.all("SELECT text FROM messages WHERE bot = 'reel' AND author = 'bot'").map((m) => m.text);
    const alerts = () => db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'alert'")!.n;
    const run = async (n: number) => { crew.runRoutine(r.id); await until(`check ${n}`, () => fired(db, r.id).length >= n); };
    await run(1);
    assert.deepEqual(lines(), [], 'one failure stays quiet');
    await run(2);
    assert.deepEqual(lines(), ["Chief could not open the page for “Rentals” on two attempts. The page may require a sign-in. Chief will continue the scheduled checks."]);
    await run(3);
    assert.equal(lines().length, 1, 'one line per outage, not per run');
    up = true;
    await run(4);
    assert.equal(lines().at(-1), "The page for “Rentals” opens again. Chief will continue the scheduled checks.");
    assert.equal(alerts(), 2, 'both lines reach the phone');
    await run(5);
    assert.equal(lines().length, 2);
  } finally { site.close(); }
  done();
});

test('failures reach Chief with their task identity; stopping adds no completion claim', async () => {
  const { db, crew, done } = setup();
  const timeOut = async (t: number) => {
    await until('working', () => state(db, t) === 'working');
    db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', Date.now() - 2 * 3_600_000, t);
    (crew as any).tick();
    await until('failed', () => state(db, t) === 'failed'); await settled(db, t);
  };
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every day 7:00', task: 'ask permission: check the deals', name: 'Deal check' }, 'person');
  crew.runRoutine(r.id);
  await timeOut(db.get('SELECT id FROM tasks WHERE routine = ?', r.id)!.id);
  assert.match(lastSaid(db, 'chief')!, /^Chief could not complete this task\.\nTask: “Deal check”\nThe task exceeded one hour\. Crewhouse stopped the task\.\nNext run: .*\.$/);
  const last = A.routines(crew.snapshot()).find((x: any) => x.id === r.id)!.last;
  assert.match(last, /^Did not finish: The task exceeded one hour\. Crewhouse stopped the task\.$/);
  assert.doesNotMatch(last, /Last ran|token|engine/);

  const { task: t } = (await crew.assign('reel', 'ask permission: make the card', 'chief'))!;
  await timeOut(t);
  assert.match(db.get("SELECT text FROM messages WHERE task_id = ? AND bot = 'chief' AND author = 'bot' ORDER BY id DESC", t)!.text, /Chief could not complete[\s\S]*The task exceeded one hour\. Crewhouse stopped the task\./);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'alert'")!.n, 2, 'both task failures emit one notification event each');

  const { task: s } = (await crew.assign('reel', 'ask permission: another card', 'chief'))!;
  await until('working', () => state(db, s) === 'working');
  await crew.resetBot('reel');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM messages WHERE task_id = ? AND author = 'bot'", s)!.n, 0, 'the person stopped it; no line');
  done();
});

test('the digest reads today\'s calendar itself once Calendar is connected, and the share has a weekly line in thirds', async () => {
  const { db, crew, cfg, done } = setup();
  const { signInApp } = await import('./connect-fixture.ts');
  const { CALENDAR } = await import('../src/connections.ts');
  await signInApp(crew.connections, 'calendar');
  const nine = new Date(); nine.setHours(9, 0, 0, 0);
  const real = globalThis.fetch;
  let asked = '';
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).startsWith(CALENDAR)) return real(url, init);
    asked = `${url} ${init?.headers?.authorization}`;
    return new Response(JSON.stringify({ items: [{ summary: 'Dentist', start: { dateTime: nine.toISOString() } }, { summary: 'Eid', start: { date: '2026-09-25' } }, { summary: 'Gone', status: 'cancelled', start: {} }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const d = crew.routines().find((x) => x.kind === 'digest')!;
    crew.runRoutine(d.id);
    await until('digest', () => /calendar/.test(lastSaid(db, 'chief') ?? ''));
    assert.match(asked, /calendars\/primary\/events\?.*singleEvents=true.* Bearer tok$/);
    assert.match(lastSaid(db, 'chief')!, /- Today on your calendar: 9:00 am, Dentist and Eid \(all day\)\./);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'run.prompted'")!.n, 0, 'no AI');
  } finally { globalThis.fetch = real; }

  // The week, in thirds of the share: never a number.
  const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toLocaleDateString('en-CA');
  const budget = 2_000_000 * 0.25 * 7;
  db.run('INSERT INTO usage (member, day, tokens) VALUES (1, ?, ?)', day(2), Math.round(budget * 0.2));
  assert.equal(crew.snapshot().share.week, 'small');
  db.run('INSERT INTO usage (member, day, tokens) VALUES (1, ?, ?)', day(3), Math.round(budget * 0.3));
  assert.equal(crew.snapshot().share.week, 'fair');
  db.run('INSERT INTO usage (member, day, tokens) VALUES (1, ?, ?)', day(9), Math.round(budget * 5));
  assert.equal(crew.snapshot().share.week, 'fair', 'older than a week does not count');
  crew.updatePerson({ share: 'full' });
  assert.equal(crew.snapshot().share.week, null);
  done();
});

test('a public helper follow-up reaches Chief with helper context, not an implicit send approval', async () => {
  const { db, crew, done } = setup();
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every day 7:00', task: 'draft the weekly post', name: 'Weekly post' }, 'person');
  crew.runRoutine(r.id);
  const first = db.get('SELECT id FROM tasks WHERE routine = ?', r.id)!.id;
  await settled(db, first);
  const { task: t } = (await crew.post('reel', 'OK, post it'))!;
  assert.equal(task(db, t).bot, 'chief');
  assert.match(task(db, t).body, /About Reel's work/);
  assert.match(task(db, t).body, /OK, post it/);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE answer IS NOT NULL")!.n, 0, 'words are not card approval');
  await settled(db, t);
  done();
});

const snap = (total: string, extra = '') => `### Page state
- Page URL: https://www.shop.example/checkout/review?cart=123&token=abc
- Page Snapshot:
\`\`\`yaml
- main [ref=e1]:
  - heading "Review your order" [level=1] [ref=e2]
  - list [ref=e3]:
    - listitem [ref=e4]: Garlic, 2 kg — $6.20
    - listitem [ref=e5]: "Whole milk (1 gal) x2 — $7.90"
    - listitem "Basmati rice 10 lb" [ref=e6]: $24.00
${extra}  - text: "Subtotal: $38.10"
  - text: "Delivery fee: $5.00"
  - text: "Estimated tax: $0.00"
  - text: "Estimated total: ${total}"
  - button "Place order" [ref=e9]
\`\`\``;

test('checkout context comes from the page; uncovered execution never spends or creates an actionable card', async () => {
  const { orderOf } = await import('../src/policy.ts');
  assert.deepEqual(orderOf(snap('$43.10')), {
    items: ['Garlic, 2 kg — $6.20', 'Whole milk (1 gal) x2 — $7.90', 'Basmati rice 10 lb $24.00'], more: 0, total: 43.1, shown: '$43.10', currency: '$', capped: true });
  assert.equal(orderOf('- text: nothing here').total, null);
  const gbp = orderOf('- text: "Order total: £1,204.50"');
  assert.equal(gbp.total, 1204.5);
  assert.equal(gbp.capped, false, 'a pound price is shown as pounds, never counted as dollars');

  const { db, crew, done } = setup();
  crew.setMoneyCap(100);
  crew.recruit('scout', 'Scout', 'person');
  const { task: t } = (await crew.assign('scout', 'ask permission: buy the groceries', 'chief'))!;
  await until('working', () => crew.sessionOf('scout'));
  const live = (crew as any).live.get('scout');
  live.page = 'https://www.shop.example/checkout/review?cart=123&token=abc';
  const click = () => (crew as any).gate('scout', 'browser', { args: ['click', 'e9'] });
  const open = () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'");

  live.snapshot = snap('$43.10');
  const order = (crew as any).order('scout', { kind: 'spend', words: 'Place order' });
  assert.equal(order.effect.words, 'Scout wants to place this order at shop.example: Garlic, 2 kg, Whole milk (1 gal) x2, Basmati rice 10 lb. Total $43.10.');
  assert.equal(order.effect.preview.body, 'Garlic, 2 kg — $6.20\nWhole milk (1 gal) x2 — $7.90\nBasmati rice 10 lb $24.00\nTotal $43.10');
  assert.doesNotMatch(JSON.stringify(order.effect), /checkout\/|cart=|token/);
  for (const total of ['$43.10', '$43.10', '$60.00']) {
    live.snapshot = snap(total);
    const blocked = await click();
    assert.equal(blocked.block, true); assert.match(blocked.reason, /unavailable/);
    assert.equal(open(), undefined, 'no card offers uncovered purchase execution');
    assert.equal(crew.snapshot().money!.spent, 0, 'refusal is not money spent');
  }
  live.snapshot = '- Page Snapshot:\n- button "Pay" [ref=e1]';
  assert.equal((crew as any).order('scout', { kind: 'spend', words: 'Pay' }).effect.words, "Scout wants to act on a checkout page at shop.example. I couldn't read the total on this page.");
  assert.equal((await click()).block, true);
  await release(crew, 'scout', 'The basket was prepared; it was not purchased.'); await settled(db, t);
  done();
});

test('trigger words: parse, describe, reject', () => {
  const files: [string, string][] = [
    ['when a file arrives in the inbox', "When a file arrives in Reel's inbox"],
    ['when photos land in the inbox', "When a file arrives in Reel's inbox"],
    ['when a receipt is added', "When a file arrives in Reel's inbox"],
  ];
  for (const [text, words] of files) assert.equal(describeTrigger(parseTrigger(text), 'Reel'), words, text);
  assert.equal(describeTrigger(parseTrigger('when this computer wakes up'), 'Reel'), 'When this computer wakes up');
  assert.equal(describeTrigger(parseTrigger('when my laptop wakes'), 'Reel'), 'When this computer wakes up');
  // The card's own words read back.
  assert.equal(describeTrigger(parseTrigger("When a file arrives in Reel's inbox"), 'Reel'), "When a file arrives in Reel's inbox");
  for (const text of ['', 'every Monday 9:00', 'whenever', 'when I wake up', 'when it rains']) assert.throws(() => parseTrigger(text), /can't start anything/, text);
});

test('event triggers: a file arriving in the inbox starts the chore once; waking starts wake chores', async () => {
  const { db, crew, cfg, done } = setup();
  assert.throws(() => crew.addRoutine({ bot: 'reel', on: 'whenever', task: 'x' }, 'person'), /can't start anything/);
  assert.throws(() => crew.addRoutine({ bot: 'reel', task: 'x' }, 'person'), /say when it should run/);
  const file = crew.addRoutine({ bot: 'reel', on: 'when a file arrives in the inbox', task: 'ask permission: file the new receipt', name: 'Receipts' }, 'person');
  assert.equal(file.schedule, '', 'a trigger-only routine keeps no time');
  assert.equal(file.next_at, null);
  assert.equal(crew.routines().find((x) => x.id === file.id)!.on, "When a file arrives in Reel's inbox");
  assert.equal(crew.routines().find((x) => x.id === file.id)!.words, '');
  const shown = A.routines(crew.snapshot()).find((x: any) => x.id === file.id)!;
  assert.equal(shown.on, "When a file arrives in Reel's inbox");
  assert.equal(shown.next, '', 'no time, no next date');
  const both = crew.addRoutine({ bot: 'reel', schedule: 'every day 7:00', on: 'when a file arrives in the inbox', task: 'sort it', name: 'Both' }, 'person');
  assert.equal(crew.routines().find((x) => x.id === both.id)!.words, 'Every day at 7:00 am');
  crew.deleteRoutine(both.id);
  const wake = crew.addRoutine({ bot: 'reel', on: 'when this computer wakes up', task: 'ask permission: say good morning', name: 'Wake up' }, 'person');

  // The first tick only learns what is already there: nothing starts.
  crew.schedule();
  assert.equal(fired(db, file.id).length, 0);

  // A file lands in the helper's inbox: the chore starts once, naming the file.
  writeFileSync(join(crew.inbox('reel'), 'receipt.jpg'), 'x');
  crew.schedule();
  let h = fired(db, file.id);
  assert.equal(h.length, 1);
  assert.equal(h[0].why, 'file');
  const t = db.get('SELECT * FROM tasks WHERE id = ?', h[0].task)!;
  assert.match(t.body, /receipt\.jpg/);
  assert.doesNotMatch(t.body, /\blab-|\/state\//, 'basenames, never paths');
  await until('holding', () => crew.sessionOf('reel'));

  // Another file while it runs: skipped, not stacked.
  writeFileSync(join(crew.inbox('reel'), 'receipt2.jpg'), 'x');
  crew.schedule();
  h = fired(db, file.id);
  assert.equal(h.at(-1).kind, 'routine.skipped');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', file.id)!.n, 1);
  await release(crew, 'reel', 'Receipt filed.');
  await settled(db, t.id);
  assert.equal(state(db, t.id), 'done');

  // Waking the computer starts the wake chore, and nothing else.
  crew.slept(Date.now() - 3_600_000, Date.now());
  const w = fired(db, wake.id);
  assert.equal(w.length, 1);
  assert.equal(w[0].why, 'wake');
  assert.equal(fired(db, file.id).length, 2, 'no file arrived: no second start');
  await release(crew, 'reel', 'Good morning.');
  await settled(db, w[0].task);

  // Paused triggers stay off; a file still waiting when it resumes starts it.
  crew.updateRoutine(file.id, { state: 'paused' });
  writeFileSync(join(crew.inbox('reel'), 'receipt3.jpg'), 'x');
  crew.schedule();
  assert.equal(fired(db, file.id).length, 2);
  crew.updateRoutine(file.id, { state: 'on' });
  crew.schedule();
  assert.equal(fired(db, file.id).length, 3);
  const last = db.get('SELECT * FROM tasks WHERE id = ?', fired(db, file.id).at(-1).task)!;
  assert.match(last.body, /receipt3\.jpg/);
  await release(crew, 'reel', 'Filed.');
  await settled(db, last.id);
  done();
});

test('a helper offers an event chore on a card, and nothing runs until the person starts it', async () => {
  const { db, crew, done } = setup();
  const { task } = await (crew as any).assign('reel', `[tool crew_routine ${JSON.stringify({ on: 'when photos land in the inbox', task: 'tidy the new photos' })}]`, 'chief');
  await until('the card', () => db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'"));
  const card = db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'")!;
  const preview = JSON.parse(card.detail).preview.body as string;
  assert.match(preview, /When a file arrives in Reel's inbox/);
  assert.doesNotMatch(preview, /First time/, 'no time, no first run');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM routines WHERE kind = 'task'")!.n, 0, 'nothing runs until the person says yes');
  await crew.answer(card.id, { answer: 'allow' });
  await settled(db, task);
  const r = db.get("SELECT * FROM routines WHERE bot = 'reel' AND kind = 'task'")!;
  assert.equal(r.schedule, '');
  assert.equal(r.trigger, 'when photos land in the inbox');
  assert.equal(crew.routines().find((x) => x.id === r.id)!.on, "When a file arrives in Reel's inbox");
  done();
});

test('a failed trigger-only routine says so with no time to try again', async () => {
  const { db, crew, done } = setup();
  const r = crew.addRoutine({ bot: 'reel', on: 'when this computer wakes up', task: 'ask permission: say good morning', name: 'Wake up' }, 'person');
  crew.runRoutine(r.id);
  const t = db.get('SELECT id FROM tasks WHERE routine = ?', r.id)!.id;
  await holding(crew, 'reel');
  db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', Date.now() - 2 * 3_600_000, t);
  (crew as any).tick();
  await until('failed', () => state(db, t) === 'failed'); await settled(db, t);
  assert.match(lastSaid(db, 'chief')!, /^Chief could not complete this task\.\nTask: “Wake up”\nThe task exceeded one hour\. Crewhouse stopped the task\.$/);
  done();
});

test('not now, remind me tomorrow: the question comes back once, then the reminder is gone', async () => {
  const { db, crew, done } = setup();
  const ask = (title: string) => Number(db.run("INSERT INTO asks (bot, kind, title, detail, at) VALUES ('reel', 'permission', ?, '{}', ?)", title, Date.now()).lastInsertRowid);

  // A plain Not now files nothing.
  await crew.answer(ask('Reel wants to look through your Pictures folder.'), { answer: 'deny' });
  assert.equal(db.get("SELECT COUNT(*) AS n FROM routines WHERE kind = 'once'")!.n, 0);

  // "Remind me tomorrow" files a one-shot routine for tomorrow at 9, on the asker's own side.
  const id = ask('Reel wants to change a file in your Documents folder.');
  await crew.answer(id, { answer: 'deny', remind: true });
  const r = db.get("SELECT * FROM routines WHERE kind = 'once'")!;
  assert.equal(r.bot, 'reel');
  assert.equal(r.member, 1);
  assert.equal(r.schedule, '', 'no repeating schedule: the time lives in next_at alone');
  assert.equal(r.trigger, null);
  const at = new Date(r.next_at);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  assert.equal(at.toDateString(), tomorrow.toDateString());
  assert.equal(at.getHours(), 9);
  assert.match(r.body, /Raise it with them again now/);
  assert.equal(db.get('SELECT state FROM asks WHERE id = ?', id)!.state, 'answered');

  // Not due yet: nothing happens.
  crew.schedule();
  assert.equal(db.get("SELECT COUNT(*) AS n FROM tasks WHERE routine = ?", r.id)!.n, 0);

  // Due: the helper gets the question back as a task, and the reminder is gone.
  db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 1000, r.id);
  crew.schedule();
  assert.equal(db.get('SELECT COUNT(*) AS n FROM routines WHERE id = ?', r.id)!.n, 0, 'one-shot: gone as it fires');
  const t = db.get('SELECT * FROM tasks WHERE routine = ?', r.id)!;
  assert.equal(t.origin, 'routine');
  assert.equal(t.member, 1);
  assert.match(t.body, /Documents folder/);
  assert.match(t.body, /Raise it with them again now/);
  await settled(db, t.id);

  // A later tick never raises it twice.
  crew.schedule();
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks WHERE routine = ?', r.id)!.n, 1);
  done();
});
