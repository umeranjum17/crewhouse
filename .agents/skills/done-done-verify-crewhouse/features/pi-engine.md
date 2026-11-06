# The Pi flag

Part of the crewhouse verification map. Source: `docs/verification/pi-engine.md`.

## How to get to it (user POV)

Start Crewhouse with `CREWHOUSE_ENGINE=pi` on a built kit and send Chief a message: the answer shows in his thread, from Pi. Ask two helpers at once and each answers in its own chat on its own Pi, with the tools from its own extension list (`extensions.json` in its folder, `src/pi/extensions.json` the default). A bot on `notes` keeps its own notes in `<state>/pi/<bot>/work/notes.md`, shown to it once as each job starts, across a restart and with no session left. Without the flag nothing changes. Every bot's Pi runs behind bubblewrap with its own folder the only writable place on disk, or does not start.

## Driving it

1. Needs `node scripts/prepare-pi.mjs` once, and a MiniMax key file already on the machine.
2. Run `done-done run pi-engine` with `MINIMAX_KEY_FILE` set (or `scripts/verify/pi-engine.sh <out> <key file>`); it boots its own labs and tears them down.
3. Capture: `flag-off/` (the bot list and a chat), `flag-on/{scout,scribe}-{390,1280}-{day,night}.png`, `flag-on/installed/{scout,scribe}-390-{day,night}.png`, `crew.txt`, `offered.jsonl`, `pi-folder.txt`. The journey's exit code is the verdict: it also fails when crewd did not start on Pi, the chat's words are not Pi's, a helper lost its own word or knows the other's, a model call offered any tool but that helper's own, the model calls pass `PI_CALL_LIMIT` (20 unless set; `offered.jsonl` keeps every call, what each tool said and the notes each prompt showed), a code was not recalled from the notes that job's prompt showed, the other's code reached a reply, prompt or session, a job's notes changed between its rounds, a Pi runs that should not, or the stand-in Pi folder changed.
4. The wall: `done-done run pi-wall` (`node scripts/verify/pi-wall.mjs <out>`), no key, nothing spent. Captures `no-wall.txt` (the escape lands), `with-wall.txt` (refused in the plain line, a write inside lands), `launcher.txt`, `mounts.txt`, `no-sandbox.txt` and `flag-off.txt`. Its exit code is the verdict, from what the host sees.
