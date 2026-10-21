# The crew room and Chief's standup

Part of the crewhouse verification map. Source: `docs/verification/crew-room.md`.

## How to get to it (user POV)

Ask Chief for a job that needs two helpers; open The crew (`#/room`) to read who asked whom, ending on Chief's standup.

## Driving it

1. Needs a MiniMax key file already on the machine and a task-named `CHROME_DEVTOOLS_AXI_SESSION`.
2. Run `done-done run crew-room` with `KEY_FILE` set (or `scripts/verify/crew-room.sh <out> <key file>`); it boots its own lab and tears it down.
3. Capture: `crew-room/{room,standup}-{night,day}-390.png`; `room.json` is the room as the app reads it; the exit code says two hand-offs and a standup arrived in time.
