// Routines: plain-words schedules, next run, catch-up after sleep, overlap, pause, the morning digest. No CLI, no quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup as lab, settled, release, until, lastSaid } from './lab.ts';
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

test('the crew\'s share: routines wait for tomorrow once it is used up, what the person asks for still runs, and nothing faster than 15 minutes', async () => {
  const { db, crew, done } = setup();
  assert.throws(() => crew.addRoutine({ bot: 'reel', schedule: 'every 5 minutes', task: 'check' }, 'person'), /at most every 15 minutes/);
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every 15 minutes', task: 'check the prices', name: 'Deal check' }, 'person');
  assert.throws(() => crew.updateRoutine(r.id, { schedule: 'every minute' }), /at most every 15 minutes/);
  const before = process.env.CREWHOUSE_DAY_TOKENS;
  process.env.CREWHOUSE_DAY_TOKENS = '1'; // any turn at all uses up a Light share
  try {
    assert.deepEqual([crew.snapshot().share.choice, crew.snapshot().share.used], ['light', false]);
    const { task: asked } = (crew as any).addTask('reel', 'make the card', 'person', undefined, 1);
    await settled(db, asked);
    assert.equal(state(db, asked), 'done');
    assert.ok(db.get('SELECT tokens FROM usage WHERE member = 1')!.tokens > 0, 'the turn was counted');
    assert.deepEqual([crew.snapshot().share.choice, crew.snapshot().share.used, crew.snapshot().share.week], ['light', true, 'most']);

    // The routine's run waits for local midnight, and Chief says so once.
    crew.runRoutine(r.id);
    const t = db.get('SELECT * FROM tasks WHERE routine = ? ORDER BY id DESC', r.id)!;
    await until('waiting for tomorrow', () => state(db, t.id) === 'paused');
    const wake = db.get('SELECT wake_at FROM tasks WHERE id = ?', t.id)!.wake_at;
    assert.equal(new Date(wake).getHours(), 0);
    assert.ok(wake > Date.now() && wake - Date.now() <= 86_400_000);
    const chief = () => db.all("SELECT text FROM messages WHERE bot = 'chief' AND text LIKE 'I''ve stopped the routines%'");
    assert.equal(chief().length, 1);
    crew.runRoutine(r.id); // still waiting: skipped, not stacked, and no second word from Chief
    assert.equal(chief().length, 1);

    // What the person asks for goes ahead anyway.
    const { task: again } = (crew as any).addTask('reel', 'one more card', 'person', undefined, 1);
    await settled(db, again);
    assert.equal(state(db, again), 'done');

    // "As much as it needs" lifts it; a made-up choice is refused.
    assert.throws(() => crew.updateMember(1, { share: 'lots' }), /light, normal or full/);
    crew.updateMember(1, { share: 'full' });
    assert.deepEqual(crew.snapshot().share, { choice: 'full', used: false, week: null });
  } finally {
    if (before === undefined) delete process.env.CREWHOUSE_DAY_TOKENS; else process.env.CREWHOUSE_DAY_TOKENS = before;
  }
  done();
});

test('money cap: each spend still asks, and past the month\'s cap the crew cannot spend at all', async () => {
  const { db, crew, done } = setup();
  crew.recruit('tracer', 'Tracer', 'person');
  const gate = (cost: number) => (crew as any).gate('tracer', 'people_search', { args: ['call', 'treg.people.phone.find', '--header', `X-Treg-Route-Max-Cost: ${cost}`] });
  assert.deepEqual(crew.snapshot().money, { cap: 20, spent: 0 });
  assert.equal(crew.snapshot(2 as any).money?.cap, 20, 'an unknown viewer is shown as the owner');
  crew.addMember('Sara');
  assert.equal(crew.snapshot(2).money, undefined, 'only the owner sees the money');

  const first = gate(15);
  await until('asked', () => db.get("SELECT id FROM asks WHERE bot = 'tracer' AND state = 'open'"));
  const ask = db.get("SELECT * FROM asks WHERE bot = 'tracer' AND state = 'open'")!;
  assert.equal(JSON.parse(ask.detail).cost, 15);
  await crew.answer(ask.id, { answer: 'allow' });
  assert.equal(await first, undefined, 'the yes lets it through');
  assert.deepEqual(crew.snapshot().money, { cap: 20, spent: 15 });

  // $15 + $10 would pass $20: refused at once, no card.
  const refused = await gate(10);
  assert.equal(refused.block, true);
  assert.match(refused.reason, /past the \$20 the household set/);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE bot = 'tracer'")!.n, 1);

  assert.throws(() => crew.setMoneyCap(-1), /between/);
  crew.setMoneyCap(40);
  const later = gate(10);
  await until('asked again', () => db.get("SELECT id FROM asks WHERE bot = 'tracer' AND state = 'open'"));
  await crew.answer(db.get("SELECT id FROM asks WHERE bot = 'tracer' AND state = 'open'")!.id, { answer: 'deny' });
  assert.equal((await later).block, true);
  assert.equal(crew.snapshot().money!.spent, 15, 'a no spends nothing');
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
    assert.equal(r.name, 'Watch 127.0.0.1');
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
    assert.deepEqual(lines(), ["I couldn't open the page for “Rentals” twice now. It may be down, or need a sign-in. I'll keep trying, and tell you when it works again."]);
    await run(3);
    assert.equal(lines().length, 1, 'one line per outage, not per run');
    up = true;
    await run(4);
    assert.equal(lines().at(-1), "The page for “Rentals” opens again. I'm back to keeping an eye on it.");
    assert.equal(alerts(), 2, 'both lines reach the phone');
    await run(5);
    assert.equal(lines().length, 2);
  } finally { site.close(); }
  done();
});

test('tell me when something\'s wrong: a routine that fails says so in Chief\'s thread, anything else in its own chat; stopping says nothing', async () => {
  const { db, crew, done } = setup();
  const timeOut = async (t: number) => {
    await until('working', () => state(db, t) === 'working');
    db.run('UPDATE tasks SET created_at = ? WHERE id = ?', Date.now() - 2 * 3_600_000, t);
    (crew as any).tick();
    await until('failed', () => state(db, t) === 'failed');
  };
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every day 7:00', task: 'ask permission: check the deals', name: 'Deal check' }, 'person');
  crew.runRoutine(r.id);
  await timeOut(db.get('SELECT id FROM tasks WHERE routine = ?', r.id)!.id);
  assert.match(lastSaid(db, 'chief')!, /^Reel couldn't finish “Deal check”\. Took longer than an hour, so I stopped it\. It will try again .*\.$/);

  const { task: t } = (await crew.post('reel', 'ask permission: make the card'))!;
  await timeOut(t);
  assert.equal(db.get("SELECT text FROM messages WHERE task_id = ? AND author = 'bot' ORDER BY id DESC", t)!.text, 'Took longer than an hour, so I stopped it.');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'alert'")!.n, 1, 'the chat line reaches the phone');

  const { task: s } = (await crew.post('reel', 'ask permission: another card'))!;
  await until('working', () => state(db, s) === 'working');
  await crew.resetBot('reel');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM messages WHERE task_id = ? AND author = 'bot'", s)!.n, 0, 'the person stopped it; no line');
  done();
});

test('the digest reads today\'s calendar itself once Calendar is connected, and the share has a weekly line in thirds', async () => {
  const { db, crew, cfg, done } = setup();
  const { mkdirSync: mk, writeFileSync: wf } = await import('node:fs');
  const { join: j } = await import('node:path');
  const { CALENDAR } = await import('../src/connections.ts');
  mk(j(cfg.stateDir, 'people', '1'), { recursive: true });
  wf(j(cfg.stateDir, 'people', '1', 'connections.json'), JSON.stringify({ calendar: { access: 'tok', expires: Date.now() + 3_600_000 } }));
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
  crew.updateMember(1, { share: 'full' });
  assert.equal(crew.snapshot().share.week, null);
  done();
});

test('a new job in a chat carries the chat\'s last line, so "OK, post it" knows what "it" is', async () => {
  const { db, crew, done } = setup();
  const r = crew.addRoutine({ bot: 'reel', schedule: 'every day 7:00', task: 'draft the weekly post', name: 'Weekly post' }, 'person');
  crew.runRoutine(r.id);
  const first = db.get('SELECT id FROM tasks WHERE routine = ?', r.id)!.id;
  await settled(db, first);
  const { task: t } = (await crew.post('reel', 'OK, post it'))!;
  const prompt = (crew as any).prompt(db.get('SELECT * FROM tasks WHERE id = ?', t));
  assert.match(prompt, /Your last message in this chat, which this may answer: “stub reel: done with "draft the weekly post"”/);
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

test('the checkout card is read from the page: items and total as the page writes them, one yes per page and total, and the cap holds', async () => {
  const { orderOf } = await import('../src/policy.ts');
  assert.deepEqual(orderOf(snap('$43.10')), {
    items: ['Garlic, 2 kg — $6.20', 'Whole milk (1 gal) x2 — $7.90', 'Basmati rice 10 lb $24.00'], more: 0, total: 43.1, shown: '$43.10' });
  assert.equal(orderOf('- text: nothing here').total, null);
  assert.equal(orderOf('- text: "Order total: £1,204.50"').total, 1204.5);

  const { db, crew, done } = setup();
  crew.setMoneyCap(100);
  crew.recruit('scout', 'Scout', 'person');
  const { task: t } = (await crew.post('scout', 'ask permission: buy the groceries'))!;
  await until('working', () => crew.sessionOf('scout'));
  const live = (crew as any).live.get('scout');
  live.page = 'https://www.shop.example/checkout/review?cart=123&token=abc';
  const click = () => (crew as any).gate('scout', 'browser_click', { element: 'Place order', ref: 'e9' });
  const open = () => db.get("SELECT * FROM asks WHERE bot = 'scout' AND state = 'open'");

  live.snapshot = snap('$43.10');
  const first = click();
  await until('asked', open);
  const card = crew.snapshot().asks.find((a: any) => a.id === open()!.id)!;
  assert.equal(card.detail.words, 'Scout wants to place this order at shop.example: Garlic, 2 kg, Whole milk (1 gal) x2, Basmati rice 10 lb. Total $43.10.');
  assert.equal(card.detail.preview.body, 'Garlic, 2 kg — $6.20\nWhole milk (1 gal) x2 — $7.90\nBasmati rice 10 lb $24.00\nTotal $43.10');
  assert.doesNotMatch(JSON.stringify(card.detail), /checkout\/|cart=|token/, 'the host only, never the path or query');
  await crew.answer(open()!.id, { answer: 'allow' });
  assert.equal(await first, undefined);
  assert.equal(crew.snapshot().money!.spent, 43.1, 'the total counts toward the cap');
  assert.equal(await click(), undefined, 'the same page and total: the yes covers the next click');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE bot = 'scout'")!.n, 1);

  // The total changed: asked again. Past the cap: refused before it asks.
  live.snapshot = snap('$60.00');
  const over = await click();
  assert.equal(over.block, true);
  assert.match(over.reason, /past the \$100/);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE bot = 'scout'")!.n, 1);

  // A page whose total can't be read: said plainly, and it doesn't count.
  live.snapshot = '- Page Snapshot:\n- button "Pay" [ref=e1]';
  const unread = click();
  await until('asked again', open);
  assert.equal(open()!.title, "Scout wants to act on a checkout page at shop.example. I couldn't read the total on this page.");
  await crew.answer(open()!.id, { answer: 'deny' });
  assert.equal((await unread).block, true);
  assert.equal(crew.snapshot().money!.spent, 43.1);
  await release(crew, 'scout', 'Done shopping.');
  await settled(db, t);
  done();
});
