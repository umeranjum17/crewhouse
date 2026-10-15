#!/usr/bin/env node
// personal-voice.mjs — Crewhouse is a personal assistant for ONE person. No screen,
// capture, demo seed or Chief prompt may speak about a family, a household or a team.
//
//   node scripts/personal-voice.mjs              # scan the copy sources (default list)
//   node scripts/personal-voice.mjs path…        # scan only these files/dirs
//   node scripts/personal-voice.mjs --self-test  # the negative test: it must FAIL on a
//                                                 known-bad string and pass a known-good one
//
// exit 0 clean / 1 a hit / 2 could not run. A hit is a blocker fixed at the producer
// (the seed, the prompt, the component) — never edited out of a screenshot.
//
// ponytail: a fixed word list and a fixed path list, not a configurable policy file;
// add a term here when a real hit gets through.
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { tmpdir } from 'node:os';

// `family`/`families`/`household`/`team` — wording that implies several people share the
// product. A person's own mum is not that: one person, one household-less assistant.
// The lookbehind keeps CSS `font-family` and id names like `householdId` out.
const TERMS = [
  [/(?<![-\w])(famil(?:y|ies))(?![-\w])/i, 'family'],
  [/household(?![-\w])/i, 'household'],
  [/(?<![-\w])teams?(?:mates?)?(?![-\w])/i, 'team'],
];
// The copy surfaces, not the whole tree: the demo seed and generator, the screen
// components, the phone screens, and the prompts a helper or Chief speaks from.
// Server internals hold no user-visible wording (their "family"/"teams" tokens are code).
const DEFAULTS = ['web/src/demo.ts', 'web/src/*.tsx', 'mobile/src/*.tsx', 'templates'];
const SKIP = new Set(['node_modules', 'dist', '.git', 'evidence']);
const TEXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt']);

// A hit: the term, where, and the line, so the producer is findable in one read.
export function scan(files) {
  const hits = [];
  for (const file of files) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      if (line.includes('personal-voice.mjs')) return; // this file names every term on purpose
      for (const [re, term] of TERMS) if (re.test(line)) hits.push({ file, line: i + 1, term, text: line.trim().slice(0, 120) });
    });
  }
  return hits;
}

const walk = (root) => {
  // `dir/*.tsx` is a fixed glob: list the folder and match the tail.
  if (root.includes('*')) {
    const i = root.lastIndexOf('/');
    const re = new RegExp('^' + root.slice(i + 1).replaceAll('.', '\\.').replace('*', '.*') + '$');
    try { return readdirSync(root.slice(0, i)).filter((f) => re.test(f)).map((f) => join(root.slice(0, i), f)); }
    catch { return []; }
  }
  const out = [];
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP.has(p.split('/').pop() ?? '')) continue;
      for (const e of readdirSync(p)) stack.push(join(p, e));
    } else if (TEXT.has(extname(p))) out.push(p);
  }
  return out;
};

// The negative test. A bad fixture must produce a finding (exit 1 path) and a clean one
// none (exit 0). If a later edit empties TERMS, this fails instead of passing silently.
const selfTest = () => {
  const dir = mkdtempSync(join(tmpdir(), 'personal-voice.'));
  const bad = join(dir, 'seed.ts');
  const good = join(dir, 'component.tsx');
  writeFileSync(bad, "export const title = 'Family budget';\n");
  writeFileSync(good, "export const title = 'My budget';\nconst s = 'font-family: Inter';\n");
  const badHits = scan([bad]), goodHits = scan([good]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`failing case: ${badHits.length} hit(s) — ${badHits.map((h) => `[${h.term}] ${h.text}`).join(', ') || 'none'}`);
  console.log(`passing case: ${goodHits.length} hit(s)${goodHits.length ? ' — ' + goodHits.map((h) => h.text).join(', ') : ''}`);
  if (badHits.length !== 1 || goodHits.length !== 0) {
    console.error('personal-voice: self-test FAILED — the check no longer fails on a known-bad string');
    process.exit(1);
  }
  console.log('personal-voice: self-test ok');
  process.exit(0);
};

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();

const roots = args.filter((a) => !a.startsWith('-'));
const files = (roots.length ? roots : DEFAULTS).flatMap((r) => {
  if (!r.includes('*')) {
  if (!existsSync(r)) { console.error('personal-voice: no such path ' + r); process.exit(2); }
  return statSync(r).isDirectory() ? walk(r) : [r];
}
return walk(r);
});
if (files.length === 0) { console.error('personal-voice: nothing to scan'); process.exit(2); }

const hits = scan(files);
console.log(`personal-voice: ${files.length} file(s) scanned`);
if (!hits.length) { console.log('personal-voice: clean'); process.exit(0); }
console.error(`personal-voice: ${hits.length} family/household/team wording hit(s) — one person, one assistant:`);
for (const h of hits) console.error(`  ${relative(process.cwd(), h.file) || h.file}:${h.line}  [${h.term}] ${h.text}`);
console.error('\nFix the producer (the seed, the prompt, the component), then re-run. Never edit a screenshot.');
process.exit(1);