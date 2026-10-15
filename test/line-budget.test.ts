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
// Raised 6927 -> 6954 for the locked-PDF unlock card (ch-secret-card, owner exception per Main-crewhouse decisions A and review-2, no trim lane).
// Raised 6954 -> 6999 for saving an email attachment (ch-gmail-attachments): listing a conversation's attachments and
// saving one into the helper's own files/ folder, with its size bound, sanitised name and plain refusals. The paired
// trim lane ch-src-trim-s4 compacts single-use declarations back out of src/, restoring BUDGET to 6954.
// Raised 6999 -> 7098 for charts in crew_workbook (ch-cap-charts, Firstmate decision A3): exceljs cannot write a chart,
// so crewd adds the DrawingML chart parts itself and reads them back for the preview. The paired trim lane ch-src-trim-charts
// compacted single-use declarations back out of src/, restoring BUDGET to 6999.
// Raised 6999 -> 7010 for the OpenCode Go key sign-in through the kit (ch-opencode-go-route, owner exception):
// OpenClawRuntime.keyIn and its addKey branch, the kit route row. No trim paired: the kit path is the feature.
// Raised 7010 -> 7166 for finished slide decks (ch-cap-slides): the .pptx writer, crew_slides and preview readback.
// This is this change's own net; paired trim lane ch-src-trim-slides restores BUDGET to 7010 in two slices.
// Slice 1 joins adjacent declarations in artifact/supporting modules: src 7165 -> 7073 (net -92).
// ch-src-trim-slides-final carries the remaining crew.ts trim back to 7010.
// Raised 7073 -> 7172 for Chief reply-as-draft and labels (ch-cap-email-reply-v2, mission-only exception): the +99
// allocated against its measured base, where the mission's own net is +98 (src 7043 -> 7141 on this rebase).
// Paired ch-src-trim-mail retires the allocation after landing.
const BUDGET = 7172;

test('src stays within its line budget', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const files = readdirSync(root, { encoding: 'utf8', recursive: true }).filter((f) => f.endsWith('.ts'));
  const lines = files.map((f) => readFileSync(join(root, f), 'utf8').split('\n').length).reduce((a, b) => a + b, 0);
  assert.ok(lines <= BUDGET, `src is ${lines} lines against a ${BUDGET} budget: delete before adding`);
});
