# Your goal on the phone

Part of the crewhouse verification map. Source: `docs/verification/phone-goal.md`.

## How to get to it (user POV)

Open the paired phone app on Home; tap Your goal under the crew. Pick a stage, tap a role; a drafted role shows the writer's draft with Fill it in for me, then the filled form's Submit card (the person's own questions blank, one Submit); a role in Interview offers its prep.

## Driving it

1. Needs an emulator (start it through the memory gate, stop it after), a release APK built from the head, `npm run build:web`, and a tools folder with the browser installed (`CREWHOUSE_TOOLS_DIR=<tools> ./crewhouse tools install browser` under a scratch HOME, with `/usr/bin` first on PATH: the mise shim fails under one).
2. Run `SERIAL=<serial> BROWSER_TOOLS=<tools> bash scripts/verify/phone-goal.sh <out> <apk>` (or `done-done run phone-goal` with `GOAL_APK` and `BROWSER_TOOLS`); it runs the pairing lab on the stub engine, fills the board through `jobs-loop.mjs`, the form through `jobs-apply.mjs fill` (the writer's real browser), and the prep through `jobs-prep.mjs`, pairs by the typed relay code, and stops the lab. A screen's words are read only once on screen: uiautomator lists no offscreen rows, so the script scrolls to each.
3. Capture: `{home,goal,role,role-draft,submit,submit-yours,prep-entry,prep}-{day,night}-390.png`, `submit-card.mp4` (the card arriving), `sent.json` (what the posting received from Umer's Submit tap), `crewd.log` and the step record in the run folder. Exit 0 means every screen's words were read on screen and the form went with his answers.
