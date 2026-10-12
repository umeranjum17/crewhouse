# notice-followup

Chief's case follow-ups. A notice belongs to a case (its Gmail thread): when the model
first notices a case worth tracking it keeps the facts with `crew_case {thread, facts}`,
and when new mail arrives on a thread it holds, the next mail-watch task carries what
Chief holds (`a case you hold: …`) so the follow-up says what changed, restates the
deadline held, and what is still not confirmed — in the same Chief thread. Nothing
changed means ALL-CLEAR and no message; unrelated mail never touches the held case.

## Drive

- The crew logic is real on either engine; the wording needs the **real engine** with a
  signed-in account (see `mail-watch.md`, `signin-stepper.md`). On the stub engine the
  wording is scripted.
- `crew_case` only works inside a mail-watch check: a chat message cannot call it, since
  its thread must be one the check just listed. The app's UI cannot drive a mail check
  without a connected Gmail, so the case path is pinned in `test/notice-followup.test.ts`.

## Prove

- `node --test test/notice-followup.test.ts`: one first notice that keeps the case row,
  one follow-up in the same thread naming the change, silence plus an untouched case row
  for the unrelated mail, and a `crew_case` naming a thread the check did not list is
  refused (`crew_case: error: crew_case takes only a thread the mail check just showed you`
  in the run's transcript).

## Limits

- The follow-up wording is a model output: capture the real words only with a signed-in
  account on the real engine (test mailbox only, never a real person's mail). Until the
  OpenCode Go route lands, cite the stub script for the wording and this file's chat
  drive for the kept case.
