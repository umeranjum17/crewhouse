# routine-monthly: a schedule can name a date each month

`parseSchedule` accepts a date each month beside weekdays and fixed intervals — "on the 1st of every month at 9am",
"every month on the 15th at 7:30am", "the 15th of each month" — with the same default 9:00 am when the words name no
time (`guessed`, so the offer card asks). A month shorter than the date skips it (the 31st waits for the next 31-day
month; nothing is pulled back to the last day). `describe` reads "On the 1st of every month at 9:00 am", the offer
card and Routines row show it, and the refusal for unreadable words names a monthly example.

## Gate

`node --test test/routines.test.ts test/stub.test.ts` — the tick fires the 31st in January, skips February, fires
again in March, and skips the 30-day April; the 30th fires in April. `GET /api/schedule` and `POST /api/routines`
return the same words and a `next` on that date.

## Drive (real crewd, stub engine)

1. Launch per SKILL.md.
2. `GET /api/schedule?text=on%20the%201st%20of%20every%20month%20at%209am` — the reply words are "On the 1st of every
   month at 9:00 am" and `next` is that date at 9:00.
3. Onboard and recruit a helper, then `POST /api/routines {"bot":"<bot>","schedule":"the 1st of every month 9am",…}`;
   the created row's `words` match and `next_at` is the 1st.
4. `POST /api/routines/<id>/run` once, then read `GET /api/state`: the routine's `history` holds one `routine.fired`
   and `next_at` moved to the next real date.

## Pass

The words, the next fire time and a live fired run all agree with the words the person typed; a 31-day month fires
the 31st and a 30-day month fires the 30th while skipping a 31st (stub engine: no real model words).
