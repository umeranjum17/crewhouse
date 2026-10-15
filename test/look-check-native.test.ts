// A regression on the look-check's native pixel cut detector (scripts/verify/look-check.mjs nativeCut), through its offline
// "native" replay mode: the real Android capture of Chief's header at the largest text, where uiautomator reports the
// node's full text "Needs you" while the screen drew "Needs ." — the ellipsis squeezed onto one dot, eleven pixels
// short of the node's own edge. On main the tree-only check found nothing here; the drawn dot must be a `clipped` hit.
// Needs a Chromium on PATH (skipped without one), like the other browser tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserBin } from '../src/desktop.ts';

const repo = join(import.meta.dirname, '..');
const script = join(repo, 'scripts', 'verify', 'look-check.mjs');
const fixture = join(repo, 'test', 'fixtures', 'chief-header-truncated');
const bin = browserBin();

test('look-check flags a status word the phone header drew cut, from a saved capture', { skip: !bin && 'no Chromium here' }, () => {
  const out = mkdtempSync(join(tmpdir(), 'look-check-native-'));
  try {
    const r = spawnSync(process.execPath, [script, 'native', '--out', out, '--xml', `${fixture}.xml`, `chief-header=${fixture}.png`],
      { encoding: 'utf8', env: { ...process.env, CHROME: bin! } });
    assert.equal(r.status, 1, `expected a hit, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    const hits: { kind: string; el: string; text: string }[] = JSON.parse(readFileSync(join(out, 'look-check.json'), 'utf8'))[0].hits;
    const cut = hits.find((h) => h.kind === 'clipped' && /Needs you/.test(h.el));
    assert.ok(cut, `no clipped hit for "Needs you": ${JSON.stringify(hits)}`);
    assert.match(cut!.text, /Needs you/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
