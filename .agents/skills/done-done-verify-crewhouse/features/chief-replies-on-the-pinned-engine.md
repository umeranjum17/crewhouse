# Chief replies on the pinned engine

Part of the crewhouse verification map. Source: `scripts/verify/chief-reply-engine.sh` (its header).

## How to get to it (user POV)

Send Chief a message; his reply shows under it in his thread. The crew runs on this checkout's pinned OpenClaw engine; only the model's words are scripted, so it needs no account and spends nothing. The proof to run after an engine pin bump.

## Driving it

1. Needs the engine installed under `runtime/openclaw` (`node scripts/prepare-engine.mjs <scratch>`), a built web app (`npm run build:web`) and a task-named `CHROME_DEVTOOLS_AXI_SESSION`.
2. Run `done-done run chief-reply-engine` (or `scripts/verify/chief-reply-engine.sh <out>`); it boots the native household lab (`native-delegation.ts --scripted`) and tears it down.
3. Capture: `chief-reply-engine/chief-{day,night}-390.png` show the message and Chief's reply; `reply.txt` names the engine version the pin installs; the exit code is the bounded-wait verdict (the job must end done).
