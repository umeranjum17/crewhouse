# Crewhouse verification map

The maintained source for verifying user-facing behavior of Crewhouse. Read this index
before driving the app, then use the matching feature file as the recipe. Launch, doctor,
evidence and cleanup live in [`../SKILL.md`](../SKILL.md); every recipe assumes a fresh
isolated crewd on the stub engine.

## Baseline preconditions

- crewd healthy at `http://127.0.0.1:$PORT` (engine: stub), started by this run, per SKILL.md.
- `GET /api/state` answers with `person` and a `bots` list containing `chief`.
- Browser drive uses a task-named `CHROME_DEVTOOLS_AXI_SESSION` (shared default session is another lane's).
- Non-GET API calls carry `x-crewhouse: 1`.

## Features

| ID | File | What it proves |
|----|------|----------------|
| onboard-chief-chat | [onboard-chief-chat.md](onboard-chief-chat.md) | Hello screen, onboarding, Chief's first greeting and chat replies |
| recruit-assign | [recruit-assign.md](recruit-assign.md) | Chief recruits a helper, hands it a job, one wrap-up line with the file card |
| office-layout | [office-layout.md](office-layout.md) | The Office view's counts and labels at desktop, phone and narrow widths |
| bubble-write-it-here | [bubble-write-it-here.md](bubble-write-it-here.md) | On the release APK: Chief's bubble over another app's box, Write it here, and the action it offers (Copy or Put it in) |
| ai-accounts-view | [ai-accounts-view.md](ai-accounts-view.md) | Settings' AI-accounts card: who is ready, resting, or plan-less, without any sign-in |

## Proof and skip reporting

- Every user-visible change also carries the Review evidence set from
  [`../SKILL.md`](../SKILL.md): the changed screen in dark and light at 390 and 1440, plus
  one motion recording of the changed interaction, in the evidence folder the PR names.
- Capture the user action and the resulting state, not only the final screen.
- UI proof = screenshot plus a geometry/state `eval` (label text, counts) — screenshots alone prove nothing on a text-only read.
- API proof = the request, the response body, and the durable state (message row, task row, file on disk).
- Anything the stub engine cannot exercise (real model words, real sign-ins, real relay) is reported as a stub-engine limitation, never as passed.
