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
import { createServer } from 'node:http';
import { once } from 'node:events';
// @ts-expect-error: a plain script, no types
import { validate } from '../scripts/validate-support.mjs';

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

test('the validator checks a run against crewd\'s record: issues read, citations real, the answer kept, blind or not', async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  // An unfenced helper: the local stand-in for GitHub is (rightly) off the support desk's list. The validator doesn't care which.
  crew.recruit('scribe', 'Desk', 'person');
  const srv = createServer((_q, res) => res.end('{"number":7}')).listen(0, '127.0.0.1');
  srv.unref();
  await once(srv, 'listening');
  const issue = `http://127.0.0.1:${(srv.address() as any).port}/repos/o/app/issues/7`;
  const space = disk.botDir(cfg, 'desk'), repo = join(space, 'work', 'app');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.ts'), 'one\ntwo\nthree\n');
  mkdirSync(join(repo, 'apps', 'mobile', 'sources', 'app', '(app)', 'session', '[id]'), { recursive: true });
  writeFileSync(join(repo, 'apps', 'mobile', 'sources', 'app', '(app)', 'session', '[id]', 'takeover.tsx'), 'one\ntwo\n');
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base');
  const at = git('rev-parse', 'HEAD').trim().slice(0, 12);
  const write = (n: number, triage: string) => {
    mkdirSync(join(space, 'files', 'support', String(n)), { recursive: true });
    writeFileSync(join(space, 'files', 'support', String(n), 'triage.md'), triage);
    writeFileSync(join(space, 'files', 'support', String(n), 'reply.md'), `Thanks. It is set in src/a.ts:2@${at}.\n`);
  };
  const run = async (n: number, fetch: string) => {
    const f = (p: string) => call('crew_deliver', { path: `files/support/${n}/${p}` });
    const t = (await crew.post('desk', `${fetch} ${f('triage.md')} ${f('reply.md')} ${call('crew_draft', { path: `files/support/${n}/reply.md`, to: `app issue #${n}` })}`))!.task;
    await settled(db, t);
    return t;
  };
  const verdicts = (t: number, forbid: string[] = []) => Object.fromEntries(validate({ db, crewDir: cfg.crewDir }, t, forbid).map((r: any) => [r.what, r.verdict]));
  const rowOf = (t: number, what: string, forbid: string[] = []) =>
    validate({ db, crewDir: cfg.crewDir }, t, forbid).find((r: any) => r.what === what)!;

  // A fenced range and a backticked range are citations like any single line, checked to the last line of the range.
  write(7, `Kind: bug. The value comes from src/a.ts:2@${at} and src/a.ts:3@${at}.
\`\`\`
src/a.ts:1-2@${at}
\`\`\`
Also \`src/a.ts:2-3@${at}\`.\n`);
  const good = await run(7, call('web_fetch', { url: issue }));
  assert.equal(verdicts(good)['answer on files/support/7/reply.md'], 'UNKNOWN', 'on a card, not answered yet');
  await crew.answer(db.get("SELECT id FROM asks WHERE kind = 'propose' AND state = 'open'")!.id, { answer: 'allow' });
  assert.deepEqual(verdicts(good), { ended: 'PASS', 'issues read': 'PASS', 'citations in files/support/7/triage.md': 'PASS', 'citations in files/support/7/reply.md': 'PASS',
    'answer on files/support/7/reply.md': 'PASS', fix: 'PASS', blind: 'UNKNOWN', tokens: 'PASS' });
  assert.match(rowOf(good, 'citations in files/support/7/triage.md').detail, /4 of 4 found/, 'the range citations were checked, not skipped');
  assert.equal(verdicts(good, ['/issues/7'])['blind'], 'FAIL', 'it reached the answer: contaminated');
  writeFileSync(join(space, 'files', 'support', '7', 'reply.md'), 'Other words.\n');
  assert.equal(verdicts(good)['answer on files/support/7/reply.md'], 'FAIL', 'the yes was for different words');

  // Wrote about an issue it never read; cited a line that isn't there, a range past the file's end, and an unknown commit.
  write(8, `Kind: bug. See src/a.ts:99@${at}, plus src/a.ts:2-99@${at} and src/a.ts:1-2@deadbee.\n`);
  const badTask = await run(8, '');
  const bad = verdicts(badTask);
  assert.deepEqual([bad['issues read'], bad['citations in files/support/8/triage.md']], ['FAIL', 'FAIL']);
  assert.match(rowOf(badTask, 'citations in files/support/8/triage.md').detail, /src\/a\.ts:2-99@.*src\/a\.ts:1-2@deadbee/s,
    'the range end past the file and the unknown commit are each named');

  // Route paths with () and [] are citations like any other; a range ending past the file's end fails.
  const route = 'apps/mobile/sources/app/(app)/session/[id]/takeover.tsx';
  write(9, `Kind: bug. The takeover screen is ${route}:1-2@${at}.\n`);
  const routed = await run(9, '');
  assert.equal(verdicts(routed)['citations in files/support/9/triage.md'], 'PASS', 'a route-path range citation is found');
  write(10, `Kind: bug. The takeover screen is ${route}:1-99@${at}.\n`);
  const past = await run(10, '');
  assert.equal(verdicts(past)['citations in files/support/10/triage.md'], 'FAIL', 'the range end is past the file');
  assert.match(rowOf(past, 'citations in files/support/10/triage.md').detail,
    new RegExp(`${route.replace(/[()[\]]/g, '\\$&')}:1-99`), 'the whole route path is named, not a truncated tail');

  // Blindness asks where it went, not what it wrote: naming the answer inside a heredoc is clean; fetching it is not.
  const leak = await run(7, [
    call('bash', { command: `cat > files/support/7/scratch.md <<'EOF'\nraw status snapshots/events for the same pane\nEOF` }),
    call('web_fetch', { url: `${issue}/comments` }),
    call('bash', { command: `curl -s ${issue}/comments` }),
    call('bash', { command: 'git fetch http://127.0.0.1:1/o/app.git fix-208' }),
    call('bash', { command: `node -e "fetch('${issue}/comments?per_page=30').catch(() => {})"` }),
    call('web_search', { query: 'merged fix pull request for the bug answer-key' }),
  ].join(' '));
  assert.equal(rowOf(leak, 'blind', ['/events']).verdict, 'PASS', 'words it wrote are not places it went');
  const reached = rowOf(leak, 'blind', ['/comments']);
  assert.equal(reached.verdict, 'FAIL', 'web_fetch and curl fetched the comments');
  assert.match(reached.detail, /web_fetch/);
  assert.match(reached.detail, /curl /);
  assert.equal(rowOf(leak, 'blind', ['fix-208']).verdict, 'FAIL', 'git fetch reaching for the fix is caught');
  assert.equal(rowOf(leak, 'blind', ['per_page=30']).verdict, 'FAIL', 'a read hidden in node is caught like any other');
  assert.equal(rowOf(leak, 'blind', ['answer-key']).verdict, 'FAIL', 'a web_search for the answer is caught too');
  srv.close();
  done();
});
