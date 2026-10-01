// Automatic learning and its weekly review stay in logs, never in chats or visible steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup as lab } from './lab.ts';
import { steps } from '../web/src/adapter.ts';
import type { Config } from '../src/config.ts';

test('automatic learning and curation stay quiet on fresh and established homes', async () => {
  const { cfg, db, crew, done } = lab();
  crew.onboard('sir');
  const runtime = crew.runtime as any;
  const before = db.all('SELECT * FROM messages');
  runtime.runCollectionReview = async () => { throw new Error('the collection review is not enabled'); };
  runtime.learned = async () => [];
  await (crew as any).weeklyCuration();
  assert.deepEqual(db.all('SELECT * FROM messages'), before, 'a fresh home hears no maintenance notice');
  assert.equal(db.all("SELECT * FROM events WHERE kind = 'learn.curated'").length, 1, 'the refusal is still recorded');
  runtime.learned = async () => [{ id: '1', skill: 'fare-check', at: Date.now() - 7 * 86_400_000, state: 'applied' }];
  await (crew as any).weeklyCuration();
  assert.deepEqual(db.all('SELECT * FROM messages'), before, 'an established home hears no refusal notice');
  runtime.runCollectionReview = async () => ({ capture: 'abc', kept: [], written: ['fare-check'], dropped: [] });
  await (crew as any).weeklyCuration();
  assert.deepEqual(db.all('SELECT * FROM messages'), before, 'a successful review posts no chat line');
  // Exercise the post-run recorder with the scripted runtime; no account or real model is needed here.
  (cfg as Config).engine = 'openclaw';
  await (crew as any).recordLearned('chief', { task: 1 });
  await (crew as any).recordLearned('chief', { task: 1 });
  assert.deepEqual(db.all('SELECT * FROM messages'), before, 'applied learning posts no chat line');
  db.event('skill.learned', 'chief', { name: 'fare-check', says: 'Check the full fare before comparing flights' });
  db.event('skill.removed', 'chief', { name: 'fare-check' });
  const events = db.all("SELECT * FROM events WHERE kind IN ('learn.curated', 'learn.applied')")
    .map((e) => ({ ...e, data: JSON.parse(e.data) }));
  assert.equal(events.length, 4, 'three reviews and one application remain logged, without a duplicate');
  assert.match(events[0].data.refused, /not enabled/);
  assert.deepEqual(events[2].data, { capture: 'abc', kept: [], written: ['fare-check'], dropped: [] });
  assert.equal(events[3].data.skill, 'fare-check');
  assert.deepEqual(steps([...events, ...db.eventsForBot('chief', ['skill.learned', 'skill.removed'])]), [],
    'learning events and internal names cannot become visible chat or Home steps');
  done();
});
