// Shared installs must update through P1 before this build; refusal leaves their data and files intact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { setup, until } from './lab.ts';
import { Store } from '../src/db.ts';

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

test('a shared install is refused without changing live rows, files or sign-ins; main never listens', () => {
  const { db, cfg, files, baseline } = seed();
  const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table'").map(({ name }) => name);
  const rows = () => tables.map((table) => db.all(`SELECT * FROM ${table}`));
  const before = rows();
  const bytes = [...files, baseline].map((f) => readFileSync(f));
  assert.throws(() => db.single(), /Update through the one-person migration release bc37c20 \(P1\) first/);
  assert.deepEqual(rows(), before);
  [...files, baseline].forEach((f, i) => assert.deepEqual(readFileSync(f), bytes[i], f));
  assert.ok(!existsSync(join(cfg.stateDir, 'crew-before-one-person.db')), 'this build never attempts the retired migration');
  db.close();
  const main = spawnSync(process.execPath, ['src/main.ts'], {
    cwd: join(import.meta.dirname, '..'), env: { ...process.env, CREWHOUSE_STATE_DIR: cfg.stateDir, CREWHOUSE_CREW_DIR: cfg.crewDir, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PORT: '0', CREWHOUSE_LINK_PORT: '0' }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(main.error, undefined);
  assert.equal(main.status, 1);
  assert.match(main.stderr, /Update through the one-person migration release bc37c20 \(P1\) first/);
  assert.doesNotMatch(main.stdout, /listening/);
  assert.ok(!existsSync(join(cfg.stateDir, 'endpoint')) && !existsSync(join(cfg.stateDir, 'link.key')), 'refusal precedes the phone link');
  // The lab's cleanup closes its handle too.
  db.db = new DatabaseSync(join(cfg.stateDir, 'crew.db'));
  assert.deepEqual(rows(), before);
});

test('fresh and already migrated single-person stores pass without changing rows', () => {
  const { db } = setup();
  const before = db.all('SELECT * FROM people');
  assert.doesNotThrow(() => db.single());
  assert.deepEqual(db.all('SELECT * FROM people'), before);
  db.run("INSERT INTO people (id, name) VALUES (0, 'Another person')");
  assert.throws(() => db.single(), /Update through/ , 'any person other than id 1 is refused');
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
