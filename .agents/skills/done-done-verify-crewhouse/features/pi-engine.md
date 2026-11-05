# The Pi flag

Part of the crewhouse verification map. Source: `docs/verification/pi-engine.md`.

## How to get to it (user POV)

Start Crewhouse with `CREWHOUSE_ENGINE=pi` on a built kit and send Chief a message: the answer shows in his thread, from Pi. Ask two helpers at once and each answers in its own chat on its own Pi, with the tools from its own extension list (`extensions.json` in its folder, `src/pi/extensions.json` the default). Without the flag nothing changes.

## Driving it

1. Needs `node scripts/prepare-pi.mjs` once, and a MiniMax key file already on the machine.
2. Run `done-done run pi-engine` with `MINIMAX_KEY_FILE` set (or `scripts/verify/pi-engine.sh <out> <key file>`); it boots its own labs and tears them down.
3. Capture: `flag-off/` (the bot list and a chat), `flag-on/{scout,scribe,reel}-{390,1280}-{day,night}.png`, `flag-on/installed/{scout,scribe,reel}-390-{day,night}.png`, `crew.txt`, `offered.jsonl`, `pi-folder.txt`. The journey's exit code is the verdict: it also fails when crewd did not start on Pi, the chat's words are not Pi's, a helper lost its own word or knows the other's, a model call offered any tool but that helper's own, a helper did not call its own tool, a Pi runs that should not, or the stand-in Pi folder changed.
