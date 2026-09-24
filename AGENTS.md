# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Checks: `npm run check` (tsc, strict) and `./crewhouse test` (stub runner, no model quota). Run both before committing; CI (`.github/workflows/ci.yml`) runs them plus the web build on Node 22.18 and 24, so tests must never need Herdr, a CLI or a model.
- Node runs `src/*.ts` directly with type stripping: no parameter properties, enums or namespaces (tsconfig sets `erasableSyntaxOnly`). Imports use `.ts` extensions.
- Size budget: crewd (`src/`) stays under 5,000 lines, per the product plan. Prefer deleting to adding.
- Only `src/runner.ts` knows how CLIs run. Facts come from the CLI's own hooks, wired in `src/bots.ts` `launchSpec` and handled at `/crew/hook/*` in `src/server.ts`. Herdr state is the fallback.
- Never drive Herdr's `default` session while developing. Point crewd at an isolated session through `CREWHOUSE_HERDR_CMD` (a wrapper that adds `--session`), with `CREWHOUSE_STATE_DIR` and `CREWHOUSE_CREW_DIR` in a temp dir.
- Spend-bearing tool commands go under `ask` in `tools/<id>/tool.json` (Claude's `permissions.ask`, which beats allow and fires the `PermissionRequest` hook), never under `allow`. See `tools/people-search`. crewd's own standing answers ("For this task", "Always for <bot>", `permissionRule`/`mustAsk` in `src/bots.ts`) never cover an `ask` rule or a browser asks-first gate, and a compound shell command only ever earns an exact-command grant.
- Tool kit: manifests in `tools/*/tool.json`, logic in `src/tools.ts` (`resolveGrants`, `installTool`). Tests and labs set `CREWHOUSE_TOOLS_DIR` to a temp dir; a real `./crewhouse tools install` downloads Chromium (~170 MB). Claude ignores `Write(path)` allow rules: `Edit(path)` covers every file edit.
- Which CLI and model runs is picked per run in `src/crew.ts` `run()`: a task's own `brain` first, then the bot's `models` fallback order in `bot.json`, skipping accounts that are resting. Limit hits go through `failover()`: Claude's `StopFailure` hook, or the limit text on Codex's screen.
- Household members (`people`, id 1 = owner): bots, tasks, messages and asks carry `member`; a run uses the task member's own CLI config home (`src/accounts.ts`; the owner keeps the CLIs' usual home, others get `CLAUDE_CONFIG_DIR`/`CODEX_HOME` under `<stateDir>/people/<id>/`), and limits are keyed `<member>:<runtime>`. Never fall back onto another member's account (vendor terms), and never read what the vendors' login/status commands write.
- Anything time-based is a row in `routines`, fired by `Crew.schedule()` from crewd's own tick (schedule words in `src/routines.ts`); no cron, no timers per routine. Tests move `next_at` into the past and call `crew.schedule()` instead of waiting.
- Chief's voice rules live in `templates/chief/AGENTS.md`. His first greeting is deterministic, in `src/crew.ts` (`chiefGreeting`).
- The web UI is plain React bundled by `scripts/build-web.mjs`. `web/src/tokens.ts` and `web/src/api.ts` stay framework-free, so the future Expo app can reuse them. It bundles `@desklink/react-native`'s `*.web.*` build with `react-native` aliased to `web/src/rn-web.tsx`; tsc checks `web/src/desklink.d.ts` instead of the package's Metro sources, and `.npmrc` (`legacy-peer-deps`) keeps its Expo peers out.
- Bot desktops live in `src/desktop.ts` (Xvfb + the bot's Chromium + one desklink engine per bot). A distro Chromium wrapper can add Wayland and scale flags; the bot's flags come last so they win. Never let a bot process see the owner's `WAYLAND_DISPLAY` or X cookie.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
