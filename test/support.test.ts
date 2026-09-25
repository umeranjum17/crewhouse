// The support desk: drafts wait on a card that records the answer, and a fix counts only when crewd saw its check fail
// without it and pass with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, task } from './lab.ts';
import * as disk from '../src/bots.ts';
import { sandboxReady } from '../src/engine.ts';

const call = (name: string, args: object) => `[tool ${name} ${JSON.stringify(args)}]`;
const events = (db: any, kind: string) => db.all('SELECT data FROM events WHERE kind = ? ORDER BY seq', kind).map((e: any) => JSON.parse(e.data));

test('Chief sees what each template knows, and a drafted reply waits on a card that keeps the answer; nothing is sent', async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  const { task: r } = (await crew.post('chief', `who can help ${call('crew_roster', {})}`))!;
  await settled(db, r);
  assert.match(db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' ORDER BY id DESC")!.text, /"id":"reel","name":"Reel","role":"[^"]+","knows":\["make-reel","use-the-browser"\]/);

  assert.deepEqual(disk.loadTemplate(cfg, 'support').skills, ['triage-issue', 'sandbox-patch']);
  crew.recruit('support', 'Desk', 'person');
  const dir = join(disk.botDir(cfg, 'desk'), 'files', 'support', '208');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'reply.md'), 'Thanks for the two-day log. Headless, Herdr reports idle, not done (apps/host/src/x.ts:12@abc).\n');
  const draft = call('crew_draft', { path: 'files/support/208/reply.md', to: 'muxr issue #208' });
  const card = () => db.get("SELECT * FROM asks WHERE bot = 'desk' AND kind = 'propose' AND state = 'open'");
  const t = (await crew.post('desk', `draft it ${draft}`))!.task;
  await settled(db, t);
  const view = crew.snapshot().asks.find((a: any) => a.id === card()!.id)!;
  assert.equal(view.detail.yes, 'Approve');
  assert.match(view.detail.words, /^Desk drafted something for muxr issue #208\. Nothing is sent/);
  assert.match(view.detail.preview.body, /Herdr reports idle/);
  await crew.answer(card()!.id, { answer: 'deny' });
  assert.equal(events(db, 'draft.rejected')[0].to, 'muxr issue #208');

  const t2 = (await crew.post('desk', `again ${draft}`))!.task;
  await settled(db, t2);
  await crew.answer(card()!.id, { answer: 'allow' });
  const ok = events(db, 'draft.approved')[0];
  assert.deepEqual([ok.to, ok.path, ok.task], ['muxr issue #208', 'files/support/208/reply.md', t2]);
  assert.equal(ok.sha, events(db, 'draft.rejected')[0].sha, 'the same words, by their hash');
  assert.equal(task(db, t2).state, 'done', 'a draft is not an act');
  done();
});

test('a delivered fix ends done only when crewd saw its check fail before and pass after', { skip: !sandboxReady() && 'bubblewrap is not usable here' }, async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('support', 'Desk', 'person');
  const space = disk.botDir(cfg, 'desk'), repo = join(space, 'work', 'app');
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', repo, ...a], { encoding: 'utf8' });
  mkdirSync(repo, { recursive: true });
  git('init', '-q');
  writeFileSync(join(repo, 'add.sh'), 'echo $(($1 - $2))\n'); // the bug: it subtracts
  git('add', '-A'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  const patch = (fix: boolean, name: string) => {
    writeFileSync(join(repo, 'check.sh'), '[ "$(sh add.sh 2 3)" = 5 ]\n');
    if (fix) writeFileSync(join(repo, 'add.sh'), 'echo $(($1 + $2))\n');
    git('add', '-A');
    mkdirSync(join(space, 'files'), { recursive: true });
    writeFileSync(join(space, 'files', name), git('diff', '--cached', base));
    git('reset', '-q', '--hard', base);
    return `files/${name}`;
  };
  const verify = (p: string) => call('crew_verify', { repo: 'work/app', base, patch: p, tests: ['check.sh'], command: 'sh check.sh' });
  const job = async (text: string) => { const t = (await crew.post('desk', text))!.task; await settled(db, t); return task(db, t); };

  // Delivered and never checked: not sure, in crewd's words.
  const good = patch(true, 'fix.patch');
  const bare = await job(`fix it ${call('crew_deliver', { path: good })}`);
  assert.equal(bare.state, 'unsure');
  assert.match(bare.result, /^I suggested a fix \(files\/fix\.patch\), but it wasn't seen to fail before it and pass after it/);

  // Checked by crewd: the check fails on the old code and passes with the fix.
  const proved = await job(`fix it ${verify(good)} ${call('crew_deliver', { path: good })}`);
  assert.equal(proved.state, 'done');
  const v = events(db, 'verify.result').at(-1);
  assert.deepEqual([v.passed, v.after, v.task], [true, 0, proved.id]);
  assert.notEqual(v.before, 0);

  // A "fix" whose check never failed proves nothing.
  const idle = patch(false, 'noop.patch');
  const noop = await job(`fix it ${verify(idle)} ${call('crew_deliver', { path: idle })}`);
  assert.equal(events(db, 'verify.result').at(-1).passed, false);
  assert.equal(noop.state, 'unsure');

  // Checked in an earlier job, the same patch still counts; changed since, it doesn't.
  assert.equal((await job(`send it ${call('crew_deliver', { path: good })}`)).state, 'done');
  writeFileSync(join(space, good), '');
  assert.equal((await job(`send it ${call('crew_deliver', { path: good })}`)).state, 'unsure');
  done();
});
