# unlock-card: a helper's locked PDF opens from a password card in Chief's chat, and the password is kept nowhere

A helper whose PDF is password-locked calls `crew_unlock {files}`; crewd opens a `kind: 'unlock'` ask owned by Chief
(`askUnlock` in `src/crew.ts`), shown in Chief's thread as mock 3A (`UnlockCard` in `web/src/parts.tsx`): the helper's
face, "2 files are locked", one password field per file under the name the person sent it with, the forgotten-on-this-
computer note and **Unlock 2 files** (Not now under ⋯). The passwords travel only in that one answer; crewd hands each to
the pypdfium2 that comes with the Documents tool's pinned markitdown[pdf] on stdin in the helper's sandbox, which writes `files/unlocked/<path with / as ->`, e.g. `files/inbox/2-1.pdf` to `files/unlocked/files-inbox-2-1.pdf` (`unlock`).
A wrong one is a plain 400 and the card keeps only the files still locked; the right ones leave "Unlocked · <time>" and
resume the helper with the copies' paths. The phone app points to the computer or the web app.

## Gate

`node --test --test-name-pattern="locked PDF" test/unit.test.ts`: the card, the resume, the receipt, and the password
absent from every table row, the database files, the model's turn, the log and the snapshot; a wrong one keeps the card.

## Drive (real crewd, stub engine)

`FM_HOME=<firstmate home> bash .agents/skills/verify-crewhouse/scripts/unlock-card.sh "$EV"`: two AES-256 statements
(ghostscript + qpdf) sent in Penny's thread, the Documents tool installed pinned into the lab, then in a real browser
`screens/unlock-card-*` (both themes, 390 and 1440), the look check beside mock 3A (`look/`), a right and a wrong
password at 390 (`unlock-wrong-day-390.png`, `unlock-retry-night-390.png`), the installed app (`pwa/`) typing the last
one on film (`unlock-type.webm`), and `screens/unlocked-*`. `transcript.txt` holds the ask, the error line, the
browser's storage keys, each copy's `qpdf --is-encrypted` and first line, and the search for each password across state,
crew, both browser profiles and `crewd.log`.

## Pass

Card in Chief's thread only, words as above; no open unlock ask after the right one, Penny's task done, each copy
present, not encrypted and readable; every password search finds 0 files; browser storage holds no new key.

## Gotchas

- The venv's python must be one the sandbox can see (`/usr/bin`, never a version-manager shim): the script installs
  with `PATH=/usr/bin:/bin`; otherwise every unlock answers "This computer can't open locked files yet". macOS has no
  bubblewrap, so it answers the same there.
- The stub calls `crew_unlock` from the person's message, so Chief's captures show only the card and the receipt.
