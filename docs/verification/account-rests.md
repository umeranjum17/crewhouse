# Account rests: the person picks, never a switch by surprise

An AI account that hits its limit rests (`Accounts.rests`). The crew never moves the job to another
AI by itself: the task parks `paused` with `wake_at` (`Crew.pause`), and Chief
says once, in his thread, "Your ChatGPT reached its limit and rests until T. Work starts again then by
itself, or pick another model in Settings › AI accounts." The snapshot's `resting` lists the account.
Two ways out:

- **The rest ends**: at `wake_at` the tick requeues it and the same session key finishes it on the
  same account, with no new ask.
- **The person picks**: a model on any account in Settings › AI accounts (`PUT /api/accounts/1/<key>/model`,
  `Crew.pickModel`) puts it first for every bot, lifts that account's rest and requeues the waiting
  work at once; the same session key carries on there.

## How to drive it (stub engine)

The stub turns two phrases in a message into rests (`src/stub-runtime.ts`):

- `hit the limit`: ChatGPT rests 30 min, so the job pauses until then or until the person picks.
- `hit every limit`: each account rests once on that session key for 2 min, so the job pauses,
  then resumes by itself about two minutes later.

```bash
curl -fsS -X POST "${H[@]}" -d '{"text":"Find me a cheap flight to Lahore, hit the limit"}' "$B/api/bots/chief/messages"
curl -fsS -X PUT "${H[@]}" -d '{"model":"quick-1"}' "$B/api/accounts/1/copilot/model"
```

## What to read

- `GET /api/state` `.resting`: the resting account only while a task is paused on it; `{}` again once
  it resumed.
- `run.started` events for the task: the resting account only, until the person picks.
- Chief's thread: the limit line exactly once per wait.
- After the resume: the task is `done`, `SELECT COUNT(*) FROM asks` is 0.

The fast gate is `node --test --test-name-pattern="limits: a limit pauses" test/unit.test.ts`, plus
the chief ladder in `test/ui.test.ts`.
