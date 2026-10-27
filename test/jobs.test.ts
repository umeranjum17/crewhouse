// The jobs loop: one goal card, one board. The crew writes a role only into Found and Drafted; the person moves it on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, until, task } from './lab.ts';
import { after } from 'node:test';
import * as jobs from '../src/jobs.ts';
import * as disk from '../src/bots.ts';

const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
const CV = `Umer Anjum
Led a team of four building a payments dashboard in React and TypeScript
Cut page load time by 40 percent on the checkout flow
Wrote the Node.js API behind a mobile banking app
BSc Computer Science, 2016`;

async function posting() {
  const srv = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(req.url === '/gone' ? 'nope' : '<h1>Frontend Engineer</h1><p>Salary: £55,000 to £65,000 a year. React, TypeScript, GraphQL.</p>'); if (req.url === '/gone') res.statusCode = 404; });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  after(() => { srv.closeAllConnections(); srv.close(); });
  return { base: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, close: () => srv.close() };
}

test('goal card, guarded finding, drafting, and a board only the person moves', async () => {
  const { cfg, db, crew, done } = setup();
  const web = await posting();
  crew.onboard('Umer');
  const t = (await crew.post('chief', `Find me roles ${call('crew_goal', { title: 'Frontend engineer', places: 'London or remote', floor: '£50,000', cv: CV })}`))!.task;
  await settled(db, t);
  const card = db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'");
  assert.ok(card, 'the goal waits on the person');
  assert.ok(JSON.parse(card.detail).create.wont_do.includes('Submit an application'), 'the card carries the won\'t-do list');
  assert.equal(jobs.goal(db), null, 'nothing starts before yes');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM routines')!.n, 0);

  await crew.answer(card.id, { answer: 'allow' });
  const g = jobs.goal(db)!;
  assert.ok(g.rae && g.will && g.rae !== g.will, 'the finder and the writer are on the job');
  const daily = db.get('SELECT * FROM routines WHERE id = ?', g.routine);
  assert.equal(daily!.quiet, 1, 'the daily look is a quiet routine');
  for (const b of [g.rae, g.will]) assert.ok(!JSON.parse(readFileSync(join(disk.botDir(cfg, b), 'bot.json'), 'utf8')).apps?.includes?.('browser'), `${b} cannot press submit`);
  await until('the first look is done', () => db.get("SELECT 1 FROM tasks WHERE bot = ? AND state NOT IN ('queued','working')", g.rae));

  // The finder: the pay must be on the page, the fit must quote the CV, the page must open.
  const good = { company: 'Acme', title: 'Frontend Engineer', place: 'London', url: `${web.base}/job/1`, pay: '£55,000 to £65,000 a year', missing: 'GraphQL is not on your CV', fit: [{ says: 'You led a payments dashboard in React', cv: 'Led a team of four building a payments dashboard in React and TypeScript' }] };
  const find = async (input: object) => { const id = (await crew.post(g.rae, `look ${call('crew_role', input)}`))!.task; await settled(db, id); return id; };
  await find({ ...good, pay: '£90,000' });
  await find({ ...good, url: `${web.base}/gone` });
  await find({ ...good, fit: [{ says: 'You know Rust', cv: 'Shipped a Rust compiler' }] });
  assert.equal(db.get('SELECT COUNT(*) AS n FROM roles')!.n, 0, 'a made-up pay, a dead link and an invented skill add nothing');
  await find(good);
  await find({ ...good, url: `${web.base}/job/1/` });
  assert.equal(db.get('SELECT COUNT(*) AS n FROM roles')!.n, 1, 'the same posting is not added twice');
  const role = db.get('SELECT * FROM roles')!;
  assert.equal(role.stage, 'found');
  assert.equal(role.pay, '£55,000 to £65,000 a year');

  // The writer: CV lines exactly as written; what only the person answers stays theirs.
  const { task: dt } = crew.draftRole(role.id);
  await settled(db, dt);
  const w = async (input: object) => { const id = (await crew.post(g.will, `draft ${call('crew_application', input)}`))!.task; await settled(db, id); };
  const lines = ['Led a team of four building a payments dashboard in React and TypeScript'];
  await w({ role: role.id, cv: ['Led a team of ten at Google'], answers: [] });
  await w({ role: role.id, cv: lines, answers: [{ ask: 'What is your expected salary?', answer: '£60,000' }] });
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE kind = 'propose' AND state = 'open' AND detail LIKE '%\"draft\"%'")!.n, 0, 'an invented line or an answered salary question makes no draft');
  await w({ role: role.id, cv: lines, answers: [{ ask: 'Why Acme?', answer: 'I build payments dashboards.' }] });
  const draft = db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open' AND detail LIKE '%\"draft\"%'");
  const dd = JSON.parse(draft!.detail);
  assert.ok(dd.draft.yours.includes('Expected salary') && dd.draft.yours.includes('Your right to work'), 'what only the person answers is listed, empty');
  assert.doesNotMatch(dd.preview.body, /60,000/);
  assert.equal(db.get('SELECT stage FROM roles')!.stage, 'drafted');

  // Only the person moves it on; the crew's tools cannot, and there is nothing to call.
  assert.throws(() => jobs.move(db, role.id, 'sideways'), /interview/);
  jobs.move(db, role.id, 'applied', 1_000);
  const r = db.get('SELECT * FROM roles')!;
  assert.equal(r.stage, 'applied');
  const follow = db.get('SELECT * FROM routines WHERE id = ?', r.follow)!;
  assert.equal(follow.bot, g.will);
  assert.equal(follow.next_at, 1_000 + jobs.WEEK, 'a follow-up draft in 7 days');
  assert.equal(follow.kind, 'once');
  jobs.move(db, role.id, 'interview');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM routines WHERE id = ?', r.follow)!.n, 0, 'moving on takes the follow-up away');
  assert.equal(jobs.view(db)!.roles[0].stage, 'interview');

  // Interview prep: the brief's every fact is read from its page; what only the person answers is listed, never answered.
  assert.throws(() => crew.draftRole(role.id, 'practice'), /prepare for this interview first/);
  const open = () => db.get("SELECT COUNT(*) AS n FROM asks WHERE state = 'open'")!.n, before = open();
  const pt = crew.draftRole(role.id, 'prep').task;
  await settled(db, pt);
  assert.match(task(db, pt).body, /crew_prep/);
  const prep = async (input: object) => { const id = (await crew.post(g.will, `prep ${call('crew_prep', input)}`))!.task; await settled(db, id); };
  const fact = { says: 'Acme pays a salary.', url: `${web.base}/about`, quote: 'Salary: £55,000 to £65,000 a year' };
  const qs = [{ ask: 'Tell us about a dashboard you led.', why: 'The role owns one.' }, { ask: 'How do you test a checkout?', why: 'Money moves there.' }, { ask: 'What went wrong on your last project?', why: 'They check how you own a miss.' }];
  await prep({ role: role.id, brief: [{ ...fact, quote: 'Acme has four thousand staff worldwide' }], questions: qs });
  await prep({ role: role.id, brief: [{ ...fact, url: `${web.base}/gone` }], questions: qs });
  await prep({ role: role.id, brief: [fact], questions: qs.slice(0, 2) });
  assert.equal(jobs.prep(db, role.id), null, 'a fact its page does not show, a dead link and too few questions make no prep');
  await prep({ role: role.id, brief: [fact], questions: [...qs, { ask: 'What is your expected salary?', why: 'Asked early.' }] });
  const p = jobs.prep(db, role.id);
  assert.equal(p.brief[0].url, fact.url, 'every fact keeps the page it was read from');
  assert.equal(p.questions.length, 3, 'a pay question is not a practice question');
  assert.ok(p.yours.includes('Expected salary') && p.yours.includes('Visa sponsorship'), 'what only the person answers is listed, empty');
  assert.equal(db.get('SELECT stage FROM roles')!.stage, 'interview', 'the crew moves nothing');
  assert.equal(open(), before, 'the prep raises no card: nothing is drafted for sending');
  const pr = crew.draftRole(role.id, 'practice').task;
  await settled(db, pr);
  assert.match(task(db, pr).body, /Tell us about a dashboard you led[\s\S]*What landed:[\s\S]*To tighten:/);
  assert.doesNotMatch(task(db, pr).body, /expected salary\?\n/, 'the practice interviewer never asks the pay question');
  assert.throws(() => crew.draftRole(role.id + 1, 'prep'), /no|not/);
  jobs.move(db, role.id, 'offer');
  assert.throws(() => crew.draftRole(role.id, 'prep'), /not waiting/);
  assert.ok(task(db, t).state, 'Chief\'s task is on record');
  done();
});
