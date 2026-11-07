# Chat pieces

`done-done run chat-pieces` (`scripts/verify/chat-pieces.sh <out>`) drives real crewd and the real engine (OpenClaw) with the scripted model in `scripts/verify/chat-pieces-model.ts`, so the held `crew_piece` call really crosses the engine. No account, no network, no sends.

In Chief's thread at 360, 390, 445, 1280 and 1440 wide, day and night, and in standalone window mode at 390 (`installed/`):

- `card-*`, `card-answered-*`: a yes/no card in the approved paper look; a double tap on its yes leaves one receipt and Chief's next words.
- `form-*`, `form-filled-*`, `form-answered-*`: the yes stays off until the required lines are filled, typed words are ink on paper by night too, and the receipt lists only the filled lines. Nothing says a site's form was submitted. `form-keyboard-*` is the installed window shrunk to what is left above an open phone keyboard: Book it is reachable and enabled there.
- `picker-*`, `picker-answered-*`: three options with their notes; the tap is its own answer, never typed text, and Chief's next words carry the picked label.
- `buttons-*`, `buttons-answered-*`: four stacked answers that fill the card's width, one tap answers and there is no Send; the refusal is one of the answers, not a second control beside them.
- `date-*`, `date-picked-*`, `date-answered-*`: Send and the times are held until a day is picked, today and the days before it are marked, the pick is said in words ("Tuesday 10 November at 10:30"), and Chief's next words use it.
- `sheet-*`, `sheet-open-*`, `sheet-answered-*`: the row names the page it opens, not the question again; the sheet states its own read time, closes by its button, and Got it answers the held call.
- `list-*`, `list-all-*`: twelve rows with five shown and Show all 12; the count in the header is the list's own, the host of each link shows, and nothing is asked.
- `lines-*`: a `line` and an unknown kind (`slider`) as plain words, no card.

`answers.txt` holds what crewd stored and what the model read back, from `results.jsonl`. The script fails unless six pieces ended answered, none stayed open, each job ran one prompt, and the model read `values`, `picked` and the `day`/`time` as structured results.

What this does not prove: the scripted model chooses the piece, so a real model's choice is not covered. The phone app's pieces are not captured here, and neither is a piece a real model writes from a person's own words.

The engine can refuse the scripted provider on a first boot (`config changed since last load`); the lab boots again, at most three times, and fails if it still has none.
