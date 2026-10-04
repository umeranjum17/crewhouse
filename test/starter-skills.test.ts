// The starter-skill pins and their review record, checked offline: every reviewed skill has a live pin in
// trusted-skills.json (the shape the trust gate reads), the record matches the pins, and the served words stay plain.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const policy = fileURLToPath(import.meta.resolve('@byokit/openclaw').replace(/dist\/index\.js$/, 'policy/policy.mjs'));
const trusted = JSON.parse(readFileSync(fileURLToPath(new URL('../src/openclaw/trusted-skills.json', import.meta.url)), 'utf8'));
const record = JSON.parse(readFileSync(fileURLToPath(new URL('../src/openclaw/starter-skills.json', import.meta.url)), 'utf8'));

test('every reviewed starter skill carries a live pin, and the record matches it', () => {
  assert.ok(record.approved.length > 0 && record.approved.length <= 10, 'up to ten, none unreviewed');
  for (const s of record.approved) {
    for (const f of ['owner', 'slug', 'name', 'version', 'sha256', 'summary', 'why', 'needs', 'reviewedBy', 'reviewedAt'])
      assert.ok(s[f] !== undefined && s[f] !== '', `${s.slug} records ${f}`);
    const pin = trusted.find((t: any) => t.source === 'clawhub' && t.id === s.slug);
    assert.ok(pin, `${s.slug} has a clawhub pin in trusted-skills.json`);
    assert.equal(pin.version, s.version, `${s.slug} pin version matches the review`);
    assert.equal(pin.sha256, s.sha256, `${s.slug} pin hash matches the review`);
    assert.match(pin.sha256, /^[0-9a-f]{64}$/, `${s.slug} pin is a sha256`);
    for (const words of [s.summary, s.why, ...s.needs]) {
      assert.doesNotMatch(words, /token|host\b|engine|grant|command|`|\/home\/|\.md\b|\/api\//i, `${s.slug} speaks plainly`);
      assert.ok(words.length <= 140, `${s.slug} fits on a card`);
    }
  }
});

test('the pin shape passes the real trust gate, and anything unpinned is blocked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'starter-pins-'));
  try {
    // A staged SKILL.md hashed the way the gate hashes it: the repo's pin shape allows it.
    const staged = join(dir, 'staged', 'weather');
    mkdirSync(staged, { recursive: true });
    writeFileSync(join(staged, 'SKILL.md'), '---\nname: weather\n---\nread-only sample');
    const hash = createHash('sha256').update(readFileSync(join(staged, 'SKILL.md'))).digest('hex');
    const file = join(dir, 'trusted.json');
    writeFileSync(file, JSON.stringify([{ source: 'clawhub', id: 'weather', version: '1.0.0', sha256: hash }]));
    const ask = (request: object) => JSON.parse(execFileSync(process.execPath, [policy],
      { input: JSON.stringify(request), env: { PATH: process.env.PATH, BYOKIT_TRUSTED_SKILLS: file, BYOKIT_OWN_ROOTS: '[]' } }).toString());
    const base = { protocolVersion: 1, targetType: 'skill', targetName: 'weather', source: { kind: 'clawhub' },
      origin: { slug: 'weather', version: '1.0.0' }, sourcePath: staged, sourcePathKind: 'directory', request: { kind: 'skill-install' } };
    assert.equal(ask(base).decision, 'allow', 'the pin shape opens the gate');
    // A different skill's bytes under the same request shape: no pin, no entry.
    const other = join(dir, 'staged', 'unreviewed');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'SKILL.md'), '---\nname: unreviewed\n---\nsomething else');
    assert.equal(ask({ ...base, targetName: 'unreviewed', origin: { slug: 'unreviewed', version: '9.9.9' }, sourcePath: other }).decision, 'block', 'outside the set stays outside');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
