# Chief waits for the helper's report

Part of the crewhouse verification map. Source: `docs/verification/chief-wait.md`.

## How to get to it (user POV)

Ask Chief to get something from a helper. Chief hands the job on, waits for the helper's report, and answers you
with what the helper found — no question in between, and no sign that Chief went off on his own.

## Driving it

1. Needs a browser session: a task-named `CHROME_DEVTOOLS_AXI_SESSION`.
2. Run `done-done verify chief-wait --outcome "<claim>"` (or `scripts/verify/chief-wait.sh <out-dir>`); it boots its
   own lab on the real engine with a scripted model, asks Chief for a helper's report, and tears the lab down. No
   account, no network and no model call: the journey spends nothing.
3. Capture: `chief-wait/screens/chief-{night,day}-{390,1440}.png` (Chief's thread with the answer his helper's report
   brought); `thread.json`, `state.json` and `events.json` carry the job's own record; the exit code says Chief
   waited, answered from the report, and asked the person nothing.
