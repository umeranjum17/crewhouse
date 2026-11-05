# The Pi flag

Pi is an engine behind `CREWHOUSE_ENGINE=pi`, off by default. `src/pi/runtime.ts` is the only file that names `@byokit/pi`, and the kit comes from a committed BYOKit ref: `node scripts/prepare-pi.mjs` builds it into `runtime/byokit` (git-ignored), so nobody without the flag fetches anything. A bot on Pi only talks: it has no tools at all, since nothing in the kit passes a tool through Crewhouse's gate, and its prompt says so.

Several bots run side by side: each asked bot gets its own Pi process, home (`<state>/pi/<bot>`), working folder (`work/`), session and extension list (empty: no bot sets one yet). A bot nobody asked has no process. An idle Pi stops after the kit's five minutes (`CREWHOUSE_PI_IDLE_MS` changes that) and its next message picks the same session back up. Pi has no OS sandbox: what keeps one bot out of another's folder is that neither has a tool. Not done: per-bot extensions, the computer layer, messages between machines, and Chief handing work to a helper on Pi.

## Drive and witness

`node scripts/prepare-pi.mjs`, then `scripts/verify/pi-engine.sh <out-dir> <minimax-key-file>` (done-done journey `pi-engine`, with `MINIMAX_KEY_FILE` set; it spends a few model calls on that key). With the flag off it runs `bot-crew` into `<out-dir>/flag-off`. With it on it boots an isolated crewd on the real pinned Pi and MiniMax M3.1 Flash, sends Chief one message through the API the app uses, and checks that the words in the chat are the words in Pi's own session record.

Then `scripts/verify/pi-crew.mjs`, on the same crewd (idle set to 8 seconds), brings on Scout, Scribe and Reel and gives Scout and Scribe a note each. Round 1 asks both at once to remember a word, with two Pis seen running at the same moment. Round 2 waits until no Pi runs, then asks both for their word and note. Round 3 asks both for a story and kills Scout's Pi mid-turn: Scout's job fails and Scribe's finishes. Round 4 asks Scout again. Reel is never asked. Any wrong word, any word of the other helper's, or any Pi that should not be there ends the run non-zero. The unanswered story stays in Scout's session, so its round 4 reply usually finishes that story too.

To run it by hand: `CREWHOUSE_ENGINE=pi CREWHOUSE_ENGINE_BASE_URL=<OpenAI-compatible address> CREWHOUSE_ENGINE_API_KEY=<key> CREWHOUSE_ENGINE_MODEL=<model> ./crewhouse`. With the flag on and the kit not built, the app says what to run and stops at the engine step.

## Capture

`flag-off/`: the bot list and a helper's chat, as `bot-crew` writes them. `flag-on/{chief,scout,scribe}-{390,1280}-{day,night}.png` and `flag-on/installed/{chief,scout,scribe}-390-{day,night}.png`: each chat with its own messages and answers. `reply.txt`: Chief's words and Pi's record of them. `crew.txt`: every helper round, the process ids, the kill and the idle checks. `pi-folder.txt`: a stand-in Pi folder, in the HOME crewd and Pi start from, hashed whole before and after. The person's real folder is not read here, so nothing in this journey proves it unchanged; that rests on the kit's own isolation test. `same-shots.txt`: any shot dropped for being byte for byte another, since done-done refuses that as reuse.

## The gate

`node scripts/test.mjs test/pi-engine.test.ts` runs real Crew and real Pi on the scripted provider: the answer, no tools for the model, a forced write refused, the key off disk, and the stand-in folder unchanged; two helpers mid-turn at once with their own process, home, notes and session, no process for one nobody asked, an idle stop, one Pi killed without touching the other; and crewd killed with two helpers mid-turn, leaving no Pi behind, both jobs finishing after the restart. It skips only off CI, when the kit is not built. `test/engine-seam.test.ts` pins the import guard and the runtime contract.
