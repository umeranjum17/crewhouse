// Helper names are a job word plus a friendly first name (firstmate pick on ch-helper-names):
// templates carry them, recruits show them, and Chief's own made-up hires follow the same rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, until } from './lab.ts';

const NAMES: Record<string, string> = {
  scout: 'Research Rae', scribe: 'Writer Will', reel: 'Video Vic', support: 'Support Sam',
  tracer: 'Finder Finn', xgrowth: 'Growth Gus', cto: 'Terminal Tess', helper: 'Helper Hal',
  frame: 'Frame Fay', motion: 'Motion Milo', prototype: 'Spark Stella',
};
const template = (id: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'templates', id, 'bot.json'), 'utf8'));

test('every template carries its picked name; Chief stays Chief', () => {
  for (const [id, display] of Object.entries(NAMES)) assert.equal(template(id).display, display, `${id} display`);
  assert.equal(template('chief').display, 'Chief');
});

test('recruits show the picked names, and a made-up hire follows the same rule on its take-on card', async () => {
  const { db, crew, done } = setup();
  process.env.CREWHOUSE_STUB_GOLDEN = '1';
  crew.onboard('sir');
  for (const [id, display] of Object.entries(NAMES)) if (id !== 'helper') crew.recruit(id, display, 'person');
  const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); // bot ids come from display names
  for (const display of Object.values(NAMES)) if (display !== 'Helper Hal') assert.equal(crew.bot(slug(display))!.display, display, `${display} shows`);
  const r = (await crew.post('chief', 'I need someone to sort out my invoices'))!;
  assert.ok(r?.task, 'a task runs');
  await until('the take-on card', () => db.get("SELECT * FROM asks WHERE bot = 'chief' AND kind = 'propose' AND state = 'open'"));
  const ask = db.get("SELECT * FROM asks WHERE bot = 'chief' AND kind = 'propose' AND state = 'open'")!;
  assert.equal(ask.title, 'Bring Invoice Ivy onto the crew?', 'a job word plus a friendly first name, like the templates');
  delete process.env.CREWHOUSE_STUB_GOLDEN;
  done();
});

test('a helper Chief recruits needs a job word and a first name: a bare "Helper" or "Penny" never lands, and a clash neither', async () => {
  const { db, crew, done } = setup();
  crew.onboard('sir');
  const recruit = async (name: string) => {
    const r = (await crew.post('chief', `[tool crew_recruit ${JSON.stringify({ template: 'helper', name })}]`))!;
    await settled(db, r.task);
  };
  const names = (): string[] => crew.bots().map((b: any) => b.display);
  await recruit('Helper');
  await recruit('Penny');
  assert.deepEqual(names().filter((n: string) => /^(Helper|Penny)$/.test(n)), [], 'a bare name is refused');
  await recruit('Garden Gus');
  assert.ok(names().includes('Garden Gus'), 'a job word plus a first name lands');
  await recruit('garden gus');
  assert.equal(names().filter((n: string) => n.toLowerCase() === 'garden gus').length, 1, 'a clash with a crew member is refused');
  done();
});
