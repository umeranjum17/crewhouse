// One person per install: backup first, atomic live split, no file moves or credential changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { setup, until } from './lab.ts';
import { Store } from '../src/db.ts';
import { Crew } from '../src/crew.ts';

function seed() {
  const lab = setup();
  lab.crew.stop();
  const { db, cfg } = lab;
  db.run("UPDATE people SET name = 'Umer', address = 'sir', onboarded = 1, quiet = '22:00-07:00', share = 'normal' WHERE id = 1");
  db.run("INSERT INTO people (id, name) VALUES (2, 'Former person')");
  db.run('UPDATE bots SET member = 2');
  const put = (rel: string, words: string) => { const path = join(lab.root, rel); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, words); return path; };
  const files = [
    'crew/people/1/about.md', 'crew/people/1/notes/chief.md', 'crew/people/2/about.md',
    'state/people/1/connections.json', 'state/people/2/connections.json',
    'state/people/1/engine/auth.json', 'state/people/2/engine/auth.json',
    'state/openclaw/state/agents/m1/agent/auth-profiles.json', 'state/openclaw/state/agents/m2/agent/auth-profiles.json',
    'state/openclaw/workspaces/m1/keep.txt', 'state/openclaw/workspaces/m2/keep.txt',
  ].map((rel) => put(rel, rel.endsWith('.json') ? '{}' : `private ${rel}\n`));
  db.run("INSERT INTO tasks (id, bot, state, member, session) VALUES (1, 'chief', 'done', 1, 'agent:m1:crewhouse:chief:1')");
  for (const [id, state] of [[2, 'queued'], [3, 'working'], [4, 'paused']] as const)
    db.run("INSERT INTO tasks (id, bot, state, member, session) VALUES (?, 'chief', ?, 2, ?)", id, state, `agent:m2:crewhouse:chief:${id}`);
  db.run("INSERT INTO asks (id, bot, kind, detail, member) VALUES (1, 'chief', 'propose', '{}', 1), (2, 'chief', 'permission', '{}', 2), (3, 'chief', 'setup', '{}', 1)");
  db.run("UPDATE routines SET next_at = ? WHERE member = 1", Date.now() + 86_400_000);
  db.run("INSERT INTO routines (id, bot, name, schedule, watch, member) VALUES (2, 'chief', 'former watch', 'every day 9:00', 'http://127.0.0.1/', 2)");
  const baseline = put('crew/bots/chief/work/watch/2.txt', 'former private page');
  db.run("INSERT INTO messages (bot, author, text, member) VALUES ('chief', 'person', 'mine', 1), ('chief', 'bot', 'shared', NULL), ('chief', 'person', 'former private', 2)");
  db.run("INSERT OR REPLACE INTO reads VALUES (1, 'chief', 1), (2, 'chief', 3)");
  db.run("INSERT INTO usage VALUES (1, '2026-09-30', 23), (2, '2026-09-30', 42)");
  db.run("INSERT INTO devices (id, pk, role, member) VALUES ('mine', 'mine-key', 'control', 1), ('former', 'former-key', 'control', 2)");
  for (const [key, value] of Object.entries({ 'memory.limited.1': 'true', 'push.held.1': '1', 'phone.push.mine': 'ExponentPushToken[mine]', 'phone.push.former': 'ExponentPushToken[former]', 'phone.offer.1': JSON.stringify({ message: 1, member: 2 }) }))
    db.run('INSERT INTO settings (key, value) VALUES (?, ?)', key, value);
  db.event('learn.applied', 'chief', { task: 0, member: 2, skill: 'former private skill' });
  db.event('desktop.giveback', 'chief', { member: 2, note: 'former private card' });
  db.event('run.call', 'chief', { task: 2 });
  db.event('net.refused', 'chief', { member: 2, to: 'https://private.example/' });
  db.event('routine.fired', 'chief', { routine: 2, watch: 'changed' });
  db.event('task.done', 'chief', { task: 2 });
  const now = new Date();
  db.event('money.spent', 'chief', { ask: 2, amount: 12, month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` });
  db.event('money.cap', null, { cap: 50 });
  db.event('task.done', 'chief', { task: 1 });
  const rows = () => Object.fromEntries(['people', 'tasks', 'routines', 'messages', 'reads', 'usage', 'asks', 'devices'].map((table) => [table,
    db.all(`SELECT * FROM ${table} WHERE ${table === 'people' ? 'id = 1' : table === 'messages' ? 'member = 1 OR member IS NULL' : table === 'asks' ? 'id = 1' : 'member = 1'}`)]));
  return { ...lab, files, baseline, rows };
}

test('upgrade preserves the person, spending and all files; former live actors and private events leave together', async () => {
  const { db, cfg, files, baseline, rows } = seed();
  db.event('bot.settings', 'chief', { by: 'person' });
  db.event('system.slept', null, { from: 10, to: 20 });
  db.event('money.spent', 'chief', { ask: 999, amount: 0 });
  const unassigned = db.all("SELECT * FROM events WHERE kind IN ('bot.settings', 'system.started', 'system.slept') OR (kind = 'money.spent' AND json_extract(data, '$.ask') = 999)");
  const before = rows();
  const bytes = files.map((f) => readFileSync(f));
  const settings = db.all("SELECT * FROM settings WHERE key != 'phone.offer.1'");
  const spent = new Crew(cfg, db).spentThisMonth();
  assert.equal(spent, 12, 'this month’s spending is present before the split');
  // An interrupted VACUUM copy must not be mistaken for a finished backup.
  const backup = join(cfg.stateDir, 'crew-before-one-person.db');
  writeFileSync(`${backup}.part`, 'interrupted');
  writeFileSync(`${backup}.part-journal`, 'interrupted');
  db.single(cfg);
  assert.ok(existsSync(backup));
  assert.ok(!existsSync(`${backup}.part`) && !existsSync(`${backup}.part-journal`));
  assert.deepEqual(db.all("SELECT * FROM events WHERE seq IN (" + unassigned.map((e) => e.seq).join(',') + ")"), unassigned, 'member-less bot, crew-wide and spending events survive byte-for-byte');
  const saved = new DatabaseSync(backup, { readOnly: true });
  assert.equal(saved.prepare('SELECT COUNT(*) AS n FROM people').get()!.n, 2);
  assert.equal(saved.prepare('SELECT COUNT(*) AS n FROM tasks WHERE member = 2').get()!.n, 3);
  assert.equal(saved.prepare("SELECT value FROM settings WHERE key = 'phone.offer.1'").get()!.value, '{"message":1,"member":2}');
  saved.close();
  assert.deepEqual(rows(), before);
  assert.deepEqual(db.all("SELECT * FROM settings WHERE key != 'phone.offer.1'"), settings);
  assert.equal(db.get("SELECT value FROM settings WHERE key = 'phone.offer.1'")!.value, '{"message":1}');
  files.forEach((f, i) => assert.deepEqual(readFileSync(f), bytes[i], f));
  for (const table of ['tasks', 'routines', 'messages', 'reads', 'usage', 'asks', 'devices'])
    assert.equal(db.get(`SELECT 1 FROM ${table} WHERE member = 2`), undefined, table);
  assert.equal(db.get('SELECT 1 FROM people WHERE id = 2'), undefined);
  assert.ok(db.all('SELECT member FROM bots').every((b) => b.member === 1));
  assert.ok(!JSON.stringify(db.events()).includes('former private'));
  assert.ok(!db.events().some((e) => ['run.call', 'net.refused', 'desktop.giveback'].includes(e.kind)));
  assert.equal(db.events().find((e) => e.kind === 'money.spent')!.data.ask, undefined);
  assert.equal(new Crew(cfg, db).spentThisMonth(), spent);
  assert.equal(readFileSync(`${baseline}.before-one-person`, 'utf8'), 'former private page');
  assert.ok(!existsSync(baseline));
  const all = () => db.all("SELECT name FROM sqlite_master WHERE type = 'table'").map(({ name }) => db.all(`SELECT * FROM ${name}`));
  const snapshot = all(); const backupTime = statSync(backup).mtimeMs;
  db.single(cfg);
  assert.deepEqual(all(), snapshot, 'second split is a no-op');
  assert.equal(statSync(backup).mtimeMs, backupTime);

  const crew = new Crew(cfg, db);
  const staged: [number, string][] = [];
  Object.assign(crew.runtime, { migrate: async (member: number, path: string) => { staged.push([member, path]); return false; }, confirm: async () => false });
  try {
    crew.init();
    await until('legacy staging', () => staged.length === 1);
    assert.deepEqual(staged, [[1, join(cfg.stateDir, 'people', '1', 'engine', 'auth.json')]]);
    assert.deepEqual(rows(), before, 'boot does not rewrite the person’s retained rows');
    assert.equal(db.get("SELECT state FROM asks WHERE id = 3")!.state, 'withdrawn', 'obsolete setup ask closes on boot');
    assert.equal(db.get("SELECT 1 FROM events WHERE kind IN ('alert', 'task.failed', 'run.started')"), undefined);
    const site = createServer((_q, r) => r.end('<p>fresh page</p>'));
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
    try {
      const id = Number(db.run("INSERT INTO routines (bot, name, schedule, watch, member) VALUES ('chief', 'fresh watch', 'every day 9:00', ?, 1)", `http://127.0.0.1:${(site.address() as any).port}/`).lastInsertRowid);
      assert.equal(id, 2, 'deleted routine id is reused');
      assert.deepEqual(crew.routines().find((r) => r.id === id)!.history, []);
      crew.runRoutine(id);
      await until('first fresh check', () => crew.routines().find((r) => r.id === id)!.history.length);
      assert.equal(crew.routines().find((r) => r.id === id)!.history[0].watch, 'started');
    } finally { await new Promise<void>((r) => site.close(() => r())); }
    files.forEach((f, i) => assert.deepEqual(readFileSync(f), bytes[i], f));
  } finally { crew.stop(); }
});

test('a split failure rolls back all live rows and leaves the completed backup for retry', () => {
  const { db, cfg } = seed();
  const before = db.all('SELECT * FROM tasks');
  db.db.exec("CREATE TRIGGER stop_split BEFORE DELETE ON people BEGIN SELECT RAISE(ABORT, 'split stopped'); END;");
  assert.throws(() => db.single(cfg), /split stopped/);
  assert.deepEqual(db.all('SELECT * FROM tasks'), before);
  assert.ok(db.get("SELECT 1 FROM devices WHERE id = 'former'"));
  assert.ok(db.get('SELECT 1 FROM people WHERE id = 2'));
  const backup = readFileSync(join(cfg.stateDir, 'crew-before-one-person.db'));
  db.db.exec('DROP TRIGGER stop_split');
  db.single(cfg);
  assert.deepEqual(readFileSync(join(cfg.stateDir, 'crew-before-one-person.db')), backup);
  assert.equal(db.get('SELECT 1 FROM people WHERE id = 2'), undefined);
});

test('a failed backup leaves the live install intact and main stops before listening', () => {
  const { db, cfg } = seed();
  const run = db.run.bind(db);
  db.run = (sql, ...args) => { if (sql === 'VACUUM INTO ?') throw new Error('backup stopped'); return run(sql, ...args); };
  assert.throws(() => db.single(cfg), /backup stopped/);
  assert.ok(db.get('SELECT 1 FROM people WHERE id = 2'));
  assert.ok(db.get("SELECT 1 FROM devices WHERE id = 'former'"));
  assert.ok(!existsSync(join(cfg.stateDir, 'crew-before-one-person.db')));
  db.run = run;
  db.close();
  const main = spawnSync(process.execPath, ['--input-type=module', '-e', "import { Store } from './src/db.ts'; Store.prototype.single = () => { throw new Error('backup stopped'); }; await import('./src/main.ts');"], {
    cwd: join(import.meta.dirname, '..'), env: { ...process.env, CREWHOUSE_STATE_DIR: cfg.stateDir, CREWHOUSE_CREW_DIR: cfg.crewDir, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: '0', CREWHOUSE_LINK_PORT: '0' }, encoding: 'utf8', timeout: 10_000,
  });
  assert.notEqual(main.status, 0);
  assert.match(main.stderr, /backup stopped/);
  assert.doesNotMatch(main.stdout, /listening/);
  // The lab's cleanup calls close too; reopen its handle so cleanup remains valid.
  db.db = new DatabaseSync(join(cfg.stateDir, 'crew.db'));
});


test('every database open scrubs old model ids and engine errors, even without a shared-install split', async () => {
  const { db, cfg, crew, done } = setup();
  Object.assign(crew.runtime, { start: async () => { throw new Error('engine internal /private/path'); } });
  await until('engine failure event', () => db.get("SELECT 1 FROM events WHERE kind = 'system.engine'"));
  assert.deepEqual(db.events().find((e) => e.kind === 'system.engine')!.data, {}, 'new engine errors stay off the event stream');
  assert.equal(db.all('SELECT id FROM people').length, 1);
  db.event('system.engine', null, { error: 'engine internal /private/path' });
  db.event('bot.models', 'chief', { models: ['chatgpt:internal-model'] });
  const keep = db.event('memory.learned', 'chief', { member: 1, text: 'Keep my note' });
  done();
  for (let n = 0; n < 2; n++) {
    const reopened = new Store(cfg.stateDir);
    try {
      assert.deepEqual(reopened.eventsForBot('chief', ['bot.models'])[0].data, {});
      assert.deepEqual(reopened.events().filter((e) => e.kind === 'system.engine').map((e) => e.data), [{}, {}]);
      assert.deepEqual(reopened.events().find((e) => e.seq === keep.seq)!.data, keep.data);
      assert.ok(!existsSync(join(cfg.stateDir, 'crew-before-one-person.db')), 'scrub does not depend on single()');
    } finally { reopened.close(); }
  }
});
