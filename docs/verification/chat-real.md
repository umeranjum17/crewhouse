# Chief's real reply

The stub engine's `stub <bot>:` lines are hidden by the app on purpose (`STUB` in `web/src/adapter.ts`, pinned by a test), so only the real route can show a reply in Chief's thread.

## Drive and witness

`PATH=/usr/bin:$PATH CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/chat-real.sh <out-dir> <minimax-key-file>` (done-done journey `chat-real`, which spends a few model calls on that key). It boots an isolated crewd on the real engine and walks the first-day path: no name, the first request sent from Hello, then the sign-in sheet's key paste (the key is read from the file into that request, never printed or kept). The journey fails unless Chief's own accounts now lead with `MiniMax-M3.1-Flash` with nothing picked by hand (`CHAT_MODEL` overrides it), then waits, bounded by `REPLY_SECONDS` (default 180), for the request, which started by itself at sign-in, to end `done` with Chief's words in the thread. A job that ends `failed` or `unsure` fails the journey at once and keeps the engine logs and `thread.json` beside it. `timeline.txt` stamps each step (engine ready, request sent, key pasted, signed in, first reply); `ENGINE_DIR=<dir>` reuses an engine install, so the steps after the one-off install can be timed on their own.

Needs a MiniMax key file already on the machine. Never put a key in the repo or CI.

## A helper's job (`HELPER=scout`)

`HELPER=scout HELPER_NAME="Research Rae" ASK='Ask Research Rae to …' REPLY_SECONDS=1200` hires that template on the same model, asks Chief to hand it the job, and waits on the helper's own task. It must end `done` with the helper's words (a job that closes with no answer is `unsure` and fails the journey). A web-research job takes about 10 minutes on Flash. It also captures the helper's page at 390 (`helper/<id>-{day,night}-390.png`).

## Capture

Chief's thread at 390 wide, day and night (`chat-real/chief-{night,day}-390.png`): the person's message and Chief's reply, no error line. `reply.txt` holds the words.

## A release, not the checkout

`PACKAGE_DIR=<the extracted crewhouse/ folder of crewhouse-<version>-linux-x64.tar.gz>` runs the same journey on a built release (its own Node and engine, product mode, a throwaway HOME) and writes `ready.txt`, the seconds from start to ready. It fails when the release installs an engine of its own under `~/.local/share/crewhouse/engine`: a release carries its engine in `app/runtime/openclaw.sets`, and `Config.engineDir` must find it there (`src/config.ts`).
