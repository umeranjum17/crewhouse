# Task-token cost of Scribe and Reel jobs (2026-09-29)

Measured with `scripts/measure-task-tokens.mjs` at 0a5d33d on the scripted stub
model (no account, no network, no quota). Each helper's representative jobs are
its own idea asks (templates/scribe/bot.json, templates/reel/bot.json), run on a
throwaway crew; every task settled `done` and its cost was read out of
`tasks.tokens`. Test: `test/task-tokens.test.ts`.

- source: crewhouse `0a5d33d`; engine: stub; runs: 2 (10 tasks)

| bot | job | run | tokens | turns | state |
|---|---|---|---|---|---|
| scribe | draft-email | 1 | 179 | 1 | done |
| scribe | short-post | 1 | 221 | 1 | done |
| scribe | spreadsheet | 1 | 215 | 1 | done |
| reel | demo-video | 1 | 191 | 1 | done |
| reel | cut-clip | 1 | 231 | 1 | done |
| scribe | draft-email | 2 | 217 | 1 | done |
| scribe | short-post | 2 | 225 | 1 | done |
| scribe | spreadsheet | 2 | 219 | 1 | done |
| reel | demo-video | 2 | 231 | 1 | done |
| reel | cut-clip | 2 | 233 | 1 | done |

| bot | tasks | max tokens | median tokens |
|---|---|---|---|
| scribe | 6 | 225 | 217 |
| reel | 4 | 233 | 231 |

Largest single task observed: 233 tokens.

These are historical scripted-provider usage events, not measured real-engine allocations. The script's `--state` mode only aggregates the recorded `tasks.tokens`; a stored number proves no more than the usage events supplied to it.

Migration debt: the pinned published OpenClaw kit's `RunEvent` has no usage event. BYOKit must publish per-run usage and a durable usage-ledger/window/cap contract before Crewhouse can claim measured real-engine costs or enforced real-engine ceilings. The current local `taskTokenCap` path (default 500,000, `CREWHOUSE_TASK_TOKENS` override) stops tasks only when supplied usage reaches it; `test/task-ceiling.test.ts` proves that on the scripted provider. Retained-state totals cannot close the upstream metering gap.
