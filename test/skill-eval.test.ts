// The paired skill eval, end to end on the stub engine: the same prompts with and without a bundled skill, each
// run's document checked against the rubric, every raw run kept in a JSONL file, and the two arms diffed. A skill
// that does not beat the baseline has to be said so plainly, so a skill with no steps is measured too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = join(import.meta.dirname, '..');
const eval_ = (args: string[]) => execFileSync(process.execPath, [join(REPO, 'scripts/skill-eval.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' });
const runs = (dir: string) => readFileSync(join(dir, 'results.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

test('the bundled research skill beats the no-skill arm, and every run is kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crewhouse-skill-eval-'));
  try {
    const out = eval_(['--out', dir]);
    const all = runs(dir);
    assert.equal(all.length, 16, 'eight prompts, two arms each');
    for (const run of all) {
      assert.equal(run.task_state, 'done', `the ${run.arm} run of ${run.prompt_id} did not finish`);
      assert.ok(run.document, `the ${run.arm} run of ${run.prompt_id} delivered no document`);
      assert.equal(run.offered, run.arm === 'with', `the ${run.arm} arm of ${run.prompt_id} had the wrong skill on offer`);
    }
    // The skill's description matches the prompts it is for, and leaves the two negatives alone.
    const fired = all.filter((r) => r.arm === 'with' && r.should_trigger);
    assert.ok(fired.every((r) => r.trigger_fired), 'a prompt that should fire did not');
    assert.ok(all.filter((r) => r.arm === 'with' && !r.should_trigger).every((r) => !r.trigger_fired), 'a negative prompt fired');
    // The report says plainly which arm won.
    assert.match(out, /The skill beats the baseline/, 'the harness did not say the skill beats the baseline');
    assert.match(out, /\(\+\d+\)/, 'the harness did not say by how much');
    const with_ = all.filter((r) => r.arm === 'with').reduce((sum, r) => sum + r.passed, 0);
    const without = all.filter((r) => r.arm === 'without').reduce((sum, r) => sum + r.passed, 0);
    assert.ok(with_ > without, `the skill did not beat the baseline (${with_} against ${without})`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a skill with no steps does not beat the baseline, and the harness says so', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crewhouse-skill-eval-'));
  const weak = join(dir, 'crewhouse-weak-research');
  try {
    mkdirSync(weak, { recursive: true });
    writeFileSync(join(weak, 'SKILL.md'), '---\nname: crewhouse-weak-research\ndescription: Research a question on the web.\n---\n\n# Weak research\n\nLook things up and write it down.\n');
    const out = eval_(['--skill-file', join(weak, 'SKILL.md'), '--out', join(dir, 'out')]);
    assert.match(out, /does NOT beat the baseline/, 'the harness did not say the skill does not beat the baseline');
    assert.match(out, /does not ship in this form/, 'the harness did not say what that means for shipping');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
