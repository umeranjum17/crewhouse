# Chief's real reply on MiniMax Flash

Part of the crewhouse verification map. Source: `docs/verification/chat-real.md`.

## How to get to it (user POV)

Send Chief a message on a computer signed in to MiniMax; his reply shows in his thread.

## Driving it

1. Needs a MiniMax key file already on the machine and a task-named `CHROME_DEVTOOLS_AXI_SESSION`.
2. Run `done-done run chat-real` with `KEY_FILE` set (or `scripts/verify/chat-real.sh <out> <key file>`); it boots its own lab and tears it down.
3. Capture: `chat-real/chief-{night,day}-390.png` show the message and the reply; the journey's exit code is the bounded-wait verdict.
