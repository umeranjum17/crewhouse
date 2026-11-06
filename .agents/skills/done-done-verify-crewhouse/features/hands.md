# One door for a bot's hands

Part of the crewhouse verification map. Source: `docs/verification/hands.md`.

## How to get to it (user POV)

Nothing changes for the person yet: no screen, no setting. A bot's shell and browser calls go through one door (`bin/hands.mjs`). With no `far` in its `bot.json` (every bot today) they run on this computer exactly as before. With `"far": "<name>"` they go to the far computer of that name. In this slice that is a stand-in: it runs nothing, writes each call to `<state>/far/<name>/calls.jsonl`, and answers that no computer ran it. A far computer that cannot be reached, or a name that is not a name, is a failure the bot reads in plain words, and nothing runs here instead. The real hands program on a far computer is the next slice's.

## Driving it

1. Run `done-done run hands` (`node scripts/verify/hands.mjs <out>`). No key, nothing spent. It boots its own real crewd on the stub engine with the browser AXI's stand-in in its tools folder, and tears it down.
2. Capture: `far.txt` (what reached the far computer, in order, and what the bot read), `here.txt` (the bot with no far computer: its shell wrote in its folder, its browser ran through the AXI here, nothing went far), `failure.txt` (a missing far computer and a name that is a path: both calls failed in plain words, nothing ran here), and the step record. The journey's exit code is the verdict, from the stand-in's `calls.jsonl`, the AXI's own log, the bot's folder and crewd's `run.call` events.
3. `node scripts/test.mjs test/hands.test.ts` holds the same three cases.
