# Jobs loop (find, draft, apply)

Umer tells Chief the roles he wants, where, a pay floor if he likes, and pastes his CV. Chief shows one goal card (the hire card: what the crew will do, a Won't do list); nothing starts before yes. Then a quiet 8:00 routine looks for roles, and the board (`#/goal`, Jobs → Your goal) holds Found → Drafted → Applied → Interview → Offer.

## Sub-features

- `goal-card`: `crew_goal` (Chief) → `propose` with `create` + `goal`; yes runs `Crew.startGoal`: the finder (scout) and writer (scribe) get crewd's own job text and the won't-do list (`hireOff` drops their browser grant), a quiet `every day 8:00` routine, and a first look now.
- `finding`: `crew_role` only into Found. crewd opens the posting (must open), the pay must be on the page word for word, each fit quotes a CV line; the same posting (page or company+title) is never added twice, and the daily run is handed the seen list.
- `drafting`: Draft my application (`POST /api/jobs/:id/draft`) → the writer's `crew_application`: CV lines must be exact lines of the CV, an answer to a pay/visa/right-to-work/notice/consent question is refused; the draft card lists the six only-you fields empty. Found → Drafted.
- `applying`: only the person's tap moves a role on (`POST /api/jobs/:id`); I applied sets a `once` follow-up routine in 7 days for the writer, removed if the role moves on. The inbox is never read.

## Driving it

`scripts/verify/jobs-loop.sh <out>` (set `NODE=/usr/bin/node` on a host whose `node` is a mise shim) boots a stub crewd and a local posting page, drives the loop with `scripts/verify/jobs-loop.mjs`, and captures `goal-card`, `board`, `role`, `draft`, `applied` at 390 and 1280, day and night, plus `pwa-*` at 390 in standalone display mode, through `home-gate.mjs` (16px text, no clipping, no sideways scroll). `?demo=goal` and `?demo=ask-goal` show the same screens on demo data.

## Pinned by

`test/jobs.test.ts` (goal card, guards, dedupe, drafts, person-only moves, the 7-day follow-up).

## Not built yet

Re-drafting a role, removing the goal, interview prep, the native phone board.
