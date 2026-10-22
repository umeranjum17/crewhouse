# A hand-off that fails: Chief's lane is reset

Part of the crewhouse verification map. Source: `docs/verification/handoff-lane-reset.md`.

## How to get to it (user POV)

Ask Chief for a job a helper should do; the helper's own job fails. Chief's job must settle at once, in plain words,
and the helper's job keeps its own failure — no turn of the engine may hold the job for minutes.

## Driving it

1. Needs a task-named `CHROME_DEVTOOLS_AXI_SESSION` and a built web app. The engine comes from the repo's own pinned set
   (`CREWHOUSE_ENGINE_DIR="$PWD/runtime/openclaw"`), so the lab needs no account, no network and no live model.
2. Boot the real product with a scripted provider:
   `node scripts/verify/native-delegation.ts <scratch> <scratch>/ready.json --scripted` (it prints `READY <base>`).
3. Drive it: `POST /api/bots/chief/messages {"text":"Ask Scout to read the facts file and bring back its reference. If Scout cannot do it, say so plainly."}`
   (the marker rides in the brief, so Scout's own job fails), then poll `GET /api/bots/chief` until the task is neither
   queued nor working: it reads `failed` with "The helper stopped before reporting back. Check its job before trying
   again.", in seconds.
4. Capture (the journey `handoff-lane-reset` does 2-4): `scripts/verify/screens.sh "$EV/screens" chief-hand-off-failed "<base>#/chief"` — the app at 1440 and 390,
   day and night. The gate is `node --test test/openclaw-handoff.test.ts` (the kit's fake Gateway).
