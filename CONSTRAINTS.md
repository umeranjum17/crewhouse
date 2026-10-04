# Constraints

Crewhouse's quality bar. Floor only for now: the always-enforced rules below need no
setup and run on every diff via `node scripts/floor-guard.mjs` (exit `1` blocks).
Numbered dimensions may be added later per the constraint-driven-development skill;
until then the installed project checks — `npm run check` (tsc, strict) and
`./crewhouse test` — are the required gates, and this file is not a replacement for them.

## Floor (always enforced, no setup required)

- No new suppression comments: `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `# noqa`, `# type: ignore`
- No unimplemented stubs: `throw new Error("Not implemented")`, empty `catch {}`, `TODO` where the implementation should be
- No skipped or deleted tests without a reason in the commit message
- No secrets in source
- This file does not get weakened to make a change pass

The guard watches the diff (added and removed lines, untracked files included) against
the merge base, so the floor applies to change, not to history. Tightening is silent;
loosening is loud. Report the rule and the location, never a matched secret's value.
