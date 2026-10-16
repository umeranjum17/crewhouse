# unlock-card: a helper's locked PDF opens from a password card in Chief's chat, and the password is kept nowhere

A helper whose PDF is password-locked calls `crew_unlock {files}`; crewd opens a `kind: 'unlock'` ask owned by Chief
(`askUnlock` in `src/crew.ts`), shown in Chief's thread as mock 3A (`UnlockCard` in `web/src/parts.tsx`): the helper's
face, "2 files are locked", one password field per file under the name the person sent it with, the forgotten-on-this-
computer note and **Unlock 2 files** (Not now under ⋯). The passwords travel only in that one answer; crewd hands each to
the Documents tool's pinned pypdfium2 on stdin in the helper's sandbox, which writes `files/unlocked/<encodeURIComponent of the path>` (e.g. `files/inbox/2-1.pdf` to `files/unlocked/files%2Finbox%2F2-1.pdf`; a short hash name when that passes 200 characters), current only while not older than its source (`unlock`; `docs/ui-contract.md` owns the contract).
A wrong one is a plain 400 and the card keeps only the files still locked; the right ones leave "Unlocked · <time>" and
resume the helper with the copies' paths. The same card carries the one plain rule for the helper's files — an unlocked
copy is not locked any more, so it can sit in the helper's folder for good — with the person's pick, **Remove it when
the job ends** (the default) or **Keep them**; the job's own end takes its copies back either way unless Keep them was
picked, and a kept copy is a card in the helper's own chat named after the file it came from, its sub line saying "unlocked",
with **Forget this file** on it (`POST /api/bots/:id/forget-file`, which takes the file out of the helper's folder and says so in plain words; the
chat keeps no card for a file that is not there). The phone app points to the computer or the web app.

## Gate

`node --test --test-name-pattern="locked PDF" test/unit.test.ts`: the card, the resume, the receipt, and the password
absent from every table row, the database files, the model's turn, the log and the snapshot; a wrong one keeps the card;
a PDF that opens with no password gets no card, and a damaged one gets none either (the `locked PDF:` tests cover both).

## Drive (real crewd, stub engine)

Use the isolated launch and proof-server lifecycle in [signin-card.md](signin-card.md#drive-real-crewd-stub-engine).
Keep captures alongside the `.done-done.yaml` journey evidence; a hermetic receipt alone does not prove this
feature. `done-done run unlock-card` runs the migrated `scripts/verify/unlock-card.sh` driver.
In the private lab, send two AES-256 statements
(ghostscript + qpdf) in Penny's thread, with the Documents tool installed pinned into the lab, then capture in a real browser
`screens/unlock-card-*` (both themes, 390 and 1440), the look check beside mock 3A (`look/`), a right and a wrong
password at 390 (`unlock-wrong-day-390.png`, `unlock-retry-night-390.png`), the installed app (`pwa/`) typing the last
one on film (`unlock-type.webm`), and `screens/unlocked-*`. `transcript.txt` holds the ask, the error line, the
browser's storage keys, each copy's `qpdf --is-encrypted` and first line, and the search for each password across state,
crew, both browser profiles and `crewd.log`.

## Pass

Card in Chief's thread only, words as above; no open unlock ask after the right one, Penny's task done; the kept copy
(2-1) present, not encrypted and readable, and the forgotten one (2-2) gone from the folder with the chat's card and
the plain "Removed …" note; the third statement's copy gone with its job under the default rule; every password search
finds 0 files; browser storage holds no new key.

## Gotchas

- The venv's python must be one the sandbox can see (`/usr/bin`, never a version-manager shim): install the lab tool
  with `PATH=/usr/bin:/bin`; otherwise every unlock answers "This computer can't open locked files yet". macOS has no
  bubblewrap, so it answers the same there.
- The stub calls `crew_unlock` from the person's message, so Chief's captures show only the card and the receipt.
- The kept copies' cards are in **Penny's** thread (`#/h/penny`), not Chief's: the helper owns the folder.
- `state.forgotten` keeps the newest 200 paths, so a forgotten file's card never comes back.
