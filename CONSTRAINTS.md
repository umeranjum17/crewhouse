# Constraints

Crewhouse's quality bar. Floor only for now: the rules below need no setup, and each is
either machine-checked on every diff by `node scripts/floor-guard.mjs` (exit `1` blocks)
or review-enforced, as marked. Numbered dimensions may be added later per the
constraint-driven-development skill; until then the installed project checks —
`npm run check` (tsc, strict) and `./crewhouse test` — are the required gates, and this
file is not a replacement for them.

## Floor (always enforced, no setup required)

Machine-checked by the guard on every diff:

- No new suppression comments: `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `# noqa`, `# type: ignore`
- No unimplemented stubs: `throw new Error("Not implemented")`, empty `catch {}`, `TODO` where the implementation should be
- No skipped or deleted tests and no removed assertions without a recorded reason: a commit message in the change that names the file, or a `.constraintsignore` entry
- This file does not get weakened to make a change pass

Review-enforced (the guard has no scanner for these):

- No secrets in source

The guard watches the diff (added and removed lines, untracked files included) against
the merge base, so the floor applies to change, not to history. Tightening is silent;
loosening is loud. Report the rule and the location, never a matched secret's value.
