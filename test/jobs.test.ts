// The jobs loop: one goal card, one board. The crew writes a role only into Found and Drafted; the person moves it on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, until, task } from './lab.ts';
import { after } from 'node:test';
import * as jobs from '../src/jobs.ts';
import * as disk from '../src/bots.ts';
import * as kit from '../src/tools.ts';
import * as A from '../web/src/adapter.ts';
import type { Json } from '../web/src/api.ts';

const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
const CV = `Umer Anjum
Led a team of four building a payments dashboard in React and TypeScript
Cut page load time by 40 percent on the checkout flow
Wrote the Node.js API behind a mobile banking app
BSc Computer Science, 2016`;

async function posting() {
  const srv = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(req.url === '/gone' ? 'nope' : req.url?.startsWith('/says/') ? `<h1>Role</h1><p>${decodeURIComponent(req.url.slice(6))}</p>` : '<h1>Frontend Engineer</h1><p>Salary: £55,000 to £65,000 a year. React, TypeScript, GraphQL.</p>'); if (req.url === '/gone') res.statusCode = 404; });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  after(() => { srv.closeAllConnections(); srv.close(); });
  return { base: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, close: () => srv.close() };
}

// The browser AXI as a pinned install leaves it, serving one application form; its state (what is typed, what was sent) is a file in the bot's folder.
const FORM = `const fs = process.getBuiltinModule('fs'), f = process.cwd() + '/form.json', [cmd, ref, val] = process.argv.slice(2);
const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { url: 'about:blank', v: {} };
const F = [['e2', 'textbox', 'First Name'], ['e3', 'textbox', 'Email'], ['e4', 'textbox', 'Why do you want to work at Acme?'], ['e5', 'group', 'Resume/CV'], ['e6', 'button', 'Attach', 1],
  ['e7', 'combobox', 'Will you now or in the future require visa sponsorship?'], ['e8', 'option', 'Yes', 1], ['e9', 'option', 'No', 1], ['e10', 'textbox', 'Expected salary'], ['e11', 'checkbox', 'I consent to Acme keeping my data'],
  ['e13', 'generic', 'Are you authorized to work in the country where the job is located?'], ['e14', 'button', 'Yes', 1], ['e15', 'button', 'No', 1], ['e12', 'button', 'Submit application']];
if (cmd === 'goto') s.url = ref;
if (/^(fill|select)$/.test(cmd)) s.v[ref] = val;
if (cmd === 'check' || cmd === 'click') s.v[ref] = true;
if (cmd === 'click' && ref === 'e12') { delete s.v.e12; s.sent = s.v; s.url += '/thanks'; }
fs.writeFileSync(f, JSON.stringify(s));
const form = !s.url.endsWith('/thanks') && s.url !== 'about:blank';
console.log('page: {url: ' + s.url + ', title: "Apply for Frontend Engineer"}');
if (form) for (const [r, role, label, sub] of F) console.log((sub ? '  ' : '') + (role === 'generic' ? '- generic [ref=' + r + ']: ' + label : '- ' + role + ' "' + label + '" [ref=' + r + ']') + (s.v[r] ? ': ' + s.v[r] : ''));
else if (s.sent) console.log('- heading "Thanks for applying" [ref=e1]');`;

test('goal card, guarded finding, drafting, and a board only the person moves', async () => {
  const { cfg, db, crew, done } = setup();
  const web = await posting(), axi = join(cfg.toolsDir, 'browser', 'node_modules', 'playwright-axi', 'bin', 'playwright-axi.js');
  mkdirSync(join(axi, '..'), { recursive: true }); mkdirSync(kit.toolBin(cfg), { recursive: true });
  writeFileSync(axi, FORM); symlinkSync(axi, join(kit.toolBin(cfg), 'playwright-axi'));
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
  const tools = (b: string) => JSON.parse(readFileSync(join(disk.botDir(cfg, b), 'bot.json'), 'utf8')).tools;
  assert.ok(!tools(g.rae).includes('browser') && tools(g.will).includes('browser'), 'the finder has no browser; the writer fills forms in its own');
  await until('the first look is done', () => db.get("SELECT 1 FROM tasks WHERE bot = ? AND state NOT IN ('queued','working')", g.rae));
  assert.equal(db.get('SELECT origin FROM tasks WHERE routine = ?', g.routine)!.origin, 'chief', 'the first look is Chief\'s hand-on: his chip and live steps follow it');
  await until('the empty look is said in Chief\'s chat', () => db.get("SELECT 1 FROM messages WHERE bot = 'chief' AND text LIKE '%found nothing new that fits yet%'"));

  // The finder: the pay must be on the page, the fit must quote the CV, the page must open.
  const good = { company: 'Acme', title: 'Frontend Engineer', place: 'London', url: `${web.base}/job/1`, pay: '£55,000 to £65,000 a year', missing: 'GraphQL is not on your CV', fit: [{ says: 'You led a payments dashboard in React', cv: 'Led a team of four building a payments dashboard in React and TypeScript' }] };
  const find = async (input: object) => { const id = (await crew.post(g.rae, `look ${call('crew_role', input)}`))!.task; await settled(db, id); return id; };
  await find({ ...good, pay: '£90,000' });
  await find({ ...good, url: `${web.base}/gone` });
  await find({ ...good, fit: [{ says: 'You know Rust', cv: 'Shipped a Rust compiler' }] });
  assert.equal(db.get('SELECT COUNT(*) AS n FROM roles')!.n, 0, 'a made-up pay, a dead link and an invented skill add nothing');
  // A look Chief hands on that adds a role reports in his own chat: progress as it goes, then the role on its own line, its card there.
  db.run('UPDATE routines SET body = ? WHERE id = ?', `look ${call('crew_role', good)}`, g.routine);
  await (crew as any).fire(db.get('SELECT * FROM routines WHERE id = ?', g.routine), 'now', undefined, 'chief');
  const ended = () => db.get("SELECT * FROM tasks WHERE routine = ? AND origin = 'chief' AND state = 'done' ORDER BY id DESC", g.routine);
  await until('the look is done', () => ended()?.id > db.get('SELECT MIN(id) AS id FROM tasks WHERE routine = ?', g.routine)!.id);
  const look = ended()!;
  assert.ok(db.get("SELECT 1 FROM events WHERE kind = 'task.progress' AND json_extract(data, '$.task') = ? AND json_extract(data, '$.text') = '1 found: Frontend Engineer at Acme'", look.id), 'each role found is a step on the live line');
  const told = A.lines(crew.botPage('chief'), 'chief', crew.snapshot() as Json).find((l) => l.roles);
  assert.match(told!.text, /found a role that fits:\nFrontend Engineer at Acme\nTap one/);
  assert.deepEqual(told!.roles!.map((r) => [r.co, r.stage]), [['Acme', 'found']], 'the role is its card in Chief\'s chat');
  assert.doesNotMatch(A.besideRoles(told!), /at Acme/);
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

  // Fill it in for me: the writer types only the person's own lines in its browser; everything else, and Submit, is theirs.
  await crew.answer(draft!.id, { answer: 'allow', scope: 'once', fill: true });
  await settled(db, db.get('SELECT task FROM roles')!.task);
  const page = () => JSON.parse(readFileSync(join(disk.botDir(cfg, g.will), 'form.json'), 'utf8'));
  const fill = (ref: string, v: string) => call('browser', { args: ['fill', ref, v] });
  const ft = (await crew.post(g.will, `fill ${call('browser', { args: ['goto', `${web.base}/job/1`] })} ${call('browser', { args: ['click', 'e12'] })} ${call('browser', { args: ['click', 'e11'] })} ${call('browser', { args: ['click', 'e14'] })} ${fill('e2', 'Umer')} ${fill('e3', 'umer@example.com')} ${fill('e7', 'No')} ${fill('e10', '£60,000')} ${fill('e4', 'I build payments dashboards.')} ${call('browser', { args: ['click', 'e12'] })} ${call('browser', { args: ['check', 'e11'] })} ${call('crew_form', { role: role.id })}`))!.task;
  await settled(db, ft);
  assert.deepEqual(page().v, { e2: 'Umer', e4: 'I build payments dashboards.' }, 'an unsourced email, the visa and pay questions and the consent tick stay empty');
  assert.equal(page().sent, undefined, 'the writer cannot press Submit');
  const form = db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open' AND detail LIKE '%\"form\"%'")!, fd = JSON.parse(form.detail).form;
  assert.deepEqual(fd.filled.map((x: { label: string }) => x.label), ['First Name', 'Why do you want to work at Acme?']);
  assert.deepEqual(fd.fields.map((x: jobs.Field) => [x.label, x.kind, x.yours]), [['Email', 'text', false], ['Resume/CV', 'file', true], ['Will you now or in the future require visa sponsorship?', 'pick', true], ['Expected salary', 'text', true], ['I consent to Acme keeping my data', 'tick', true], ['Are you authorized to work in the country where the job is located?', 'pick', true]]);
  assert.equal(fd.submit, 'Submit application');
  assert.deepEqual(A.needsYou(crew.snapshot() as Json).map((c) => [c.id, c.helper]), [[form.id, 'chief']], 'the card waits on Home and in Chief\'s thread, as the draft did');
  assert.equal(db.get('SELECT stage FROM roles')!.stage, 'drafted', 'nothing moves before the person taps');

  // Only the person's tap sends it, with their own answers; the page saying so moves the role to Applied.
  assert.throws(() => jobs.move(db, role.id, 'sideways'), /interview/);
  const at = Date.now(), answers = { Email: 'umer@example.com', 'Will you now or in the future require visa sponsorship?': 'No', 'Expected salary': '£60,000', 'I consent to Acme keeping my data': true, 'Are you authorized to work in the country where the job is located?': 'Yes' };
  await crew.answer(form.id, { answer: 'allow', scope: 'once', fields: answers });
  assert.match(db.get('SELECT answer FROM asks WHERE id = ?', form.id)!.answer, /^Sent from/);
  assert.deepEqual(page().sent, { e2: 'Umer', e4: 'I build payments dashboards.', e3: 'umer@example.com', e7: 'No', e10: '£60,000', e11: true, e14: true });
  const r = db.get('SELECT * FROM roles')!;
  assert.equal(r.stage, 'applied');
  const follow = db.get('SELECT * FROM routines WHERE id = ?', r.follow)!;
  assert.equal(follow.bot, g.will);
  assert.ok(follow.next_at >= at + jobs.WEEK, 'a follow-up draft in 7 days');
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

test('a goal that is not a job search: its own stages, a quiet daily search that adds nothing twice, reminders the person dismisses', async () => {
  const { db, crew, done } = setup();
  const web = await posting();
  const brief = 'A two-bedroom flat to rent in Hackney or Walthamstow\nUp to £2,200 a month\nClose to a Victoria line or Overground station';
  const stages = ['Found', 'Shortlisted', 'Viewing booked', 'Offer made', 'Signed'];
  crew.onboard('Umer');
  await settled(db, (await crew.post('chief', `Find me a flat ${call('crew_goal', { title: 'A flat to rent', places: 'Hackney', brief, stages: ['Found'] })}`))!.task);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE kind = 'propose'")!.n, 0, 'one stage is not a board');
  await settled(db, (await crew.post('chief', `Find me a flat ${call('crew_goal', { title: 'A flat to rent', places: 'Hackney', brief, stages })}`))!.task);
  await crew.answer(db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'")!.id, { answer: 'allow' });
  const g = jobs.goal(db)!;
  assert.deepEqual(g.stages, stages);
  assert.equal(g.will, '', 'no writer for a flat');
  await until('the first look is done', () => db.get("SELECT 1 FROM tasks WHERE bot = ? AND state NOT IN ('queued','working')", g.rae));
  const find = async (n: number) => { const id = (await crew.post(g.rae, `look ${call('crew_role', { company: 'Foxtons', title: `Two-bed ${n}`, place: 'Hackney', url: `${web.base}/job/${n}`, pay: '£55,000', missing: 'No garden', fit: [{ says: 'Two bedrooms', cv: 'A two-bedroom flat to rent in Hackney or Walthamstow' }] })}`))!.task; await settled(db, id); };
  await find(1); await find(1); await find(2);
  const rows = db.all('SELECT * FROM roles WHERE goal = ?', g.id);
  assert.equal(rows.length, 2, 'the same option is not added twice');
  assert.ok(rows.every((r) => r.stage === 'found'), 'the crew writes only the first stage');
  db.run('UPDATE routines SET body = ?, next_at = 0 WHERE id = ?', `look ${call('crew_role', { company: 'Foxtons', title: 'Two-bed 3', place: 'Hackney', url: `${web.base}/job/3`, pay: '', missing: 'No garden', fit: [{ says: 'Two bedrooms', cv: 'A two-bedroom flat to rent in Hackney or Walthamstow' }] })}`, g.routine);
  crew.schedule();
  await until('the daily search is done', () => db.get("SELECT 1 FROM tasks WHERE routine = ? AND origin = 'routine' AND state = 'done'", g.routine));
  assert.equal(db.get('SELECT COUNT(*) AS n FROM roles WHERE goal = ?', g.id)!.n, 3, 'it adds to the board');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM messages WHERE bot = 'chief' AND task_id = ?", db.get('SELECT last_task FROM routines WHERE id = ?', g.routine)!.last_task)!.n, 0, 'the daily search never speaks in Chief\'s thread');
  assert.deepEqual(jobs.view(db)!.goal.stages.map((s) => s.name), stages);
  assert.throws(() => jobs.move(db, rows[0].id, 'applied'), /viewing-booked/, 'only this goal\'s stages exist');
  jobs.move(db, rows[0].id, 'viewing-booked');
  const a = crew.remindGoal(null, rows[0].id, { when: 'in 5 minutes' }), b = crew.remindGoal(g.id, null, { when: 'in 5 minutes', text: 'Read the brief' });
  assert.throws(() => crew.remindGoal(g.id, null, { when: 'in 5 minutes' }), /remind you of/);
  assert.equal(db.get('SELECT item FROM routines WHERE id = ?', a.id)!.item, rows[0].id);
  db.run('UPDATE routines SET next_at = ? WHERE id = ?', Date.now() - 1000, b.id);
  crew.schedule();
  assert.equal(db.get('SELECT next_at FROM routines WHERE id = ?', b.id)!.next_at, null, 'it went off once');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM asks WHERE state = 'open'")!.n, 0, 'a reminder never asks');
  crew.deleteRoutine(b.id);
  jobs.move(db, rows[1].id, 'passed');
  jobs.move(db, rows[0].id, 'passed');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM routines WHERE id = ?', a.id)!.n, 0, 'passing on an option drops its reminder');
  done();
});

test('roles are ranked by the person\'s strategy, each with the page\'s own words as its reason', async () => {
  const { db, crew, done } = setup();
  const web = await posting(), says = (text: string) => `${web.base}/says/${encodeURIComponent(text)}`;
  crew.onboard('Umer');
  await settled(db, (await crew.post('chief', `Find me roles ${call('crew_goal', { title: 'AI engineer', places: 'Remote', focus: 'remote first, gateway companies, fast hiring', cv: CV })}`))!.task);
  await crew.answer(db.get("SELECT * FROM asks WHERE kind = 'propose' AND state = 'open'")!.id, { answer: 'allow' });
  const g = jobs.goal(db)!;
  await until('the first look is done', () => db.get("SELECT 1 FROM tasks WHERE bot = ? AND state NOT IN ('queued','working')", g.rae));
  const fit = [{ says: 'You led a payments dashboard', cv: 'Led a team of four building a payments dashboard in React and TypeScript' }];
  const role = (title: string, page: string, signals?: object[]) => call('crew_role', { company: title, title, place: 'Anywhere', url: says(page), pay: '', missing: 'None', fit, signals });
  const add = async (title: string, page: string, signals?: object[]) => { await settled(db, (await crew.post(g.rae, `look ${role(title, page, signals)}`))!.task); };
  const onBoard = () => jobs.view(db)!.roles.map((r) => r.title), cards = () => A.goals(crew.snapshot() as Json)[0].cols[0].roles as A.GoalRole[];
  const remote = 'Fully remote within the US', brand = 'Offices in New York, London and Dublin', quick = 'Offer within two weeks of the first call', visa = 'We sponsor work visas';
  const every = ['remote', 'gateway', 'fast', 'sponsor'].map((kind) => ({ kind, quote: { remote, gateway: brand, fast: quick, sponsor: visa }[kind] }));
  // One look Chief handed on, finding them oldest first, so only the strategy puts them in this order.
  db.run('UPDATE routines SET body = ? WHERE id = ?', ['look', role('Shop', 'Hybrid in one office'), role('Visas', `${visa} for engineers`, [{ kind: 'sponsor', quote: visa }]), role('Fast', `${quick} for every role`, [{ kind: 'fast', quote: quick }]),
    role('Brand', `${brand} and more`, [{ kind: 'gateway', quote: brand }]), role('Remote', `${remote} for this role`, [{ kind: 'remote', quote: remote }]), role('Everything', `${remote}. ${brand}. ${quick}. ${visa}.`, every)].join(' '), g.routine);
  await (crew as any).fire(db.get('SELECT * FROM routines WHERE id = ?', g.routine), 'now', undefined, 'chief');
  await until('the look is told in Chief\'s chat', () => A.lines(crew.botPage('chief'), 'chief', crew.snapshot() as Json).find((l) => l.roles?.length));
  const told = A.lines(crew.botPage('chief'), 'chief', crew.snapshot() as Json).find((l) => l.roles)!;
  const order = ['Everything', 'Remote', 'Brand', 'Fast', 'Visas', 'Shop'];
  assert.deepEqual(onBoard(), order, 'remote first, then a gateway company, a fast process, sponsorship; a page with none last');
  assert.deepEqual(told.text.split('\n').slice(1, 7).map((x) => x.replace(/ at .*/, '')), order.map((x) => x), 'Chief\'s chat lists them in the same order');
  assert.deepEqual(told.roles!.map((r) => r.title), order, 'and so do their cards');
  // The reason on each row is the page's words, never the helper's description of the company.
  assert.equal(cards()[0].why, `Remote: “${remote}” · Gateway company: “${brand}” · Fast process: “${quick}” · Sponsorship history: “${visa}”`);
  assert.deepEqual(cards()[2].signals, [{ label: 'Gateway company', quote: brand, host: 'the company\'s website', url: says(`${brand} and more`) }]);
  assert.equal(cards().at(-1)!.why, 'No ranking reason found on its page.');
  // A signal its page does not show, a "no", a quote that says something else, a dead link and an unknown kind add nothing.
  const before = onBoard().length;
  await add('Invented', 'Hybrid in one office, invented', [{ kind: 'remote', quote: remote }]);
  await add('Negated', 'Not remote. Office in Leeds', [{ kind: 'remote', quote: 'Not remote. Office in Leeds' }]);
  await add('Unvisa', 'We do not sponsor visas here', [{ kind: 'sponsor', quote: 'We do not sponsor visas here' }]);
  await add('Mislabelled', `Mislabelled: ${brand}`, [{ kind: 'remote', quote: `Mislabelled: ${brand}` }]);
  await add('Dead', 'Hybrid in one office, dead', [{ kind: 'gateway', quote: brand, url: `${web.base}/gone` }]);
  await add('Odd', `Odd: ${brand}`, [{ kind: 'prestige', quote: `Odd: ${brand}` }]);
  assert.equal(onBoard().length, before, 'a claim its page does not back is never added');
  await add('Invented', 'Hybrid in one office, invented');
  assert.deepEqual(onBoard().slice(-2), ['Invented', 'Shop'], 'the same role without the claim is added, among the roles that show nothing (newest first)');
  done();
});
