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

## A three-ask session (the `ch-chat-quality-core` drive)

The same route, read the way a person reads it: three plain everyday asks go through the app's own composer in one Chief thread, and the thread is judged on what it hands over. A task-owned driver (kept in the task's home, not the repo) boots its own isolated crewd, signs the MiniMax key in through `drive.mjs signin`, and sends each ask with `scripts/verify/chat-probe.mjs`, declines the Connect card with a click on **Not now**, waits out each task, taps **Start it** on the routine card, then captures with `scripts/verify/screens.sh`.

What the three asks must end as, and what a person can act on:

1. "go through my inbox and tell me what came in today that needs an answer" — no Gmail connected, so `done` with what crewd cannot do, the one tap that would connect it, and one thing to do instead (a paste). Never a claim that something happened on the person's account.
2. "make me a file from what I paste here" — `done` with a real `.docx` delivered (`crew_document`), the card in the thread and in "Made in this chat", and any assumption it made named in one line. Never "the file tools aren't available".
3. "set me a weekly reminder to water the plants, Sunday evening" — `done` with the routine card offered and the words "nothing runs until you tap it"; `GET /api/state` `routines` stays empty until the tap, then holds the walk's own cadence.

Captures (end state only; the probe's frames stay outside the evidence folder): `chief-{day,night}-{1440,390}.png`, `thread-final.json` (what the app showed), `run-record.txt` (crewd's own `run.call` and `tasks` rows), and the driver's step record through `scripts/verify/steps.mjs "$EV" chat-asks` (the `chat-asks` entry in `scripts/verify/steps.json`). Judged by `done-done check` on those files, with the claim the ask-1 flail, the ask-2 dead end and the ask-3 false claim are gone.

`done-done run -- bash -c 'export EV="$DONE_DONE_EVIDENCE_ROOT"; bash <task home>/data/ch-chat-quality-core/run-session.sh'` with `CHROME_DEVTOOLS_AXI_SESSION=<task-name>` set. Spends a few model calls on that key's account; needs the free MiniMax key file at `~/firstmate/config/minimax-api-key` and network for the engine install.
