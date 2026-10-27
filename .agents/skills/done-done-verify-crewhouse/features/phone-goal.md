# Your goal on the phone

Part of the crewhouse verification map. Source: `docs/verification/phone-goal.md`.

## How to get to it (user POV)

Open the paired phone app on Home; tap Your goal under the crew. Pick a stage, tap a role; a drafted role shows the writer's draft, a role in Interview offers its prep.

## Driving it

1. Needs an emulator (start it through the memory gate, stop it after), a release APK built from the head, and `npm run build:web`.
2. Run `SERIAL=<serial> bash scripts/verify/phone-goal.sh <out> <apk>` (or `done-done run phone-goal` with `GOAL_APK`); it runs the pairing lab on the stub engine, fills the board through `jobs-loop.mjs` and `jobs-prep.mjs`, pairs by the typed relay code, and stops the lab.
3. Capture: `{home,goal,role,prep-entry,prep}-{day,night}-390.png`, `crewd.log` and the step record in the run folder. Exit 0 means every screen's words were read on screen.
