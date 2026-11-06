# One door for a bot's hands

A bot's hands are its shell and its browser. `bin/hands.mjs` is the one door they go through. `handsOf(far, root, here)` returns `{ where, shell, browser }`: `where` says where they run (`here`, or `far:<name>`), `shell` takes the bot's `bash` input, and `browser` takes the browser AXI's arguments. Crewd builds a bot's hands in `Crew.handsOf` (`src/crew.ts`) when a job opens, and every call goes through them. That covers the bot's own `bash` and `browser` calls, and crewd's own uses of that browser on the person's tap: the form read, Submit, and closing a kept page.

There are two adapters behind it:

- **Here.** Crewd's own bubblewrap shell (`bashTool` in `src/engine.ts`) and the bot's pinned browser AXI (`runAxi`), handed in by crewd and run exactly as before. Every bot without `far` in its `bot.json` is here, so nothing changes for anyone.
- **Far.** A stand-in for a far computer. `"far": "<name>"` in a bot's `bot.json` points it at `<state>/far/<name>/`. The stand-in runs nothing. It appends each call (`{tool, input}`) to that folder's `calls.jsonl` and answers `far stand-in "<name>": your <tool> call was written down; no computer ran it.` If the folder is missing, the call answers `error: the far computer "<name>" could not be reached, so nothing ran.` If the name is not a plain name, the call answers `error: this bot's far computer has a name Crewhouse can't use, so nothing ran.` (`bot.json` sits in the bot's own folder, which the bot can write.) Crewd records either as a failed call, and the bot reads why. A far call never throws and never falls back to this computer.

A far bot gets no screen here: no desktop and no `computer` node start for it, and its browser never attaches to a local screen. The tools a far bot is offered still follow this computer's grants, since a tool is offered only when it is installed here, and the shell needs bubblewrap here. Nothing in the app or the API writes `far` yet. The real hands program on a far computer, which gives Crewhouse a shell, a browser and a screen over one secure link, is the next slice's. So is moving grants and installs to that computer.

## Proof

`done-done run hands` (`node scripts/verify/hands.mjs <out>`) runs on a real crewd on the stub engine, driven through the API the app uses, with the browser AXI's stand-in in its tools folder. No key, nothing spent. It writes:

- `far.txt`: Writer Will names `lab`. Its shell call, then its browser opening, the page and the close at the job's end reached the stand-in in that order with their exact arguments. Will read the stand-in's answer to each, and nothing ran here.
- `here.txt`: Research Rae names no far computer. Its shell wrote into its own folder here, its browser ran here through the AXI, and nothing went far.
- `failure.txt`: Will names `gone` (no such computer), then `../../x`. Both calls failed each time in plain words that Will read, crewd recorded them failed, and nothing ran here.

`node scripts/test.mjs test/hands.test.ts` holds the same three cases on the lab's Crew.
