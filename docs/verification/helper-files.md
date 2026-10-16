# helper-files: one plain retention rule for a helper's files, and Forget this file

Documents the person sent in Chief's chat (`files/inbox/`) and the unlocked copies of a locked PDF
(`files/unlocked/`) used to sit in the helper's folder with no lifecycle. One plain rule now covers
both, and the person sees and picks it in Chief's chat:

> An unlocked copy is not locked any more, so it can sit in the helper's folder for good. How long
> should it stay? **Remove it when the job ends** (the default) / **Keep it** — said for several files, **Remove them when the
> job ends** / **Keep them**

The rule is asked on the locked-files card itself (`docs/ui-contract.md`), in the same answer that
carries the passwords, so it is one card and one tap rather than a setting. crewd records every copy
it opens (`file.unlocked`, password-less copies and a copy opened on a try where another password was
wrong included) and takes the task's copies back when that
job ends, unless the person picked Keep. A kept copy is then a card in the helper's own
chat — `Kept files/unlocked/<name>: <the file's own name>`, shown as that name with "unlocked" on its sub line, so a
copy never reads as the file the person sent. A kept copy is registered with crewd like any delivered file, so its card opens; the card starts on the pick the person already made for that helper, and an answer that carries no pick leaves that pick alone.

Any document the person sent, and any kept copy, carries **Forget this file** in the chat. It calls
`POST /api/bots/:id/forget-file {path}` (the person's own authority, no card, no bot tool), removes
that one file from the helper's folder, says so once in that thread in plain words ("Removed march.pdf
from Penny's folder.") and records the path in `state.forgotten`, so the app keeps no card for a file
that is not there.

## Gate

`node --test --test-name-pattern="helper files|Forget this file|locked PDF" test/unit.test.ts` and
`node --test --test-name-pattern="Forget this file" test/stub.test.ts`: the rule's words and pick on
the card, the copies removed when the job ends by default, the kept copy's card with its plain note,
and `forgetFile`'s refusals (a folder, a path outside `files/`, a bot that is not there) — plus the
adapter's `state.forgotten` filter in `test/ui.test.ts`.

## Drive (real crewd, stub engine)

The retention rule lives on the locked-files card, so the [unlock-card](unlock-card.md) journey drives
it: `done-done run unlock-card` types a wrong then the right password, shows **Keep them** picked on the two-file card
(`screens/keep-them-*`), picks **Keep it** for April in the installed app (window shots `pwa/keep-it-1440.png`
and `pwa/keep-it-narrow.png`, and on film), then forgets one kept copy from Penny's own chat and lets a third statement follow
the default rule (its one-file card in `screens/keep-it-*`). To drive only this slice against your own crewd:

```bash
FM_HOME=<firstmate home> EV=${DONE_DONE_EVIDENCE_ROOT:?run through done-done} \
  bash scripts/verify/unlock-card.sh "$EV"      # the whole journey, this slice at its end
# and the look check on the kept-copy screen the journey leaves open:
node scripts/verify/look-check.mjs web --out "$EV/look" --person "$LAB/state/person.key" \
  --then "$(show .file-with-forget)" kept-copy="$B/#/h/penny"
```

A document the person sent needs no locked PDF: post it with `POST /api/bots/:id/messages {files}`,
then `POST /api/bots/:id/forget-file {path}` and read the thread back.

## Pass

The card in Chief's chat names the rule and offers both picks; the job's end takes the copies under the
default; Keep leaves each copy as a card in the helper's chat, named after the file it came
from with "unlocked" on its sub line; **Forget this file** removes that file from the folder, says so in
plain words, and leaves no card for it; the file is gone from disk
(`$LAB/crew/bots/<bot>/files/…`) and no other file in that folder changes.

## Gotchas

- Unlocked copies' own names are the encoded path of the file they came from, so a card or a note reads
  the decoded leaf (`adapter.pretty`, crewd's `fileName`) — never the encoded string.
- `state.forgotten` is a window (the newest 200). A forgotten file's card disappears through the same
  window the app already reads events with; an old path outside it can leave a card whose file is gone
  (its link answers 404), which is the same behaviour as any file removed on disk.
- Only a document in `files/inbox/` or a copy in `files/unlocked/` carries **Forget this file**. The
  crew's own delivered work is not a file the person asked to be rid of.
