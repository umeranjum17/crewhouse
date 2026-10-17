# mail-attachments

**What it proves.** A helper can get an attachment out of a message the person's Gmail holds and into its own
`files/` folder, so a bank statement or a form can then be read and turned into a workbook. `mail attachments <id>`
lists a conversation's attachments (`n`, name, type, size); `mail attachments <id> <n>` saves one to
`files/<name>` under the bot's own folder and answers with its path. Read-only over the mailbox: the same
`gmail.readonly` token, no new scope and no new connection, and every Gmail call it makes is a `GET`
(`src/policy.ts` admits the command as `safe`; `src/crew.ts`'s run wiring is the only caller that passes the bot's
folder, so a run outside a bot cannot write). Saving into the helper's own folder never asks the person.
The write is bounded: a 10 MB cap, a name with no folders or leading dot, and a plain `error: …` line — the tool's
own shape — when the message has nothing attached, the attachment is too big, or Gmail will not hand it over.

## Drive and prove

Stub engine, from the Firstmate home (no live Gmail needed; the repo's stub Gmail stands in for the account):

```bash
REPO=<repo checkout> bash <home>/data/evidence/ch-gmail-attachments/run.sh
```

- `repro-head.log` — the gap on the base commit: HEAD's own `src/mail.ts` answers
  `error: no command "attachments"` (it mentions an attachment 0 times).
- `mail-and-budget.log` — `npm run check`, `test/mail.test.ts` and `test/line-budget.test.ts`.
- `prove.log` — the real daemon's HTTP API with the helper running the tool through crewd's gate: the letter reads
  with `, N attached (mail attachments <id>)`, the list, the save, the bytes on disk
  (`<crew>/bots/<bot>/files/statement.pdf`), crewd's own `run.call` rows, and the too-big and
  nothing-attached refusals. Assert `0` non-`GET` Gmail calls and `0` cards waiting.
- The pinned coverage is the attachment block in `test/mail.test.ts` (the second test drives the same save through
  `Crew.assign` and reads the file back off disk).

## Limits

- **Not proven against live Gmail.** That proof needs a live Google sign-in;
  the stub serves the Gmail REST shapes the real API does (threads, `messages/<id>/attachments/<att>`).
- No screen changed: this is a tool/backend change, so no Review evidence set applies. A saved attachment does show
  in a thread only as the helper's own report line, which is the existing chat surface.
