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

Input to the CH-6 ceiling: on the stub every representative job is one turn of
roughly 200 tokens, because the stub answers in one turn with no tool calls. A
real job takes several turns with tool calls, so the live number is higher. Set
the house-wide ceiling only after a retained-home run of the same script in
read-only mode against live jobs:

    node scripts/measure-task-tokens.mjs --state <retained state dir>

which aggregates `tasks.tokens` by bot without starting anything.

CH-6 ceiling (one house-wide number, `taskTokenCap` in `src/crew.ts`): checked
where usage is summed, a task that reaches it stops with plain words. Default
500,000 (`CREWHOUSE_TASK_TOKENS` overrides); stub jobs cost ~200, so the
default only stops runaways. Re-tune from a retained-home `--state` run if
live jobs approach it. Test: `test/task-ceiling.test.ts`.
