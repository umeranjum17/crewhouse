// E4: Scout's find-a-goal skill. A goal session asks one question, writes "Your plan" as a real
// document, saves the goal in Scout's own notes, and offers one Monday step the person says yes to first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, task } from './lab.ts';
import * as disk from '../src/bots.ts';

const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;

test('find-a-goal is wired into Scout', async () => {
  const { cfg, crew, done } = setup();
  const tpl = disk.listTemplates(cfg).find((t) => t.id === 'scout')!;
  assert.ok(tpl.skills?.includes('find-a-goal'), 'the template lists the skill');
  assert.match(readFileSync(join(cfg.repoDir, 'templates', 'scout', 'AGENTS.md'), 'utf8'),
    /Asked for help earning on the side or starting something, follow `find-a-goal`/, 'the job file points at it');
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  assert.ok(existsSync(join(disk.botDir(cfg, 'scout'), 'skills', 'find-a-goal', 'SKILL.md')), 'recruiting Scout copies the skill in');
  const skill = disk.listSkills(cfg, 'scout').find((k) => k.name === 'find-a-goal');
  assert.ok(skill?.description && skill?.says, 'the skill carries a description and the person-facing line');
  done();
});

test('a goal session delivers the plan, saves the goal, and offers the Monday step', async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  const plan = { name: 'Your plan', blocks: [
    { heading: 'Your plan', level: 1 },
    { heading: 'First steps' },
    { bullets: ['Offer dog walking to three neighbours: costs nothing, 30 minutes',
      'Print ten flyers at the library: a few coins, 20 minutes',
      'Walk one booked dog on Saturday: costs nothing, 30 minutes'] },
  ] };
  const id = (await crew.assign('scout', 'I want to earn on the side walking dogs ' +
    `${call('crew_document', plan)} ` +
    `${call('crew_remember', { text: 'Goal: weekend dog walking' })} ` +
    `${call('crew_routine', { when: 'every Monday 9:00', name: "The week's goal step",
      task: 'Take one 30-minute step toward the weekend dog walking: message one neighbour or walk one new route' })}`, 'chief'))!.task;
  await settled(db, id);
  assert.equal(task(db, id).state, 'done');

  const delivered = db.all("SELECT data FROM events WHERE kind = 'file.delivered'").map((e: any) => JSON.parse(e.data));
  assert.equal(delivered.length, 1, 'the plan is delivered once');
  assert.match(delivered[0].path, /\.docx$/, 'a real document, never a markdown path');

  const notes = readFileSync(join(cfg.crewDir, 'people', '1', 'notes', 'scout.md'), 'utf8');
  assert.match(notes, /Goal: weekend dog walking/, 'the goal lands in Scout’s own notes');

  const ask = db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'");
  assert.ok(ask, 'the Monday step waits on the person');
  assert.match(JSON.parse(ask.detail).preview.body, /Monday/, 'the card names the day');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM routines WHERE bot = 'scout'")!.n, 0, 'nothing runs until they say yes');
  done();
});
