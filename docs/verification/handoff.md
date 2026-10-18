# The hand-off you can see

The person talks only to Chief. When Chief hands a job to a helper, his thread shows it as one chip, and the helper's
own chat is read only. Approved mocks: `handoff` / `handoff-helper` (390) and `handoff-ipad` (1180) in `scripts/verify/mocks.tsv`.

## Sub-features

- `chip` — `A.handChips` → `HandOff` (`web/src/main.tsx`): one chip per `origin: 'chief'` task, after the turn that handed it on (a routed "Penny, …" request is saved a few ms after its task, so that line is not the boundary) and before its result. The word is the app's one status (`at work`, `waiting`, `done · <time>`); a green dot only while working; it links to `#/h/<helper>`.
- `limit` — `A.limitOf`: "<helper> can <two things>, but can't pay or send anything without asking you.", from `bots[].can`, `bots[].signedIn` and `connections` only; shown on a helper's first hand-off only (later chips leave it empty).
- `read-only` — a helper's chat and the crew room (`#/room`) have no composer: the lock line and **Ask Chief about this** (fills Chief's composer with "About <helper>'s job “…”: ", never sends). Idea chips fill Chief's composer too. A post to a helper's `POST /api/bots/:id/messages` is handed to Chief as `Name, text` (the server adds the name, so the routing rule hands it on): Chief's thread and the hand-off card show the person's own words, never the name the person did not type.
- `rail` — the desk/iPad rail (`SideCrew`, ≥900px): each crew row is name + status word, its last line (the step while working) and its time (`now` while working); no unread badge on any crew row; "Read only. Results come back in Chief's chat."

## Driving it

1. Start an isolated stub crewd (`runbook.md`) with `CREWHOUSE_STUB_GOLDEN=1`.
2. In Chief's thread send `I need someone to sort out my invoices`; say yes on the hire card. Penny's first job finishes: the chip reads `Messaged Penny ✓ done · <time>` under the limit sentence.
3. Send `Penny, find the invoices due next month, ask permission first if anything needs paying` (the stub holds it working): a second chip, after Chief's "Penny is on it.", reads `Messaged Penny • at work`.
4. Tap the chip: `#/h/penny` shows the thread with `.read-along` and no `textarea`; tap **Ask Chief about this**: back on `#/chief` with the words in the composer, nothing sent.
5. At 1180 (iPad landscape) `eval` `[...document.querySelectorAll('.side-row')].map((r) => r.innerText)`: Penny's row reads `At work`, its step and `now`; no crew row has `.badge`.
5b. The room (`#/room`) reads the same: a helper's room line, the lock line and **Ask Chief about this**, no composer; `POST /api/bots/penny/messages {text, room:true}` lands as a room job, shown in the room and as the last line of Home's The crew card.
6. Capture 390 and 1180, day and night, beside the mocks; then the look check (`look-check.md`): `node scripts/verify/look-check.mjs web --person <key> --out <dir> --text 1.3 --then '<click Not now>' handoff=<base>/#/chief handoff-helper=<base>/#/h/penny`.
7. Installed app: Chrome `--app=<url>` (`display-mode: standalone`), repeat steps 2–4.

## Gotchas

- The stub finishes the first job instantly, so its chip says `done · 0 s`.
- A fresh browser shows the "Add your phone" card under Chief's first answer; tap Not now first if it is in the shot.
