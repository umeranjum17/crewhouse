// The recoverable-curation boundary (handled inbox 003, option B): before any collection review crewd captures the
// person's learned-skills folder with its own git versioning, refuses the review when the capture cannot be verified,
// and can bring a dropped or rewritten skill back even after later edits. Tests run against a real workspace on disk,
// laid out the way the engine itself reads it: workspaceOf() is the skills root and each skill sits directly inside
// it (`<name>/SKILL.md`), because the gateway scans `<workspace>/skills/<name>/SKILL.md`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { faked } from './kit-fake.ts';

const fixture = () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-curation-'));
  const runtime = new OpenClawRuntime(state);
  // The real state-dir layout: workspaceOf() is the skills root itself.
  const ws = () => runtime.workspaceOf();
  const skill = (name: string, body: string) => {
    mkdirSync(join(ws(), name), { recursive: true });
    writeFileSync(join(ws(), name, 'SKILL.md'), body);
  };
  const read = (name: string) => readFileSync(join(runtime.workspaceOf(), name, 'SKILL.md'), 'utf8');
  const git = (...args: string[]) => spawnSync('git', ['-C', ws(), ...args], { encoding: 'utf8' }).stdout.trim();
  return { state, runtime, ws, skill, read, git, done: () => rmSync(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
};

test('curation capture: verified before the review, and a failed capture refuses it', async () => {
  const f = fixture();
  try {
    f.skill('fare-check', '# Fare Check');
    const hash = f.runtime.captureLearned();
    assert.ok(hash, 'the capture committed');
    assert.match(f.git('log', '--format=%s'), /Before the skill collection review/, 'the capture is in history');
    // The recorded hashes match the captured files at the real layout: the verification is real, not a promise.
    const body = f.git('show', `${hash}:fare-check/SKILL.md`);
    assert.equal(body, '# Fare Check');

    // A workspace that cannot be captured (the folder is gone) refuses the review instead of running it.
    rmSync(f.ws(), { recursive: true, force: true });
    assert.throws(() => f.runtime.captureLearned(), /capture failed/);
    // The learned-skill folder is untouched by the refusal: nothing was deleted to make the capture work.
    f.skill('fare-check', '# Fare Check');
    assert.equal(f.runtime.captureLearned().length > 0, true);
  } finally { f.done(); }
});

test('curation restore: lands at the real workspace path the runtime reads, never a doubled skills/skills', async () => {
  const f = fixture();
  try {
    f.skill('fare-check', '# Fare Check v1');
    const capture = f.runtime.captureLearned();
    rmSync(join(f.ws(), 'fare-check'), { recursive: true, force: true });
    f.runtime.restoreLearned('fare-check', capture);
    // Read back through the same path the runtime uses (workspaceOf is the engine's own skills root).
    assert.equal(f.read('fare-check'), '# Fare Check v1', 'the restore is readable where the gateway scans');
    // The old doubled destination must not exist: workspaceOf already ends in /skills.
    assert.equal(existsSync(join(f.ws(), 'skills', 'fare-check', 'SKILL.md')), false, 'no doubled skills/skills path');
  } finally { f.done(); }
});

test('curation restore: a skill dropped before later edits and reviews comes back byte-for-byte', async () => {
  const f = fixture();
  try {
    f.skill('fare-check', '# Fare Check v1');
    const capture = f.runtime.captureLearned();
    // "The review drops it": gone from the workspace. Then later work happens (another skill, and a different new
    // skill re-created under the same name — the restore must still win from the pre-change capture).
    f.git('rm', '-rq', 'fare-check');
    f.skill('later-thing', '# Later');
    f.runtime.captureLearned();
    f.skill('fare-check', '# Fare Check v2 (a different skill re-created under the same name)');
    assert.equal(f.git('status', '--porcelain').includes('fare-check'), true, 'the newer same-name skill is uncommitted work');
    // Restore from the pre-change capture wins over the newer same-name skill, and records itself.
    f.runtime.restoreLearned('fare-check', capture);
    assert.equal(f.read('fare-check'), '# Fare Check v1', 'read back at the real layout path');
    assert.match(f.git('log', '--format=%s'), /Restored fare-check/, 'the restore is its own commit');
  } finally { f.done(); }
});

test('curation restore: an unverifiable capture is refused before mutation', async () => {
  const f = fixture();
  try {
    f.skill('fare-check', '# Fare Check');
    const capture = f.runtime.captureLearned();
    f.skill('fare-check', '# Changed');
    const before = f.read('fare-check');
    const history = f.git('rev-parse', 'HEAD');
    const status = f.git('status', '--porcelain');
    assert.throws(() => f.runtime.restoreLearned('fare-check', 'missing-capture'), /no learned-skill capture/);
    assert.equal(f.read('fare-check'), before);
    assert.equal(f.git('rev-parse', 'HEAD'), history);
    assert.equal(f.git('status', '--porcelain'), status);
    assert.ok(capture);
  } finally { f.done(); }
});

test('curation restore: is byte-for-byte, keeping leading and trailing whitespace, indentation and the final newline', async () => {
  const f = fixture();
  try {
    // No final newline, leading indentation, blank lines and trailing spaces: everything a trim would quietly drop.
    const tricky = '   leading spaces line\n\ttab-indented line with trailing spaces   \n\n\t\nlast line without a newline   ';
    f.skill('fare-check', tricky);
    const original = readFileSync(join(f.ws(), 'fare-check', 'SKILL.md'));
    const capture = f.runtime.captureLearned();
    rmSync(join(f.ws(), 'fare-check'), { recursive: true, force: true });
    f.runtime.restoreLearned('fare-check', capture);
    const restored = readFileSync(join(f.ws(), 'fare-check', 'SKILL.md'));
    assert.ok(restored.equals(original), `the restored file is byte-identical to the captured blob (${restored.length} vs ${original.length} bytes)`);
  } finally { f.done(); }
});

test('the current review end to end: one window allows one reviewer call, and its cleanup restores byte-faithfully', async () => {
  const f = faked({ gate: () => ({ allow: false, reason: 'no runs here' }), call: () => { throw new Error('no calls in this test'); } });
  const { runtime, ask } = f;
  try {
    await f.started;
    // The real layout and real executable paths: the runtime's own skills roots, its own git capture, and the
    // bridge socket the engine's reviewer speaks on. The engine keys the reviewer session
    // `agent:<agentId>:skill-collection-review:incognito-<uuid>`, minted fresh per run — unknowable beforehand.
    const tricky = '\n  # Fare Check\n\n\tKeeps its indentation, trailing spaces   \nand final newline.\n';
    mkdirSync(join(runtime.workspaceOf(), 'fare-check'), { recursive: true });
    writeFileSync(join(runtime.workspaceOf(), 'fare-check', 'SKILL.md'), tricky);
    const original = readFileSync(join(runtime.workspaceOf(), 'fare-check', 'SKILL.md'));
    // The CURRENT review's coverage, for the person: captured before the window opens, like runCollectionReview does.
    const capture = runtime.captureLearned();
    runtime.armCuration();
    // (b) The window is one call wide: the current review's own reconcile passes, then nothing does — no replay,
    // no old or different review re-running under a fresh incognito key, no leftover agent, no other tool, and
    // after the disarm in runCollectionReview's finally, not even the reviewer again.
    const reviewer = { kind: 'gate', key: `agent:m1:skill-collection-review:incognito-${randomUUID()}`, tool: 'skill_workshop', input: { action: 'reconcile' } };
    assert.equal((await ask(reviewer)).allow, true, 'the current review may run its one reconcile');
    assert.equal((await ask(reviewer)).allow, false, 'no replay of the allowed call');
    const rerun = { kind: 'gate', key: `agent:m1:skill-collection-review:incognito-${randomUUID()}`, tool: 'skill_workshop', input: { action: 'reconcile' } };
    assert.equal((await ask(rerun)).allow, false, 'an old or different review cannot reuse the window via its prefix');
    assert.equal((await ask({ kind: 'gate', key: `agent:m2:skill-collection-review:incognito-${randomUUID()}`, tool: 'skill_workshop', input: { action: 'reconcile' } })).allow, false, "a leftover agent's review is denied");
    assert.equal((await ask({ kind: 'gate', key: reviewer.key, tool: 'bash', input: { command: 'ls' } })).allow, false, 'the window is workshop-only');
    runtime.kit.disallowOnce();
    assert.equal((await ask(reviewer)).allow, false, 'a closed window denies everything');
    // (a) The review's cleanup lands on the person: the skill is dropped, and unrelated later work
    // happens on top before anyone notices.
    rmSync(join(runtime.workspaceOf(), 'fare-check'), { recursive: true, force: true });
    mkdirSync(join(runtime.workspaceOf(), 'later-thing'), { recursive: true });
    writeFileSync(join(runtime.workspaceOf(), 'later-thing', 'SKILL.md'), '# Later\n');
    // (c) The current capture brings the cleanup back byte for byte; nothing unrelated moves, in the workspace.
    runtime.restoreLearned('fare-check', capture);
    assert.ok(readFileSync(join(runtime.workspaceOf(), 'fare-check', 'SKILL.md')).equals(original), 'the restore is byte-identical, whitespace included');
    assert.equal(readFileSync(join(runtime.workspaceOf(), 'later-thing', 'SKILL.md'), 'utf8'), '# Later\n', 'unrelated later edits stay intact');
  } finally { await f.done(); }
});

test('curation trigger: a refused capture never opens the workshop window', async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-curation-run-'));
  const runtime = new OpenClawRuntime(state);
  let armed = 0;
  runtime.kit.allowOnce = () => { armed++; };
  try {
    // No workspace on disk at all: the capture would fail, so the review must be refused and the window never opens.
    await assert.rejects(() => runtime.runCollectionReview(), /capture failed|not enabled|not ready/i);
    assert.equal(armed, 0, 'the workshop window never opened');
  } finally { await runtime.stop().catch(() => {}); rmSync(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
