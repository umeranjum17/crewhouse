// The career plan (web/src/career.ts) states facts about visas and employers, so each one carries its proof: a source page,
// the date that page shows, and the page's own words. The live check that the words are still on the page is
// `node scripts/check-career-sources.mjs` (a release check: it needs the network). This test holds the shape offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATH_NOTE, PLAN, SOURCES, path } from '../web/src/career.ts';

test('every claim in the career plan cites a real page, its date and the page\'s own words', () => {
  assert.equal(path().length, 4, 'four stages');
  const today = new Date().toISOString().slice(0, 10);
  for (const [key, s] of Object.entries(SOURCES)) {
    assert.match(s.url, /^https:\/\/[a-z.]+\/\S*$/, `${key}: an https page`);
    assert.match(s.on, /^\d{4}-\d{2}-\d{2}$/, `${key}: a dated source`);
    assert.ok(s.on <= today, `${key}: not dated in the future`);
    assert.ok(s.by && s.page, `${key}: says who and which page`);
  }
  let claims = 0;
  for (const st of PLAN) for (const it of st.items) for (const c of it.claims) {
    claims++;
    assert.ok(SOURCES[c.src], `${it.title}: source ${c.src} exists`);
    assert.ok(c.says.length > 12 && c.quote.length >= 12, `${it.title}: a claim and its words`);
  }
  assert.ok(claims >= 30, `${claims} claims`);
  for (const st of path()) for (const it of st.items) for (const c of it.claims) assert.match(c.when, /^(updated|checked|current as of) \d{1,2} [A-Z][a-z]{2} \d{4}$/, 'a date a person can read');
});

test('the career plan is information, never advice, and asks for nothing about the person', () => {
  const all = JSON.stringify([PATH_NOTE, path().map((s) => [s.name, s.line, s.note, s.items.map((i) => [i.title, i.line, i.note, i.claims.map((c) => c.says)])])]);
  assert.match(PATH_NOTE.join(' '), /not legal advice/);
  assert.match(PATH_NOTE.join(' '), /never asks for your citizenship, visa status, pay or notice period/);
  assert.doesNotMatch(all, /\byou should (apply|file|choose)\b|\bwe recommend\b|\byou (qualify|are eligible)\b/i, 'no advice as legal fact');
  for (const f of ['career.tsx']) {
    const src = readFileSync(join(import.meta.dirname, '..', 'web', 'src', f), 'utf8');
    assert.doesNotMatch(src, /<input|<textarea|<select|api\.|fetch\(/, 'the plan screen collects and sends nothing');
  }
});
