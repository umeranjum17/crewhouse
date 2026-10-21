// Quiet jobs get one Chief message, survive restart, and end unsure; isolated SQLite and the public schedule path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holding, setup } from './lab.ts';
import { Store } from '../src/db.ts';
import { Crew } from '../src/crew.ts';

test('a silent live run is not stopped by the old ten-minute hung limit', async () => {
  const previous = process.env.CREWHOUSE_HUNG_MS;
  delete process.env.CREWHOUSE_HUNG_MS;
  const { db, crew, done } = setup();
  try {
    crew.onboard('Umer');
    crew.recruit('reel', 'Reel', 'person');
    clearInterval((crew as any).timer);
    const { task } = (await crew.post('reel', 'ask permission: prepare the demo'))!;
    await holding(crew, 'reel');
    (crew as any).live.get('reel').news = Date.now() - 11 * 60_000;
    (crew as any).tick();
    assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', task)!.state, 'working');
    assert.equal(db.all("SELECT * FROM messages WHERE text LIKE '%stalled, so I stopped it%' AND bot = 'chief'").length, 0);
  } finally {
    if (previous === undefined) delete process.env.CREWHOUSE_HUNG_MS; else process.env.CREWHOUSE_HUNG_MS = previous;
    done();
  }
});

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
  assert.equal(db.all("SELECT * FROM events WHERE kind = 'message' AND bot = 'chief' AND json_extract(data, '$.author') = 'bot' AND json_extract(data, '$.text') LIKE '%has been quiet for a while%'").length, 1, 'Chief message events are the existing phone-news path');
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
