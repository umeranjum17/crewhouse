# Chat pieces

`done-done run chat-pieces` (`scripts/verify/chat-pieces.sh <out>`) drives real crewd and the real engine (OpenClaw) with the scripted model in `scripts/verify/chat-pieces-model.ts`, so the held `crew_piece` call really crosses the engine. No account, no network, no sends.

In Chief's thread, at 390 and 1280, day and night, and in standalone window mode at 390 (`installed/`):

- `card-*`, `card-answered-*`: a yes/no card in the approved paper look; a double tap on its yes leaves one receipt and Chief's next words.
- `form-*`, `form-filled-*`, `form-answered-*`: the yes stays off until the required lines are filled, typed words are ink on paper by night too, and the receipt lists only the filled lines. Nothing says a site's form was submitted.
- `picker-*`, `picker-answered-*`: three options with their notes; Chief's next words carry the picked id.
- `lines-*`: a `line` and an unknown kind (`slider`) as plain words, no card.

`answers.txt` holds what crewd stored and what the model read back, from `results.jsonl`. The script fails unless three pieces ended answered, none stayed open, each job ran one prompt, and the model read `values` and `picked` as structured results.

What this does not prove: the scripted model chooses the piece, so a real model's choice is not covered. The phone app's forms are not captured here.

The engine can refuse the scripted provider on a first boot (`config changed since last load`); the lab boots again, at most three times, and fails if it still has none.
