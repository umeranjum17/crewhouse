---
name: sandbox-patch
description: Propose a small change as a patch and have Crewhouse prove it in a copy of the code. Use only when a triage found a small, plain change.
says: Suggest a change, with a check that fails without it and passes with it
---

# Suggest a change, proved in a copy

The patch you end up with is a SUGGESTED CHANGE for the maintainer to review: it is never applied, never pushed, and never called a fix — not in the reply, not in the delivery note.

1. In a branch of your clone at the issue's commit, write the check first: a test or script that shows the bug (it must fail on the old code).
2. Make the smallest change that fixes it. Keep the product's style; touch as few files as you can.
3. `git diff <commit> > files/support/N/suggested.patch` (check and fix together).
4. Call crew_verify: `repo` your clone, `base` the commit, `patch` the file, `tests` the check's paths, `command` what installs and runs the check (for example `yarn install --frozen-lockfile --ignore-scripts && node scripts/check.mjs`).
5. Passed: deliver the patch — a suggested change for the maintainer to review. Not passed: say why, keep the patch out of files/, and do not call it a fix.
