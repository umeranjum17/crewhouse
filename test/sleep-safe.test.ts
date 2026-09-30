// Sleep/restart bugs that bite ordinary installs (sleep, network loss, restart): one stub-runtime
// test per fix, each failing before its fix. Bounded waits only (lab.ts `until`), no clock mocking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup as lab, settled, prompted, until } from './lab.ts';
import * as disk from '../src/bots.ts';
import { Link } from '../src/link.ts';
import { Store } from '../src/db.ts';
import { Crew } from '../src/crew.ts';

const HOUR = 3_600_000;

test('the hourly cap counts running time, not age since the job was made', async () => {
  const { db, crew, done } = lab();
  try {
    crew.recruit('reel', 'Reel', 'person');
    const old = Date.now() - 2 * HOUR;
    // Made long ago (a resume keeps its creation time) but (re)started just now.
    const id = Number(db.run("INSERT INTO tasks (bot, title, body, origin, state, created_at, updated_at, member) VALUES ('reel', 't', 'b', 'person', 'working', ?, ?, 1)", old, Date.now()).lastInsertRowid);
    (crew as any).tick();
    assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', id)!.state, 'working', 'a freshly running job survives the cap');
    // A job actually running over an hour still stops.
    db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', old, id);
    (crew as any).tick();
    assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', id)!.state, 'failed', 'a runaway job still stops');
  } finally { done(); }
});

test('a turn cut by a network drop is requeued, not failed', async () => {
  const { db, crew, done } = lab();
  try {
    crew.recruit('reel', 'Reel', 'person');
    const { task: id } = await (crew as any).post('reel', 'check the prices; the link is down today', undefined, 1);
    await settled(db, id);
    assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', id)!.state, 'done', 'retried after the drop and finished');
    await prompted(db, id, 2);
  } finally { done(); }
});

test('a cold boot replays the sleep announcement and starts wake chores', async () => {
  const first = lab();
  try {
    first.crew.recruit('reel', 'Reel', 'person');
    const due = first.crew.addRoutine({ bot: 'reel', schedule: 'every day 7:00', task: 'ask permission: check the prices', name: 'Deal check' }, 'person');
    first.db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 3 * HOUR, due.id);
    const wake = first.crew.addRoutine({ bot: 'reel', on: 'when this computer wakes up', task: 'ask permission: say good morning', name: 'Wake check' }, 'person');
    first.db.run("INSERT INTO settings (key, value) VALUES ('crew.lastTick', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(Date.now() - 2 * HOUR));
    const { cfg } = first;
    first.done();
    // Cold boot: a fresh Crew on the same folders, doing no work yet.
    const db = new Store(cfg.stateDir);
    const crew = new Crew({ ...cfg, maxConcurrent: 0 }, db);
    try {
      crew.init();
      assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'system.slept'")!.n, 1, 'the gap is recorded');
      const line = db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND text LIKE 'The crew was off%'")?.text;
      assert.match(line ?? '', /I'm running “Deal check” now, once, to catch up\./);
      const fired = db.all("SELECT data FROM events WHERE kind = 'routine.fired' AND json_extract(data, '$.routine') = ?", wake.id).map((e) => JSON.parse(e.data));
      assert.equal(fired.length, 1, 'the wake chore starts');
      assert.equal(fired[0].why, 'wake');
    } finally { await until('second crew up', () => (crew as any).curationAt > 0); crew.stop(); db.close(); }
  } catch (e) { first.done(); throw e; }
});

test("a replayed phone request returns its first answer: one job, even across a restart", async () => {
  const first = lab();
  try {
    first.crew.recruit('reel', 'Reel', 'person');
    const wire = (db: Store, crew: Crew) => new Link(first.cfg, db, (m, p, body, key?: string) => {
      const r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/messages$/);
      if (r && m === 'POST') return (crew as any).post(r[1], body.text, undefined, 1, undefined, false, key);
      throw Object.assign(new Error('not found'), { status: 404 });
    });
    const via = { id: 'phone-1', role: 'control' } as any;
    const a = wire(first.db, first.crew);
    // The answers store: device-scoped, fail-closed, dropped on acknowledgement.
    const store = (a as any).answers;
    assert.equal(await store.get('phone-1', 'k0'), null, 'nothing stored yet');
    await store.put('phone-1', 'k0', { op: 'x', args: 'null', reply: { ok: true, value: 1 } });
    assert.deepEqual(await store.get('phone-1', 'k0'), { op: 'x', args: 'null', reply: { ok: true, value: 1 } });
    assert.equal(await store.get('phone-2', 'k0'), null, "one device's answer never serves another's");
    await store.drop('phone-1', ['k0']);
    assert.equal(await store.get('phone-1', 'k0'), null);
    first.db.run("INSERT INTO settings (key, value) VALUES ('link.ans.phone-1.k1', 'garbage') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    await assert.rejects(store.get('phone-1', 'k1'), 'a malformed record refuses rather than reruns');
    first.db.run("DELETE FROM settings WHERE key = 'link.ans.phone-1.k1'");

    const r1 = await (a as any).request('POST /api/bots/reel/messages', { text: 'check the prices' }, via, 'phone-1:k1');
    assert.equal(r1.status, 200);
    await settled(first.db, r1.body.task);
    const r2 = await (a as any).request('POST /api/bots/reel/messages', { text: 'check the prices' }, via, 'phone-1:k1');
    assert.deepEqual(r2, r1, 'same key, same answer, no second job');
    assert.equal(first.db.get('SELECT COUNT(*) AS n FROM tasks')!.n, 1);
    const { cfg } = first;
    first.done();
    // Restart: the claim survives in SQLite, so the replay still makes no second job.
    const db = new Store(cfg.stateDir);
    const crew = new Crew({ ...cfg, maxConcurrent: 0 }, db);
    try {
      crew.init();
      const b = wire(db, crew);
      const r3 = await (b as any).request('POST /api/bots/reel/messages', { text: 'check the prices' }, via, 'phone-1:k1');
      assert.deepEqual(r3.body, r1.body, 'the first answer comes back after a restart');
      assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks')!.n, 1, 'still one job');
    } finally { await until('second crew up', () => (crew as any).curationAt > 0); crew.stop(); db.close(); }
  } catch (e) { first.done(); throw e; }
});

test('a job that acted before a restart asks again, even under an always grant', async () => {
  const first = lab();
  try {
    first.crew.recruit('reel', 'Reel', 'person');
    const { task: id } = await (first.crew as any).post('reel', 'file it [tool crew_write {"path": "/tmp/reask-probe.txt", "text": "hello"}]', undefined, 1);
    await settled(first.db, id);
    assert.equal(first.db.get('SELECT state FROM tasks WHERE id = ?', id)!.state, 'needs_you', 'the call parks on a card');
    const ask = first.db.get("SELECT * FROM asks WHERE task_id = ? AND state = 'open'", id)!;
    assert.ok(ask, 'the card is open');
    const key = JSON.parse(ask.detail).key;
    assert.ok(key, 'the card carries a standing-grant key');
    // An allowed send or spend marks the job acted; files-kind parks first, so the marked state is set here
    // to stand in for it (no app tools in the lab). The always grant is the person's real persisted choice.
    first.db.run('UPDATE tasks SET acted = ? WHERE id = ?', 'a file', id);
    disk.setSettings(first.cfg, 'reel', { allow: [key] });
    const { cfg } = first;
    first.done();
    // Restart, doing no work yet: the acted job must ask again instead of sailing through on always.
    const db = new Store(cfg.stateDir);
    const crew = new Crew({ ...cfg, maxConcurrent: 0 }, db);
    try {
      crew.init();
      assert.equal(db.get('SELECT reask FROM tasks WHERE id = ?', id)!.reask, 1, 'recovery flags the acted job');
      assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', id)!.state, 'queued');
      db.run("UPDATE tasks SET state = 'working' WHERE id = ?", id); // what dispatch would do next
      const r = await (crew as any).decide('reel', 'crew_write', { path: '/tmp/reask-probe.txt', text: 'hello' });
      assert.ok(r && r.terminate, 'asks again instead of acting twice');
      assert.ok(db.get("SELECT 1 FROM asks WHERE task_id = ? AND state = 'open' AND kind = 'permission'", id), 'a card is open');
      assert.equal(db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'run.allowed' AND json_extract(data, '$.task') = ?", id)!.n, 0, 'never silently allowed');
      db.run('UPDATE tasks SET reask = 0 WHERE id = ?', id);
      assert.equal(await (crew as any).decide('reel', 'crew_write', { path: '/tmp/reask-probe.txt', text: 'hello' }), undefined, 'the standing grant still works after asking once');
    } finally { await until('second crew up', () => (crew as any).curationAt > 0); crew.stop(); db.close(); }
  } catch (e) { first.done(); throw e; }
});
