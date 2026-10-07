# Bumping the engine pin

The kit installs and supervises its own pinned copy of OpenClaw as a verified read-only set under `runtime/openclaw.sets/` (keyed by the kit's `engineDir`, `runtime/openclaw`).
There is no committed mirror of the engine in this repo, and the kit's published `engine/` pin is authoritative.

**Never run `openclaw update`.** It would mutate the copy the kit asserts. The upgrade path is three hops:

1. BYOKit bumps the pin in `engine/package.json` and publishes a new `@byokit/openclaw`.
2. We bump `@byokit/openclaw` in `package.json` and `package-lock.json` (pinned exactly, never a range).
3. Run the gate: `test/openclaw-bridge.test.ts`, `test/openclaw.test.ts`, `test/openclaw-wizard.test.ts`,
   `test/openclaw-migrate.test.ts`, then the stub suite (`./crewhouse test`).

Then, by hand:

- `src/openclaw/trusted-skills.json` — re-read each `SKILL.md` the install policy trusts, then regenerate its
  sha256 and bump `version` to the new engine version. A new skill is a human decision, never an automatic add.
- `docs/supported-subscriptions.md` — the matrix is pin-bound. Re-run it against the new pin: what the kit now
  offers, what Crewhouse maps (`src/openclaw/runtime.ts` `PROVIDER_OF` / `AUTH_CHOICE` / `CODE_CHOICE`), and each
  route's status. A route the kit newly offers lands as a kit account in `src/accounts.ts` (`offered([...])`), with
  its billing carried through, before it can be offered in the app.

`npm ci` before trusting any local reading of the kit: a stale `node_modules` in a worktree shows an older kit
version than the lockfile, and every conclusion drawn from it is wrong.