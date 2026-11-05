# The Pi flag

Pi is an engine behind `CREWHOUSE_ENGINE=pi`, off by default. `src/pi/runtime.ts` is the only file that names `@byokit/pi`, and the kit comes from a committed BYOKit ref: `node scripts/prepare-pi.mjs` builds it into `runtime/byokit` (git-ignored), so nobody without the flag fetches anything. A bot on Pi only talks: it has no tools at all, since nothing in the kit passes a tool through Crewhouse's gate.

## Drive and witness

`node scripts/prepare-pi.mjs`, then `scripts/verify/pi-engine.sh <out-dir> <minimax-key-file>` (done-done journey `pi-engine`, with `MINIMAX_KEY_FILE` set; it spends a few model calls on that key). With the flag off it runs `bot-crew` into `<out-dir>/flag-off`. With it on it boots an isolated crewd on the real pinned Pi and MiniMax M3.1 Flash, sends Chief one message through the API the app uses, and checks that the words in the chat are the words in Pi's own session record.

To run it by hand: `CREWHOUSE_ENGINE=pi CREWHOUSE_ENGINE_BASE_URL=<OpenAI-compatible address> CREWHOUSE_ENGINE_API_KEY=<key> CREWHOUSE_ENGINE_MODEL=<model> ./crewhouse`. With the flag on and the kit not built, the app says what to run and stops at the engine step.

## Capture

`flag-off/`: the bot list and a helper's chat, as `bot-crew` writes them. `flag-on/chief-{390,1280}-{day,night}.png` and `flag-on/installed/chief-390-{day,night}.png`: Chief's chat with the message and the answer, no error line. `reply.txt`: the words and Pi's record of them. `pi-folder.txt`: a stand-in Pi folder, in the HOME crewd and Pi start from, hashed whole before and after. The person's real folder is not read here, so nothing in this journey proves it unchanged; that rests on the kit's own isolation test. `same-shots.txt`: any shot dropped for being byte for byte another, since done-done refuses that as reuse.

## The gate

`node scripts/test.mjs test/pi-engine.test.ts` runs real Crew and real Pi on the scripted provider: the answer, no tools for the model, a forced write refused, the key off disk, and the stand-in folder unchanged. It skips only off CI, when the kit is not built. `test/engine-seam.test.ts` pins the import guard and the runtime contract.
