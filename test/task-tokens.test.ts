// CH-2: the task-token harness measures what it claims: every representative Scribe
// and Reel job settles with its cost in tasks.tokens, and a past state dir aggregates
// read-only. Runs on the stub model: no account, no network, no quota.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain script, no types
import { JOBS, measure, readState, report } from '../scripts/measure-task-tokens.mjs';
import { setup as lab, settled } from './lab.ts';

test('representative Scribe and Reel jobs settle with their cost in tasks.tokens', { timeout: 300_000 }, async () => {
  const out = await measure({ runs: 1 });
  assert.equal(out.rows.length, JOBS.length, 'one settled task per representative job');
  assert.deepEqual([...new Set(out.rows.map((r: any) => r.bot))].sort(), ['reel', 'scribe']);
  for (const row of out.rows) {
    assert.equal(row.state, 'done', `${row.bot}/${row.job} settled`);
    assert.ok(row.tokens > 0, `${row.bot}/${row.job} cost tokens (${row.tokens})`);
    assert.ok(row.turns >= 1, `${row.bot}/${row.job} took at least one turn`);
  }
  const text = report(out).text;
  assert.match(text, /\| scribe \| draft-email \| 1 \| \d+ \|/);
  assert.match(text, /\| reel \| demo-video \| 1 \| \d+ \|/);
  assert.match(text, /largest single task observed: \d+ tokens \(input to the CH-6 ceiling\)/);
});

test('readState aggregates a past state dir read-only and starts nothing', async () => {
  const { db, crew, cfg } = lab();
  crew.onboard('sir');
  crew.recruit('scribe', 'Scribe', 'person');
  const { task } = (await crew.post('scribe', 'Draft an email to the team'))!;
  await settled(db, task);
  const before = db.get('SELECT COUNT(*) AS n FROM tasks')!.n as number;
  const { byBot, recent } = readState(cfg.stateDir);
  assert.ok(byBot.find((b: any) => b.bot === 'scribe' && b.n >= 1), 'scribe tasks aggregated');
  assert.ok(recent.some((t: any) => t.id === task && t.tokens > 0), 'the settled task carries tokens');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM tasks')!.n, before, 'reading added no tasks');
});
