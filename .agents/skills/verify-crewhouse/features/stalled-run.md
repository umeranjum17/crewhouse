# stalled-run: a hung run ends itself, and Chief says so once

A turn the engine goes silent in (no event of any kind, streamed words included) for `CREWHOUSE_HUNG_MS`
(10 minutes by default) is ended by crewd's own clock (`src/crew.ts` `tick`): the run is aborted, the task ends
`failed` with "It stalled, so I stopped it.", its files stay, and Chief posts one line in his thread — "“<title>”
stalled, so I stopped it. Anything made so far is kept, and your next message carries on." (a helper's job is named:
"Scout's “…” stalled…"). The bot is free again, so the next message runs at once instead of queueing behind the hung
one, and Chief's next prompt carries that line. A run the person holds the controls of, or one waiting on a
question, is never stopped this way: only a turn in flight counts.

Before that bound, a helper with no news past `CREWHOUSE_STUCK_MS` (3 minutes) reads "Gone quiet" on the rail, and its
live line says the same word (never "at work · still working"). Only Chief asks the person: the Stop / Take over /
Leave it card sits in Chief's thread for every helper gone quiet (`A.stuckIn`), and in that helper's own. Stop gets one
plain line from Chief ("I stopped Scout's “…”, as you asked. Anything made so far is kept, and your next message carries
on.", no alert), and the helper reads "Free" on the rail, counted as free in the office summary.

## Gate

`node --test test/task-ceiling.test.ts` — a held stub Chief turn (`ask permission`) under `CREWHOUSE_HUNG_MS=1000`:
the task ends `failed` with nobody pressing Stop, Chief's line appears exactly once (also after another tick), and the
next message to Chief is prompted, carries the line, and finishes. Fails on the old code (the task never settles).
The second test there backdates a held Scout turn past the quiet limit and reads crewd's own snapshot through the
adapter: Stop card in Chief's thread and Scout's, the live line "Gone quiet" like the rail, then `resetBot` gives one
Chief line, no alert, and Scout "Free" on the rail and in the summary.

## Drive (real crewd, stub engine)

1. Launch per SKILL.md with `CREWHOUSE_HUNG_MS=20000` added to the env (only the bound is shortened).
   `POST /api/onboard {"address":"Umer"}`, `POST /api/recruit {"template":"scout","name":"Scout"}`.
2. `POST /api/bots/chief/messages {"text":"Plan my week, and ask permission before you book anything"}` — the stub
   holds any turn whose prompt says "ask permission", so Chief's turn hangs.
3. Poll `GET /api/bots/chief` until a Chief line contains "stalled" (about 20 s plus one 1.5 s tick); the task row
   reads `failed`, `result` "It stalled, so I stopped it.".
4. Next message: `{"text":"Ask Scout to find flights for that week"}` routes to Scout and comes back in Chief's thread.
   (A Chief-bound follow-up would hang again on the stub, whose hold trigger is in Chief's history; the gate proves
   that path with a released turn.)
5. Captures: `scripts/screens.sh "$EV/screens" chief-stalled "http://127.0.0.1:$PORT/#/chief"` after step 3 and
   again after step 4; the same steps on the old `src` for the before set (Chief still at work, no line).
   One recording with `record.mjs` across the moment the line lands (start ~10 s into the hang, `--seconds 20`).
6. iPad: the same crewd through the reverse tunnel (pwa-resume.md, "On the iPad simulator"), Chief's thread in the
   installed web app after step 3, Day and Night from Settings ▸ LOOK.

7. Gone quiet (b, a): a fresh launch with `CREWHOUSE_STUCK_MS=15000` and the default hung bound; ask Scout directly
   "ask permission to find flights for next week" and wait 15 s. Capture `#/chief` and `#/h/scout` (the card, the live
   line, the rail word), press Stop in Chief's thread, and capture again (Chief's one line, Scout "Free").

## Pass

Exactly one "stalled" line from Chief, task `failed` with the plain result, no line in the helper's chat, Chief no
longer "at work", and the next message answered; a helper gone quiet reads "Gone quiet" on the rail and the live line
alike, its card is in Chief's thread, and Stop gives one Chief line with Scout free — at 1440 and 390, day and night, and in the installed web app.
