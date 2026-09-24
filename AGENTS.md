# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Checks: `npm run check` (tsc, strict) and `./crewhouse test` (stub runner, no model quota). Run both before committing.
- Node runs `src/*.ts` directly with type stripping: no parameter properties, enums or namespaces (tsconfig sets `erasableSyntaxOnly`). Imports use `.ts` extensions.
- Size budget: crewd (`src/`) stays under 5,000 lines, per the product plan. Prefer deleting to adding.
- Only `src/runner.ts` knows how CLIs run. Facts come from the CLI's own hooks, wired in `src/bots.ts` `launchSpec` and handled at `/crew/hook/*` in `src/server.ts`. Herdr state is the fallback.
- Never drive Herdr's `default` session while developing. Point crewd at an isolated session through `CREWHOUSE_HERDR_CMD` (a wrapper that adds `--session`), with `CREWHOUSE_STATE_DIR` and `CREWHOUSE_CREW_DIR` in a temp dir.
- Spend-bearing tool commands go under `ask` in `tools/<id>/tool.json` (Claude's `permissions.ask`, which beats allow and fires the `PermissionRequest` hook), never under `allow`. See `tools/people-search`.
- Chief's voice rules live in `templates/chief/AGENTS.md`. His first greeting is deterministic, in `src/crew.ts` (`chiefGreeting`).
- The web UI is plain React bundled by `scripts/build-web.mjs`. `web/src/tokens.ts` and `web/src/api.ts` stay framework-free, so the future Expo app can reuse them.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
