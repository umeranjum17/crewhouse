// The recoverable-curation boundary (handled inbox 003, option B): before any collection review crewd captures the
// member's learned-skills folder with its own git versioning, refuses the review when the capture cannot be verified,
// and can bring a dropped or rewritten skill back even after later edits. Tests run against a real workspace on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';

const fixture = () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-curation-'));
  const runtime = new OpenClawRuntime(state);
  const ws = runtime.workspaceOf(1);
  const skill = (name: string, body: string) => { mkdirSync(join(ws, 'skills', name), { recursive: true }); writeFileSync(join(ws, 'skills', name, 'SKILL.md'), body); };
  const git = (...args: string[]) => spawnSync('git', ['-C', ws, ...args], { encoding: 'utf8' }).stdout.trim();
  return { state, runtime, ws, skill, git, done: () => rmSync(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
};

test('curation capture: verified before the review, and a failed capture refuses it', async () => {
  const f = fixture();
  try {
    f.skill('fare-check', '# Fare Check');
    const hash = f.runtime.captureLearned(1);
    assert.ok(hash, 'the capture committed');
    assert.match(f.git('log', '--format=%s'), /Before the skill collection review/, 'the capture is in history');
    // The recorded hashes match the captured files: the verification is real, not a promise.
    const body = f.git('show', `${hash}:skills/fare-check/SKILL.md`);
    assert.equal(body, '# Fare Check');

    // A workspace that cannot be captured (the folder is gone) refuses the review instead of running it.
    rmSync(f.ws, { recursive: true, force: true });
    assert.throws(() => f.runtime.captureLearned(1), /capture failed/);
    // The learned-skill folder is untouched by the refusal: nothing was deleted to make the capture work.
    f.skill('fare-check', '# Fare Check');
    assert.equal(f.runtime.captureLearned(1).length > 0, true);
  } finally { f.done(); }
});

test('curation restore: a skill dropped before later edits and reviews comes back byte-for-byte', async () => {
  const f = fixture();
  try {
    f.skill('fare-check', '# Fare Check v1');
    const capture = f.runtime.captureLearned(1);
    // "The review drops it": gone from the workspace. Then later work happens (another skill, and a different new
    // skill re-created under the same name — the restore must still win from the pre-change capture).
    f.git('rm', '-rq', 'skills/fare-check');
    f.skill('later-thing', '# Later');
    f.runtime.captureLearned(1);
    f.skill('fare-check', '# Fare Check v2 (a different skill re-created under the same name)');
    assert.equal(f.git('status', '--porcelain').includes('fare-check'), true, 'the newer same-name skill is uncommitted work');
    // Restore from the pre-change capture wins over the newer same-name skill, and records itself.
    f.runtime.restoreLearned(1, 'fare-check', capture);
    assert.equal(f.git('show', 'HEAD:skills/fare-check/SKILL.md'), '# Fare Check v1');
    assert.match(f.git('log', '--format=%s'), /Restored fare-check/, 'the restore is its own commit');
  } finally { f.done(); }
});

test('curation trigger: a refused capture never opens the workshop window', async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-curation-run-'));
  const runtime = new OpenClawRuntime(state);
  try {
    // No workspace on disk at all: the capture would fail, so the review must be refused and the window never opens.
    await assert.rejects(() => runtime.runCollectionReview(1), /capture failed|not enabled|not ready/i);
    assert.equal(runtime.bridge?.curationArmed ?? false, false, 'the workshop window stayed closed');
  } finally { await runtime.stop().catch(() => {}); rmSync(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
