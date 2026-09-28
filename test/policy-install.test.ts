import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const policy = fileURLToPath(new URL('../src/openclaw/policy.mjs', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));

const ask = (request: object, env: Record<string, string> = {}) =>
  JSON.parse(execFileSync(process.execPath, [policy], { input: JSON.stringify(request), env: { ...process.env, ...env } }).toString());

test('install policy: crewhouse content passes, everything else is blocked by name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-'));
  try {
    // A skill staged from a bot's own folder is crewhouse's own content.
    const own = ask({ protocolVersion: 1, targetType: 'skill', targetName: 'find-leads', sourcePath: join(dir, 'crew', 'bots', 'desk', 'skills', 'find-leads'), sourcePathKind: 'directory', request: { kind: 'skill-install' } },
      { CREWHOUSE_CREW_DIR: join(dir, 'crew') });
    assert.equal(own.decision, 'allow');
    // A ClawHub skill with no entry: blocked, with the reason a person would say.
    const hub = ask({ protocolVersion: 1, targetType: 'skill', targetName: 'weather', source: { kind: 'clawhub' }, origin: { slug: 'weather', version: '1.0.0' }, sourcePath: join(dir, 'staged', 'weather'), sourcePathKind: 'directory', request: { kind: 'skill-install', requestedSpecifier: 'clawhub:weather@1.0.0' } });
    assert.equal(hub.decision, 'block');
    assert.match(hub.reason, /trusted list/);
    // A dependency installer inside any install: refused even in crewhouse's own space.
    const dep = ask({ protocolVersion: 1, targetType: 'skill', targetName: 'x', sourcePath: join(dir, 'crew', 'x'), request: { kind: 'skill-dependency-install' } },
      { CREWHOUSE_CREW_DIR: join(dir, 'crew') });
    assert.equal(dep.decision, 'block');
    // A bundled skill's content that was swapped after review: the hash no longer matches, blocked.
    mkdirSync(join(dir, 'staged', 'video-frames'), { recursive: true });
    writeFileSync(join(dir, 'staged', 'video-frames', 'SKILL.md'), 'tampered');
    const swapped = ask({ protocolVersion: 1, targetType: 'skill', targetName: 'video-frames', origin: { slug: 'video-frames', version: '2026.8.1' }, sourcePath: join(dir, 'staged', 'video-frames'), sourcePathKind: 'directory', request: { kind: 'skill-install' } });
    assert.equal(swapped.decision, 'block');
    // A broken request fails closed, never open.
    const bad = JSON.parse(execFileSync(process.execPath, [policy], { input: '{oops' }).toString());
    assert.equal(bad.decision, 'block');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
