// A regression on the look-check's native pixel cut detector (scripts/verify/look-check.mjs nativeCut), through its offline
// "native" replay mode: the real Android capture of Chief's header at the largest text, where uiautomator reports the
// node's full text "Needs you" while the screen drew "Needs ." — the ellipsis squeezed onto one dot, eleven pixels
// short of the node's own edge. On main the tree-only check found nothing here; the drawn dot must be a `clipped` hit.
// The second case is the detector's own false positive, caught in ch-chat-md-quotes-lists: an ordered-list marker "2."
// at the largest text, whose digit's low terminal beside the period read as the native "…". Its own words end in a dot,
// so it must stay clean. Needs a Chromium on PATH (skipped without one), like the other browser tests.
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
const replay = (slug: string, svg: string, xml: string) => {
  const out = mkdtempSync(join(tmpdir(), 'look-check-native-'));
  const r = spawnSync(process.execPath, [script, 'native', '--out', out, '--xml', xml, `${slug}=${svg}`],
    { encoding: 'utf8', env: { ...process.env, CHROME: bin! } });
  const hits = JSON.parse(readFileSync(join(out, 'look-check.json'), 'utf8'))[0].hits;
  rmSync(out, { recursive: true, force: true });
  return { status: r.status, hits } as { status: number; hits: { kind: string; el: string; text: string }[] };
};

test('look-check flags a status word the phone header drew cut, from a saved capture', { skip: !bin && 'no Chromium here' }, () => {
  const { status, hits } = replay('chief-header', `${fixture}.png`, `${fixture}.xml`);
  assert.equal(status, 1, `expected a hit, got ${status}`);
  const cut = hits.find((h) => h.kind === 'clipped' && /Needs you/.test(h.el));
  assert.ok(cut, `no clipped hit for "Needs you": ${JSON.stringify(hits)}`);
  assert.match(cut!.text, /Needs you/);
});

test('look-check leaves an ordered-list marker whose own words end in a dot clean', { skip: !bin && 'no Chromium here' }, () => {
  const marker = join(repo, 'test', 'fixtures', 'chief-list-marker');
  const { status, hits } = replay('chief-list-marker', `${marker}.png`, `${marker}.xml`);
  assert.equal(status, 0, `a "2." marker must not be read as a cut: ${JSON.stringify(hits)}`);
});
