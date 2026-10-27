# Long-goal parts (stages per goal, daily search, reminders)

A goal is a board with stage names the person gave it; the job search is only the first. The crew writes into the first `crew` stages (a finder adds to the first), every later stage moves on the person's tap, and a made-up stage is refused. The goal's quiet daily routine adds options once (a page or company+title already on that board, passed or not, is never added twice) and its run stays out of Chief's thread. A reminder rides the ordinary `remind` routine, tied to a goal item or standing alone (`routines.goal`, `routines.item`); the person changes it (`PUT /api/routines/:id`) or dismisses it (`DELETE`), and passing on an item drops its reminders.

## Sub-features

- `goal-card`: `crew_goal` with `stages` (2 to 8 names) -> the hire card; nothing starts before yes. No `stages` means the job-search stages and its writer.
- `search`: the finder (one helper, many goals; `crew_role` takes `goal` when it serves more than one) fills the first stage; a second run adds nothing.
- `stages`: board columns, counts and the person-only `Move to <next stage>` button come from the goal; the crew never moves an item.
- `reminders`: Remind me on an option or on the goal, Change, Dismiss; it goes off by itself with one line in Chief's thread, no ask.

## Driving it

`NODE=/usr/bin/node scripts/verify/goal-parts.sh <out>` boots a stub crewd and a local listing page; captures `goal-card`, `jobs-board`, `flat-found`, `flat-shortlisted`, `reminder-set`, `reminder-fired`, `reminder-chief`, `reminder-dismissed` at 390 and 1280, day and night, plus `pwa-*` at 390. The reminder takes about a minute (it is set for `in 1 minute`). `?demo=goal` shows the same two goals without a crewd.

## Pinned by

`test/jobs.test.ts` (both tests).
