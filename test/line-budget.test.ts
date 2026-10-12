// crewd's src/ line budget, measured after the one-person migration and entry-point deletions.
// Every change from here keeps src/ net <= 0; raising BUDGET needs an owner decision, with deletions elsewhere first.
// Raised 6838 -> 6856 for the marketplace import feature (Main1094): the thin crew_import hook, the shared
// seat path and the soul-reset guard; fetch/parse/map/write live unbudgeted in scripts/. The dead-code hunt
// recorded in the firstmate home (data/ch-crew-templates/budget-note.md) found nothing honest to delete.
// Raised 6856 -> 6876 for the crew-brain slice-1 shared profile (ch-crew-brain-1, awaiting owner
// decision): people/1/profile.md storage, the one shared prompt path and GET/PUT /api/profile.
// Raised 6876 -> 6888 for the Herdr first slice (ch-herdr-slice-1): the herdr gate entry in policy.ts, the
// on-demand herdrStatus probe in tools.ts and GET /api/herdr. The paired trim lane ch-src-trim-s3 compacted
// single-use declarations back out of src/, restoring BUDGET to 6876.
// Raised 6876 -> 7026 for the guarded Gmail send path (ch-explee-send-path): the person-only send card, the
// person-attested eligibility record and the durable suppression list. The paired trim lane ch-src-trim-s2
// compacted single-use declarations back out of src/, restoring BUDGET to 6876.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Raised 6876 -> 6927 for the packaged download's first-use tool install (ch-ob-desktop-deb, owner
// exception): the admission wait, the shared install map with its 10-minute stall bound and group kill,
// and the shutdown cleanup. No trim paired: the install path is the feature.
// Raised 6927 -> 6937 for Chief's case follow-ups (ch-notice-followup, owner exception): the cases table,
// the held-facts lookup and the crew_case tool. No trim paired: the case store is the feature.
// Raised 6937 -> 6938 for the Memory row's Forget on a held case (owner extended the exception): the one
// POST /api/cases/forget route. No trim paired: the Forget is the person's control over the case store.
const BUDGET = 6938;

test('src stays within its line budget', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const files = readdirSync(root, { encoding: 'utf8', recursive: true }).filter((f) => f.endsWith('.ts'));
  const lines = files.map((f) => readFileSync(join(root, f), 'utf8').split('\n').length).reduce((a, b) => a + b, 0);
  assert.ok(lines <= BUDGET, `src is ${lines} lines against a ${BUDGET} budget: delete before adding`);
});
