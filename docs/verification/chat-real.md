# Chief's real reply

The stub engine's `stub <bot>:` lines are hidden by the app on purpose (`STUB` in `web/src/adapter.ts`, pinned by a test), so only the real route can show a reply in Chief's thread.

## Drive and witness

`PATH=/usr/bin:$PATH CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/chat-real.sh <out-dir> <minimax-key-file>` (done-done journey `chat-real`, which spends a few model calls on that key). It boots an isolated crewd on the real engine, signs in to MiniMax through the sign-in sheet's key paste (the key is read from the file into that request, never printed or kept), puts `MiniMax-M3.1-Flash` in Chief's own `bot.json` (the picker cannot choose it: the engine's catalog lists a key sign-in's models as unavailable; `CHAT_MODEL` overrides it), sends one message and waits, bounded by `REPLY_SECONDS` (default 180), for Chief's job to end `done` with his words in the thread. A job that ends `failed` or `unsure` fails the journey at once and keeps the engine logs and `thread.json` beside it.

Needs a MiniMax key file already on the machine. Never put a key in the repo or CI.

## Capture

Chief's thread at 390 wide, day and night (`chat-real/chief-{night,day}-390.png`): the person's message and Chief's reply, no error line. `reply.txt` holds the words.

## A release, not the checkout

`PACKAGE_DIR=<the extracted crewhouse/ folder of crewhouse-<version>-linux-x64.tar.gz>` runs the same journey on a built release (its own Node and engine, product mode, a throwaway HOME) and writes `ready.txt`, the seconds from start to ready. It fails when the release installs an engine of its own under `~/.local/share/crewhouse/engine`: a release carries its engine in `app/runtime/openclaw.sets`, and `Config.engineDir` must find it there (`src/config.ts`).
