# A hand-off that fails: Chief's lane is reset

When Chief hands a job to a helper and the helper's own job fails (or its report never reaches Chief), the job settles
at once, in plain words, and Chief's lane is let go: the engine's turn may not hold a job whose result crewd already
knows. A helper that finished is read for its own result instead of being reported failed.

## Gate

`node --test test/openclaw-handoff.test.ts` — the kit's fake Gateway (no engine, no account, no model, no network): a
failed helper settles the job at once and resets the lane (`chat.abort`), a helper that finished and never reported
settles with the helper's own result, and a failure after Chief's turn ended settles in the hand-off's own words.
Fails on the old code: the first two hold Chief's lane (the job never settles) and the last one answers with a generic
failure instead of the hand-off's own line.

## Drive (real crewd, the pinned Gateway, a scripted provider)

1. `CREWHOUSE_ENGINE_DIR="$PWD/runtime/openclaw" node scripts/verify/native-delegation.ts <scratch> <scratch>/ready.json --scripted`
   boots the real product (crewd, the real server, the pinned Gateway) on a scripted local provider: no account, no
   network, no quota, no live model. The lab prints `READY <base>` and the authority file's path.
2. `POST /api/bots/chief/messages {"text":"Ask Scout to read the facts file and bring back its reference. If Scout cannot do it, say so plainly."}`
   — the marker rides in the brief, so Scout's own job fails on the provider and never reports back.
3. Poll `GET /api/bots/chief` until the task is neither queued nor working: the task row reads `failed` with "The helper
   stopped before reporting back. Check its job before trying again." — in seconds, not minutes — and Scout's own task
   reads `unsure` with the provider's error, so the line Chief gives points at a job that is really there.
4. Captures: `scripts/verify/screens.sh "$EV/screens" chief-hand-off-failed "http://127.0.0.1:$PORT/#/chief"` after step 3
   (the app at 1440 and 390, day and night), beside the helper's own chat.

## Pass

Chief's job settles in seconds with the hand-off's own words, the helper's job keeps its own failure, and no turn of
the engine holds the job after the result is known.
