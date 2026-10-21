# The crew room and Chief's standup

`#/room` shows the jobs Chief handed on natively to two or more helpers: his own brief to each (`Chief to Scout`), each helper's answer, and at the end Chief's closing words as **Chief's standup**. A job handed to one helper is an errand and stays in his thread. The contract is in `docs/ui-contract.md` ("The crew room"); `test/room.test.ts` covers it on the stub engine, and `?demo=room` runs the screen on demo data.

## Drive and witness

`PATH=/usr/bin:$PATH CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/crew-room.sh <out-dir> <minimax-key-file>` (done-done journey `crew-room`, which spends a few model calls on that key). It boots an isolated crewd on the real engine, signs in to MiniMax through the key paste (the file is read into that request only), puts `MiniMax-M3.1-Flash` in Chief's `bot.json` (`CHAT_MODEL` overrides it), recruits Scout and Scribe, asks Chief for a job needing both and waits, bounded by `REPLY_SECONDS` (default 420), for his job to end `done`. It then reads `GET /api/room` into `room.json` and fails unless two `chief` to helper hand-off lines are there and the last line is Chief's standup. A job that ends `failed` or `unsure` fails the journey at once and keeps `thread.json` and the engine logs. `CREW_ASK` replaces the ask.

Needs a MiniMax key file already on the machine. Never put a key in the repo or CI.

## Capture

The room at 390 wide, day and night (`crew-room/room-{night,day}-390.png`: the hand-offs from the top) and the standup at the end of the thread (`crew-room/standup-{night,day}-390.png`). `WIDTHS` overrides the widths. Web captures only: the installed app and the phone are not proved by this journey.
