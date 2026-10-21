# Pair the PWA and get a real Chief reply

Part of the crewhouse verification map. Source: `docs/verification/pair-chat.md`.

## How to get to it (user POV)

Open the app in a browser, tap "On my computer", paste the code the computer prints, check the two words are the
same, say hello — and Chief really answers in his thread. The stub engine's lines are hidden by the app, so only
the real route shows a reply.

## Driving it

1. Needs the person's own key file (the repo's usual place, `~/.config/openrouter/api_key`; `CHAT_KEY_FILE` names
   another): the key comes by path, is read into the sign-in request and nowhere else — never printed, logged,
   copied or kept — and is never taken from an environment variable. It also needs a network for the sign-in, the
   model call and the engine set.
2. Run `done-done verify core --outcome "<what a user can now do>"`; the run parks at the spend gate (a few live
   model calls on the free MiniMax M3.1 Flash) until the person answers, then `done-done respond --action approve
   --reason "<who approved>"` runs it. Or drive it directly: `scripts/verify/pair-chat.sh <out-dir>`.
3. The release path: `done-done verify upgrade --outcome "..."` (or `scripts/verify/upgrade.sh <out-dir>`) installs
   the previous published version, upgrades over it in place, and runs the core journey on the upgraded app.
4. Capture: `two-words-390.png` (the pairing in the person's hands) and
   `chief-reply-{day,night}-{390,1440}.png` (the message and Chief's real answer); `reply.txt` holds the words,
   `run.json` every step, `steps.json` the step record, `upgrade.txt` the version before and after.
