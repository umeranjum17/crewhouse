# mail-watch

Chief's Gmail watch. While Gmail is connected, Chief keeps one quiet routine ("Mail
watch", every 2 hours) that reads only threads newer than its stored cursor and starts at
most one quiet task per run. The model decides whether anything in the new mail needs the
person and, if so, says it once in the Dot shape: the fact; a date or deadline; what is not
confirmed yet; one thing they can do; one link to the source thread. Mail is read-only.

## Drive

- Gmail must be connected first: Apps → **Gmail** → **Connect** (with the kit's house client
  that is one tap; `docs/ui-contract.md` "Connecting an app"). The notice wording needs the
  **real engine** with a signed-in account; on the stub engine the crew logic is real and the
  wording is scripted.
- The routine appears by itself: the first `Crew.schedule()` tick after Gmail is connected
  inserts one `mailwatch = 1` routine for Chief. Read it back with `GET /api/routines`
  (bot `chief`, name "Mail watch", `quiet`).
- Trigger a run the app's own way: `POST /api/routines/<id>/run` — the routine's button —
  never by editing rows.
- Seed mail the person's way. The cursor is the newest `internalDate` seen, so the first run
  with only old mail sets the baseline and notices nothing.

## Prove

- One run with new mail → exactly one bot message in Chief's chat, carrying the fact, a
  date/deadline, what is unconfirmed, one action and one `https://mail.google.com/...` thread
  link; the phone is pushed that same message.
- A second run with no new mail → no new task and no message (the run records `same`).
- Mail older than the first look never appears in any task body.

## Limits

- The wording is a model output: it needs a signed-in account (see `signin-stepper.md`), so
  cite the stub script for the crew logic and capture the real wording only once a sign-in
  works. `node --test test/mail-watch.test.ts` drives the same crew path with a scripted model
  and a scripted Gmail.
