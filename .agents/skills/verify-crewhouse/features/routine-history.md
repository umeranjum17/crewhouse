# routine-history: a routine says what it waits for and what each run did

A watch or quiet check-in asked for the way `crew_routine` phrases it ("Tell me if the price drops below $900") says
its condition in plain words on the offer card and on its Routines row: "Tells you if the price drops below $900"
(`looksFor` in `src/routines.ts`, crewd's `routines[].looks`). Beside **Do it now** the row shows the last run in
one line — when, then "Nothing new", "Told you · See result", or "Didn't finish: <plain cause>" / "Couldn't open the
page. I'll try again next time" — and **Recent runs** opens up to five runs, newest first, from the run records crewd
already keeps (`routines[].history`, mapped by `runOf` in `web/src/adapter.ts`). A press of Do it now reads
"Running…" until a newer run lands, then the new line lands with a brief highlight (none under Reduce Motion).

## Gate

`node --test test/routines.test.ts test/moneyback.test.ts test/ui.test.ts` — the watches journey reads each run's
words through the adapter (started, nothing new, told, couldn't open), and the money-back watch's card and row carry
the same condition line.

## Drive (real crewd, stub engine)

1. Launch per SKILL.md; serve a page whose price you can change and that can answer 503 (a tiny `node:http`
   server on another loopback port).
2. `POST /api/onboard {"address":"Umer"}`; Chief recruits a helper through the stub tool syntax:
   `POST /api/bots/chief/messages {"text":"I need someone for my shopping [tool crew_recruit {\"template\":\"helper\",\"name\":\"Penny\"}]"}`.
3. The offer: `{"text":"Watch this laptop price [tool crew_routine {\"bot\":\"penny\",\"when\":\"every day 9:00\",
   \"watch\":\"<page>/laptop\",\"task\":\"Tell me if the price drops below $900\",\"name\":\"Laptop price\"}]"}` —
   capture `#/chief` (the card says the condition).
4. Answer the card `allow`, then `POST /api/routines/<id>/run` once for the baseline ("Started watching").
5. Run again with the page unchanged (nothing), with a lower price (told), with the page answering 503 (failed);
   after each, poll `GET /api/state` until the newest `history` entry has settled, then capture `#/routines` with
   `THEN` opening every `details.routine-runs`.
6. One `record.mjs` recording of pressing Do it now in the browser across the moment the new line lands.
7. iPad: the same crewd through the reverse tunnel (pwa-resume.md, "On the iPad simulator"), the Routines page in
   the installed web app with Recent runs open, Day and Night from Settings ▸ LOOK. Reading needs no person key.

## Pass

The card and the row carry the same "Tells you …" line; the last-run line matches the newest run each time
(nothing / told with a See result link that opens the result / failed with its plain cause); Recent runs lists
them newest first; Do it now never flips back while the old result still shows — at 1440 and 390, day and night,
and in the installed web app.
