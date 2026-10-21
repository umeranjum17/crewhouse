# Chief's real reply on MiniMax Flash

Part of the crewhouse verification map. Source: `docs/verification/chat-real.md`.

## How to get to it (user POV)

Open Crewhouse for the first time, send Chief a request with no name given, paste a MiniMax key; his reply shows in his thread with no further tap, on Flash.

## Driving it

1. Needs a MiniMax key file already on the machine and a task-named `CHROME_DEVTOOLS_AXI_SESSION`.
2. Run `done-done run chat-real` with `KEY_FILE` set (or `scripts/verify/chat-real.sh <out> <key file>`); it boots its own lab and tears it down. `CHAT_ACCOUNT=openrouter CHAT_KEY_ENV=<variable>` runs it on Flash through an OpenRouter key.
3. A built release: set `PACKAGE_DIR` to the extracted tarball's `crewhouse/` folder; the journey then runs it in a throwaway HOME, writes `ready.txt` and fails if the release reinstalls its engine.
4. Capture: `chat-real/chief-{night,day}-390.png` show the message and the reply; `timeline.txt` times each step from crewd's start to the reply; the journey's exit code is the bounded-wait verdict, and it also fails when Chief does not start on Flash.
