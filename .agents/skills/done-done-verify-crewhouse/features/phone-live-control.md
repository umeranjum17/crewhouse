# Phone live control

Part of the crewhouse verification map. Source: `docs/verification/phone-live-control.md`.

## How to get to it (user POV)

Open a working helper's chat on the phone layout (390 wide, the installed PWA); the bar under its name has Stop and Take control, and a file ask shows Yes, go ahead.

## Driving it

1. Needs a MiniMax key file already on the machine and a task-named `CHROME_DEVTOOLS_AXI_SESSION`. With the MiniMax plan out of quota, `LIVE_ACCOUNT=openrouter` and `KEY_FILE=env:OPENROUTER_API_KEY` run the same journey on `minimax/minimax-m3.1-flash:free` (needs the `parseBrain` colon fix).
2. Run `done-done run phone-live-control` with `KEY_FILE` set (or `scripts/verify/phone-live-control.sh <out> <key file>`); it boots its own lab and tears it down.
3. Capture: `{live,stopped,takeover,ask,approved}-{night,day}-390.png`; the exit code is the bounded-wait verdict for Stop, Take control with Hand it back, and Approve.
