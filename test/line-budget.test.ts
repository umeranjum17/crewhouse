// crewd's src/ line budget: set to the measured count after the ch-src-trim pass (O0 deletions, then -37
// in folds: legacy-migration helper, onboard/pause/post shared paths, pass/handOn validation, needBot/needText,
// preview-route helper, npm pin-dir, job-parts check, soul read, net env, decide effect param, restating comments).
// Every change from here keeps src/ net <= 0; raising BUDGET needs an owner decision, with deletions elsewhere first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET = 7064;

test('src stays within its line budget', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const files = readdirSync(root, { encoding: 'utf8', recursive: true }).filter((f) => f.endsWith('.ts'));
  const lines = files.map((f) => readFileSync(join(root, f), 'utf8').split('\n').length).reduce((a, b) => a + b, 0);
  assert.ok(lines <= BUDGET, `src is ${lines} lines against a ${BUDGET} budget: delete before adding`);
});
