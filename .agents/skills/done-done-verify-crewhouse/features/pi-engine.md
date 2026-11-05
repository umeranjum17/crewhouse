# The Pi flag

Part of the crewhouse verification map. Source: `docs/verification/pi-engine.md`.

## How to get to it (user POV)

Start Crewhouse with `CREWHOUSE_ENGINE=pi` on a built kit and send Chief a message: the answer shows in his thread, from Pi. Ask two helpers at once and each answers in its own chat on its own Pi. Without the flag nothing changes.

## Driving it

1. Needs `node scripts/prepare-pi.mjs` once, and a MiniMax key file already on the machine.
2. Run `done-done run pi-engine` with `MINIMAX_KEY_FILE` set (or `scripts/verify/pi-engine.sh <out> <key file>`); it boots its own labs and tears them down.
3. Capture: `flag-off/` (the bot list and a chat), `flag-on/{chief,scout,scribe}-{390,1280}-{day,night}.png`, `flag-on/installed/{chief,scout,scribe}-390-{day,night}.png`, `reply.txt`, `crew.txt`, `pi-folder.txt`. The journey's exit code is the verdict: it also fails when crewd did not start on Pi, the chat's words are not Pi's, a helper lost its own word or knows the other's, a Pi runs that should not, one killed Pi hurts the other helper, or the stand-in Pi folder changed.
