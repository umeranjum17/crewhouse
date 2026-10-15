# Account rests: the resting line only while work waits

An AI account that hits its limit rests (`Accounts.rests`). Two paths follow, and the UI must
tell them apart:

- **Failover**: another account carries on (`Crew.settled`, the "X is resting until … Chief carries
  on with Y." line). Nothing waits, so no standing "resting" line, no Office strip, and Chief's
  header and panel read his work, never "Resting".
- **All resting**: no account is usable, the task parks `paused` with `wake_at` (`Crew.pause`).
  Chief says once, in his thread, "All your AI accounts are resting until T. Work starts again
  then by itself."; the snapshot's `resting` lists the accounts; at `wake_at` the tick requeues it
  and the same session key finishes it with no new ask.

## How to drive it (stub engine)

The stub turns two phrases in a message into rests (`src/stub-runtime.ts`):

- `hit the limit`: ChatGPT rests 30 min, the next account finishes the job.
- `hit every limit`: each account rests once on that session key for 2 min, so the job pauses,
  then resumes by itself about two minutes later.

```bash
curl -fsS -X POST "${H[@]}" -d '{"text":"Find me a cheap flight to Lahore, hit the limit"}' "$B/api/bots/chief/messages"
curl -fsS -X POST "${H[@]}" -d '{"text":"Compare the two phone plans, hit every limit"}' "$B/api/bots/chief/messages"
```

## What to read

- `GET /api/state` `.resting`: `{}` after a failover; the resting accounts only while a task is
  paused on them; `{}` again once it resumed.
- Chief's thread: the all-resting line exactly once per wait; no "I'll finish then" after another
  account finished the job.
- Chief's header and Office panel: "At work" while his own job runs on the carrying account.
- After the resume: the task is `done`, `SELECT COUNT(*) FROM asks` is 0.

The fast gate is `node --test --test-name-pattern="limits: a limit rests" test/unit.test.ts`, plus
the chief ladder in `test/ui.test.ts`.
