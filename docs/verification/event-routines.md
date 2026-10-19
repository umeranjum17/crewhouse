# event-routines

A routine can start on a new email or a meeting instead of a time: "when an email from the bank with subject statement
arrives", "10 minutes before each meeting", "when a meeting starts". crewd checks the person's own Gmail and Calendar
connections from its tick at most once a minute per routine (`Crew.checkEvent`); the first look is a baseline, the cursor
(Gmail history id, or the last checked moment) moves only together with the task it starts, and a failed check posts one
plain line in Chief's chat and keeps the cursor. What the helper then does still asks like any other run.

## Drive

`PWA=1 timeout -k 10 900 xvfb-run -a -s "-screen 0 1920x1200x24" node scripts/verify/event-routines.mjs <out>`
(without `PWA=1` and Xvfb it skips the installed app). It runs a real crewd on the stub engine against emulate's
stateful Google (`test/emulate-google.ts`): Gmail and Calendar connect through crewd and the kit's real sign-in, Chief
offers both routines on cards that are answered yes, mails land in the emulated inbox (wrong sender, wrong subject, the
match) and a meeting plus an all-day event are booked there; crewd's own tick does the rest.

## Prove

- `POST /api/routines` with an email trigger before Gmail is connected: 400, "Connect Gmail first, then set up this routine again."
- The card and Routines row read the trigger words; an event card offers Not now, never Change time.
- Only the matching mail starts the helper, once; its task names that mail's subject, sender and link. The timed meeting
  starts it once, about ten minutes ahead; the all-day event never does. Two quiet minutes later each routine fired once.
- Captures: card, Routines and the helper's thread at 390/1280, day/night; Routines in the installed app (390 day/night, 1280 day).

`node --test test/event-routines.test.ts` covers what the lab can't wait for: paging, sent mail, a 503 and its chat line,
the once-a-minute bound, a missed tick, a restart (no repeat, mail that came while away still counts) and an effect that asks.

## Limits

- emulate 0.12.2 has no Gmail `users.getProfile`; the lab answers that one call from the emulator's own history id.
- The stub engine's own replies never show in a thread (`STUB` in `web/src/adapter.ts`); the transcript carries them.
- Not proven here: a real Gmail and Calendar (needs the person's Google sign-in).
