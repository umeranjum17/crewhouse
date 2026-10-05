# A review that found problems says so, and can be started again

Crewhouse's real daemon on the **stub engine** (`CREWHOUSE_ENGINE=stub`), the real server, real SQLite, real
crew logic — only the model is scripted. `npm run check` and `./crewhouse test` are the repo's own gates; this
folder is the hands-on run of the same journeys.

Started per `.agents/skills/verify-crewhouse/SKILL.md`: a throwaway `HOME`/XDG/`TMPDIR`, `CREWHOUSE_*_DIR` under a
`mktemp -d` lab dir, person named **Umer**, one helper (Desk, the support template) with its own git checkout at
`work/app` where `add.sh` subtracts and `check.sh` wants the sum.

## The journey (`http/journey.txt`)

Every step is the same HTTP route the app itself calls (`POST /api/bots/desk/messages`, `crew_verify` and
`crew_deliver` executed for real in the helper's sandboxed checkout).

| # | What Desk proposed | crewd's own record |
|---|---|---|
| 1 | `toggle.patch`, checked against a checkout whose check wants a different answer | `passed: false, before: 1, after: 1` |
| 2 | the same change checked again against the checkout it is meant for | `passed: true, before: 1, after: 0` |
| 3 | `broken.patch`, whose check fails before and after it | `passed: false, before: 1, after: 1` |

What the chat says, in crewd's own words and in order:

```
Delivered files/toggle.patch: Suggested change (for the maintainer to review): its own check did not pass — the same check still fails after the change
Re-checked files/toggle.patch: it passes now. This run is the current one.
Delivered files/broken.patch: Suggested change (for the maintainer to review): its own check did not pass — the same check still fails after the change
```

Before this work the second line did not exist: a rejected change rode into the chat looking identical to a
delivered one, and a later, better check silently disagreed with a card that claimed a pass.

## What a person sees

Read out of the running app's DOM (`http/screen-readout.json`), not off a screenshot:

- **A failed review is unmissable** — `role="alert"`, red border, "Its check did not pass", the finding named in
  plain words ("the same check still fails after the change"), and when it ran.
- **A superseded review says which one counts, in the thread itself** — "Re-checked "Toggle": it passes now. This
  run is the current one." sits directly under the line it supersedes, so the newest word on a change is the
  current verdict and the card agrees with it.
- **The card is never a dead end** — a failed review offers **Start it again**.

### The media

| File | What it shows |
|---|---|
| `screens/review-card-{night,day}-{1440,390}.png` | the failed review, its finding and **Start it again** |
| `screens/review-both-{night,day}-{1440,390}.png` | the overturned review: card above, superseding line below |
| `screens/review-reopened-{night,day}-{1440,390}.png` | the same chat after the tap, carrying the reopen line |
| `motion/start-it-again-390.webm` | Chrome's own screencast of the tap (18 frames, 2.4 s) |

Every frame was opened and read before this was written. The two 390 frames are genuinely different
(`compare -metric AE`: 30,185 differing pixels) — the after-frame carries the reopen line the before-frame cannot.

Captured through the skill's own `scripts/screens.sh` and `scripts/record.mjs`. That script could not capture
anything before its first page existed — `resize` exits non-zero with "No page is currently selected", and
`set -e` killed the loop — so this PR fixes it there too (open a page, then resize, then open again).

`http/card-geometry.json` and `http/reopen-geometry.json` measure the failed card and the reopen line against the
composer dock at 1440 and 390: `clear: true` at both widths, and `hasButton: true`.

## The reopen (`http/before-reopen.txt`, `http/after-reopen.txt`)

Tapped in the real app, then read out of crewd's own SQLite:

```
before  task3 session: agent:m1:crewhouse:desk:3
after   task3 session: agent:m1:crewhouse:desk:3
        tasks in db:   3            (unchanged — no second job)
        run.resumed    {"task":3,"why":"The person asked you to start this again, because it did not pass its own check"}
```

The **same task** in the **same session** was queued again with the verdict in its handoff, so the helper picks the
work up with everything it learned.

## What this does not prove

- **Real model words.** Everything runs on the stub engine: the helper's own sentence ("Desk carries on with
  ChatGPT.") is scripted. The verdict, the findings and the reopen are crewd's own record and are real.
- **The native Expo app.** No `mobile/` screen changed; these captures prove the computer's half only. The review
  card is built in `web/src/parts.tsx`, which the phone app does not render.
- **A 320-wide capture.** Reported as a probe per the skill, not a fifth design-bar width.
