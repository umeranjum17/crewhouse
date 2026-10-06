// Scribe's own-voice drafts on the stub engine, against a fake `write` bin: the checks a real @byokit/write would
// run, the two revisions the skill allows, and the third failure that files the card anyway. Integration only:
// crew.post carries the model's scripted tool calls, and crewd's own run.call record is what is read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, task } from './lab.ts';

const call = (name: string, args: object) => `[tool ${name} ${JSON.stringify(args)}]`;
const app = (tool: string, args: string[]) => call('crew_app', { tool, input: { args } });
const RULES = '{"never":["excited to announce"],"noDashes":true,"statementEndings":false,"note":""}';

/** The fake binary, installed where a pinned kit's program lands: it records its argv, answers like the real CLI,
 *  and fails every check the way a bad draft does. */
function fakeWrite(cfg: { toolsDir: string }, log: string) {
  const bin = join(cfg.toolsDir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'write'), `#!/bin/sh
printf '%s\\n' "$*" >> ${log}
case "$1 $2" in
  'voice parse') printf 'rules: ${RULES}\\nskipped: 0\\n' ;;
  'brief '*) printf 'lines[1]:\\n  "On X: each draft fits one post (280)."\\n' ;;
  'check '*) printf 'drafts[1]{file,fits,length,limit,verdict}:\\n  files/draft.md,no,312,280,A bit stock\\nissues[2]{file,kind,detail}:\\n  files/draft.md,stock,thrilled to\\n  files/draft.md,too long\\nresult: 0 of 1 drafts pass\\n'; exit 1 ;;
  *) printf 'unknown\\n'; exit 2 ;;
esac
`, { mode: 0o755 });
  return bin;
}
const argv = (log: string) => readFileSync(log, 'utf8').trim().split('\n');

function scribeWith(log: string) {
  const { crew, db, cfg, done } = setup();
  crew.onboard('sir');
  crew.recruit('scribe', 'Scribe', 'person');
  fakeWrite(cfg, log);
  const calls = () => db.all("SELECT data FROM events WHERE kind = 'run.call' ORDER BY seq")
    .map((r: any) => JSON.parse(r.data).tool);
  const cards = () => crew.snapshot().asks.filter((a: any) => a.kind === 'propose' && a.detail.draft);
  return { crew, db, calls, cards, restore: done };
}

test('a failing check is revised twice, and the third failure files the card with the check\'s own words', async () => {
  const log = `/tmp/c4-write-${Date.now()}.log`;
  const { crew, db, calls, cards, restore } = scribeWith(log);
  try {
    // One voice parse of what the person gave, then the brief, then draft -> check, twice, then the third failure.
    const draft = (body: string) => call('crew_write', { path: 'files/draft.md', content: body })
      + app('write', ['check', '--platform', 'x', '--voice', RULES, 'files/draft.md']);
    const id = (await crew.post('scribe',
      call('crew_write', { path: 'growth/voice.md', content: '## Never say\n- "excited to announce"\n' })
      + app('write', ['voice', 'parse', 'growth/voice.md'])
      + app('write', ['brief', '--kind', 'post', '--platform', 'x', '--voice', RULES])
      + draft('Thrilled to announce something great!')
      + draft('Still stock, and still too long.')
      + draft('Checked: 0 of 1 pass — too long at 312 characters, over the 280 an X post takes.')
      + call('crew_draft', { path: 'files/draft.md', channel: 'post', to: 'X launch post' })))!.task;
    await settled(db, id);
    assert.equal(task(db, id).state, 'done');

    // The kit's own order: the voice file, one parse, one brief, three checks, then the card. Never a fourth try.
    assert.deepEqual(calls().filter((n: string) => ['write', 'crew_draft', 'crew_write'].includes(n)),
      ['crew_write', 'write', 'write', 'crew_write', 'write', 'crew_write', 'write', 'crew_write', 'write', 'crew_draft']);

    const runs = argv(log);
    assert.equal(runs[0], 'voice parse growth/voice.md');
    assert.equal(runs[1], `brief --kind post --platform x --voice ${RULES}`);
    assert.deepEqual([...new Set(runs.filter((r) => r.startsWith('check')))],
      [`check --platform x --voice ${RULES} files/draft.md`]);
    assert.equal(runs.filter((r) => r.startsWith('brief')).length, 1);
    assert.equal(runs.filter((r) => r.startsWith('check')).length, 3, 'two revisions, then the card');

    const card = cards();
    assert.equal(card.length, 1);
    assert.equal(card[0].detail.draft.to, 'X launch post');
    assert.match(card[0].detail.preview.body, /Checked: 0 of 1 pass — too long at 312 characters/, 'the card carries the check\'s own words');
  } finally { restore(); }
});

test('with no voice file yet, the check runs without it and still covers fit and stock phrasing', async () => {
  const log = `/tmp/c4-write-novoice-${Date.now()}.log`;
  const { crew, db, calls, restore } = scribeWith(log);
  try {
    const id = (await crew.post('scribe',
      app('write', ['brief', '--kind', 'post', '--platform', 'linkedin'])
      + call('crew_write', { path: 'files/draft.md', content: 'A post in plain words.' })
      + app('write', ['check', '--platform', 'linkedin', 'files/draft.md'])
      + call('crew_draft', { path: 'files/draft.md', channel: 'post', to: 'LinkedIn founder post' })))!.task;
    await settled(db, id);
    assert.deepEqual(calls().filter((n: string) => n === 'write'), ['write', 'write']);
    const runs = argv(log);
    assert.deepEqual(runs.map((r) => r.split(' ')[0]), ['brief', 'check']);
    for (const run of runs) assert.ok(!run.includes('--voice'), `no voice yet: ${run}`);
  } finally { restore(); }
});
