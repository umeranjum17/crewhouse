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
- `crew_case` alone runs on the stub engine today: send Chief a chat message carrying
  `[tool crew_case {"thread": "<16-hex-id>", "facts": "<case id, dates, deadline, confirmed vs not>"}]`
  (tool calls written into the message run, per `SKILL.md` Drive). It gates safe, needs
  no approval, and answers `{ok: true}`.
- The full two-step case (warning → confirmation reply in the same thread → unrelated
  mail) needs a scripted Gmail behind the mail watch; that path is pinned in
  `test/notice-followup.test.ts`, not drivable from the app's UI.

## Prove

- After the chat tool call: `cases` holds one row for the thread id (read
  `$LAB/state/crew.db` read-only), and Chief's reply says the case is kept.
- A bad thread id answers `error: crew_case needs the thread id from the mail link`;
  empty facts answer `error: say what you hold on the case`. Neither writes a row.
- `node --test test/notice-followup.test.ts`: one first notice, one follow-up naming the
  change, silence plus an untouched case row for the unrelated mail.

## Limits

- The follow-up wording is a model output: capture the real words only with a signed-in
  account on the real engine (test mailbox only, never a real person's mail). Until the
  OpenCode Go route lands, cite the stub script for the wording and this file's chat
  drive for the kept case.
