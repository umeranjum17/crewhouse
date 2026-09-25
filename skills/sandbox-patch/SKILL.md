---
name: sandbox-patch
description: Propose a small fix as a patch and have Crewhouse prove it in a copy of the code. Use only when a triage found a small, plain fix.
says: Suggest a fix, with a check that fails without it and passes with it
---

# Prove a fix in a copy

1. In a branch of your clone at the issue's commit, write the check first: a test or script that shows the bug (it must fail on the old code).
2. Make the smallest change that fixes it. Keep the product's style; touch as few files as you can.
3. `git diff <commit> > files/support/N/fix.patch` (check and fix together).
4. Call crew_verify: `repo` your clone, `base` the commit, `patch` the file, `tests` the check's paths, `command` what installs and runs the check (for example `yarn install --frozen-lockfile --ignore-scripts && node scripts/check.mjs`).
5. Passed: deliver the patch. Not passed: say why, keep the patch out of files/, and do not claim a fix.
