// C1: the growth skills and the run validator. Everything here is a real Crew on the stub engine: the
// skills' own script runs on python3, and the validator is asked about a run crewd really recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, settled } from './lab.ts';
import * as disk from '../src/bots.ts';
// @ts-expect-error: a plain script, no types
import { validate } from '../scripts/validate-growth.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
const script = (rel: string) => execFileSync('python3', rel.split(' '), { cwd: repo, encoding: 'utf8' });
const rows = (db: any, crewDir: string, id: number) => validate({ db, crewDir }, id);
const fails = (r: any[]) => r.filter((x) => x.verdict === 'FAIL').map((x) => x.what);
const crewOf = (db: any, tool: string) => db.all("SELECT data FROM events WHERE kind = 'run.call' AND json_extract(data, '$.tool') = ?", tool)
  .map((e: any) => JSON.parse(e.data));

const NOTES = `Thread: Show HN: muxr, coding agents from your phone
They asked: how do I keep an eye on my coding agents while I am out
What you know that helps: run them on your own machine and read them from the phone
Say you made it: I build muxr, and this is how it works for me
Their rule: don't post generated or AI-edited text (news.ycombinator.com/newsguidelines.html)`;
const PROSE = 'Hi! I built muxr and I think you would love it. It lets you manage coding agents from your phone, which is something I have wanted for a long time. Happy to answer questions!';

/** A whole growth job, scripted the way the stub engine runs one: Scout's rivals, handed to Scribe, who plans.
 *  The stub only runs the tool calls written in the turn it is given, so each helper's turn is its own post. */
async function growthJob(crew: any, db: any, { plan = 'Growth plan', notes = NOTES } = {}) {
  const rivals = call('crew_document', { name: 'Who else does this', blocks: [{ heading: 'Who else does this' }, { text: 'Two rivals, one from a README, one from a listicle.' }] });
  await settled(db, (await crew.post('scout', 'This is my website: https://trymuxr.com/. Who else does this? ' + rivals
    + call('crew_pass', { bot: 'scribe', task: 'Write the growth plan from these rivals and the threads. Done means: a plan under 300 words and the first drafts.' }))).task);
  const scout = db.get("SELECT * FROM tasks WHERE bot = 'scout' ORDER BY id DESC LIMIT 1");
  const handed = db.get("SELECT * FROM tasks WHERE bot = 'scribe' AND origin = 'scout' ORDER BY id DESC LIMIT 1");
  if (handed) await settled(db, handed.id);
  await settled(db, (await crew.post('scribe', 'Now the plan. ' + call('crew_write', { path: 'files/growth-plan.md', content: plan })
    + call('crew_deliver', { path: 'files/growth-plan.md', note: 'the plan' })
    + call('crew_draft', { path: 'files/show-hn.md', channel: 'post', to: 'Show HN notes' })
    + call('crew_write', { path: 'files/show-hn.md', content: notes })
    + call('crew_draft', { path: 'files/x-post.md', channel: 'post', to: 'X launch post' })
    + call('crew_write', { path: 'files/x-post.md', content: 'muxr runs your coding agents on your own machine.' })
    + call('crew_pass', { bot: 'reel', task: 'make-reel: a 30 second demo for muxr from its README screenshots' }))).task);
  const scribe = db.get("SELECT * FROM tasks WHERE bot = 'scribe' AND origin = 'person' ORDER BY id DESC LIMIT 1");
  await settled(db, scribe.id);
  const reel = db.get("SELECT * FROM tasks WHERE bot = 'reel' ORDER BY id DESC LIMIT 1");
  if (reel) await settled(db, reel.id);
  return { scout: scout.id, scribe: scribe.id };
}

function crewWith(fn: (crew: any) => void) {
  const lab = setup();
  lab.crew.onboard('Umer');
  for (const bot of ['scout', 'scribe', 'reel']) lab.crew.recruit(bot, bot[0].toUpperCase() + bot.slice(1), 'person');
  fn(lab.crew);
  return lab;
}

test('the skills are on Scout and Scribe, and the old one is gone', () => {
  const { cfg, done } = setup();
  const scout = disk.loadTemplate(cfg, 'scout'), scribe = disk.loadTemplate(cfg, 'scribe');
  for (const s of scout.skills ?? []) assert.ok(existsSync(join(repo, 'skills', s, 'SKILL.md')), `${s} exists`);
  assert.deepEqual(scribe.skills?.filter((s) => ['growth-plan', 'market-it'].includes(s)), ['growth-plan']);
  assert.equal(existsSync(join(repo, 'skills', 'market-it')), false, 'no shim for the old name');
  assert.equal(skipped(), 0, 'the ranking script checks itself');
  done();
});

/** The script's own self-check: the agreed examples, run by python3. */
function skipped() {
  try { return script('skills/find-competitors/score.py test').split('\n').filter((l) => l.startsWith('FAIL')).length; } catch { return 1; }
}

test('score.py ranks rivals, finds spikes and checks itself on python3', () => {
  const out = script('skills/find-competitors/score.py test');
  assert.doesNotMatch(out, /FAIL/, out);
  assert.match(out, /646-star day and the day after are one spike/);
  assert.match(out, /15-star day on a 35-star repo is a spike/);
  assert.match(out, /one kind of evidence lands in maybe/);
  assert.match(out, /duplicate listicle URL counts once/);
});

test('a finished growth job passes the validator; a long plan and a prose Hacker News card do not', async () => {
  const { crew, db, cfg, done } = crewWith(() => {});
  const { scribe, scout } = await growthJob(crew, db);
  const ok = rows(db, cfg.crewDir, scribe);
  assert.deepEqual(fails(ok), [], 'a good job fails nothing');
  assert.ok(ok.find((r: any) => r.what === 'rivals document')!.detail.includes('who-else-does-this.docx'),
    'the rivals document Scout delivered counts');
  assert.ok(ok.find((r: any) => r.what === 'plan under 300 words')!.detail.includes('words'));
  assert.equal(ok.find((r: any) => r.what === '1-3 draft cards')!.detail, '2 crew_draft call(s)');
  assert.match(ok.find((r: any) => r.what.startsWith('notes for'))!.detail, /all five labels/);
  const reel = crewOf(db, 'crew_pass').find((c: any) => c.input.includes('"reel"'));
  assert.ok(reel, 'one hand-off to Reel for the missing demo');
  assert.match(JSON.parse(reel.input).task, /make-reel/);
  assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', scout)!.state, 'done');
  done();
});

test('a 400-word plan fails, and so does prose where labelled notes belong', async () => {
  const long = await crewWith(() => {});
  const plan = 'Growth plan for muxr, one more line of it. '.repeat(40);
  assert.ok(plan.split(/\s+/).length > 300);
  const first = await growthJob(long.crew, long.db, { plan });
  assert.ok(fails(rows(long.db, long.cfg.crewDir, first.scribe)).includes('plan under 300 words'), 'the long plan is caught');
  long.done();

  const prose = await crewWith(() => {});
  const second = await growthJob(prose.crew, prose.db, { notes: PROSE });
  const bad = fails(rows(prose.db, prose.cfg.crewDir, second.scribe));
  assert.ok(bad.some((w: string) => w.startsWith('notes for')), `the prose card is caught, got ${JSON.stringify(bad)}`);
  prose.done();
});

test('growth in Chief’s thread reaches Scout as a hand-off, with and without an earlier request', async () => {
  for (const earlier of ['', 'what did I buy last week ']) {
    const { crew, db, done } = crewWith(() => {});
    if (earlier) await settled(db, (await crew.post('chief', earlier))!.task);
    const ask = call('crew_assign', { bot: 'scout', task: 'Find the rivals for muxr and write down where their attention came from', title: 'Who else does muxr' });
    await settled(db, (await crew.post('chief', 'This is my website: https://trymuxr.com/. Get me more stars. ' + ask))!.task);
    const jobs = db.all("SELECT * FROM tasks WHERE bot = 'scout'");
    assert.equal(jobs.length, 1, `one Scout job (earlier: ${earlier || 'none'})`);
    assert.equal(jobs[0].origin, 'chief');
    assert.match(db.get("SELECT * FROM tasks WHERE bot = 'chief' ORDER BY id DESC LIMIT 1")!.body, /Get me more stars/,
      'the person\'s own words reach Chief');
    assert.equal(db.get("SELECT * FROM asks WHERE kind = 'propose' AND json_extract(detail, '$.plan') IS NOT NULL"), undefined,
      'one step is an ordinary hand-off: no plan card, no Go to wait for');
    const rec = crewOf(db, 'crew_assign')[0];
    assert.equal(JSON.parse(rec.input).steps, undefined, 'no steps');
    done();
  }
});

test('an untouched existing Scout gets the new skill when the template lands', () => {
  const { cfg, done } = setup();
  const lab = setup();
  lab.crew.onboard('Umer');
  lab.crew.recruit('scout', 'Scout', 'person');
  const dir = disk.botDir(lab.cfg, 'scout');
  rmSync(join(dir, 'skills', 'find-competitors'), { recursive: true, force: true });
  assert.equal(existsSync(join(dir, 'skills', 'find-competitors')), false, 'an older install does not have it');
  disk.upgradeFolder(lab.cfg, 'scout', disk.loadTemplate(lab.cfg, 'scout'), 'Scout');
  assert.ok(existsSync(join(dir, 'skills', 'find-competitors', 'SKILL.md')), 'the skill is copied in');
  assert.ok(existsSync(join(dir, 'skills', 'find-competitors', 'score.py')), 'the script comes with it');
  assert.match(readFileSync(join(dir, 'skills', 'find-threads', 'SKILL.md'), 'utf8'), /Find threads/);
  done();
  lab.done();
});