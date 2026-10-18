// Quiet jobs get one Chief message, survive restart, and end unsure; isolated SQLite and the public schedule path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './lab.ts';
import { Store } from '../src/db.ts';
import { Crew } from '../src/crew.ts';

test('quiet job nudges once across restart, then ends unsure', async () => {
  const { db, crew, cfg, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  clearInterval((crew as any).timer);
  const quiet = Date.now() - 5 * 60 * 60_000;
  const task = Number(db.run("INSERT INTO tasks (bot, title, body, origin, state, created_at, updated_at) VALUES ('reel', 'Quiet job', 'Keep working', 'person', 'working', ?, ?)", quiet, quiet).lastInsertRowid);
  const progress = db.event('task.progress', 'reel', { task, text: 'Still working.' });
  db.run('UPDATE events SET at = ? WHERE seq = ?', quiet, progress.seq);
  const at = quiet + 4 * 60 * 60_000;
  crew.schedule(at);
  const nudges = () => db.all("SELECT * FROM messages WHERE bot = 'chief' AND text LIKE '%has been quiet for a while%'");
  assert.equal(nudges().length, 1);
  assert.match(nudges()[0].text, /Quiet job/);
  crew.schedule(at + 1_000);
  assert.equal(nudges().length, 1, 'the same quiet stretch never repeats');

  await crew.stop();
  const db2 = new Store(cfg.stateDir), resumed = new Crew(cfg, db2);
  resumed.schedule(at + 2_000);
  assert.equal(db2.all("SELECT * FROM messages WHERE bot = 'chief' AND text LIKE '%has been quiet for a while%'").length, 1, 'SQLite suppresses a repeat after restart');
  resumed.schedule(quiet + 24 * 60 * 60_000);
  assert.equal(db2.get('SELECT state FROM tasks WHERE id = ?', task)!.state, 'unsure');
  assert.match(db2.get("SELECT text FROM messages WHERE bot = 'reel' AND author = 'bot' ORDER BY id DESC")!.text, /not sure/i);
  await resumed.stop();
  db2.close();
  done();
});
