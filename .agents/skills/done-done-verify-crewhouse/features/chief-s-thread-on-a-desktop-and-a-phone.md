# Chief's thread on a desktop and a phone

Part of the crewhouse verification map. Source: `docs/verification/runbook.md`.

## How to get to it (user POV)

Open the app's private launcher URL for the lab, then the Chief thread (#/chief).

## Driving it

Harness: curl for the HTTP API; chrome-devtools-axi with its own CHROME_DEVTOOLS_AXI_SESSION for the browser UI; a shell for the lab and teardown.

1. Build the web app with `npm run build:web`.
2. Run `CHROME_DEVTOOLS_AXI_SESSION=<task-name> done-done run screens`. The recipe starts its own isolated real daemon on the stub engine and drives Home into Chief's thread.
3. Open every captured PNG under the run's `screens/` folder: Home and Chief, day and night, at 390 and 1440. For additional placement claims use the manual lab in `docs/verification/runbook.md` and `chrome-devtools-axi eval` with `getBoundingClientRect`; the smoke alone does not prove those claims.
4. The recipe stops its daemon. Stop the task-owned browser session with `chrome-devtools-axi stop`.

The drive changes no repo file: note findings in the run's report; after the drive, run done-done maintain to see what drifted, then fix the skill.
