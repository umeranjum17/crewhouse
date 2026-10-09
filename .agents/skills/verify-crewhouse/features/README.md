# Crewhouse verification map

The maintained source for verifying user-facing behavior of Crewhouse. Read this index
before driving the app, then use the matching feature file as the recipe. Launch, doctor,
evidence and cleanup live in [`../SKILL.md`](../SKILL.md); recipes assume an isolated crewd on the stub engine unless they explicitly require the real engine.

## Baseline preconditions

- crewd healthy at `http://127.0.0.1:$PORT` (engine: stub), started by this run, per SKILL.md.
- `GET /api/state` answers with `person` and a `bots` list containing `chief`.
- Browser drive uses a task-named `CHROME_DEVTOOLS_AXI_SESSION` (shared default session is another lane's).
- HTTP headers and browser authority bootstrap follow [Drive](../SKILL.md#drive); use its `H` array for mutations before driving any feature.

## Features

| ID | File | What it proves |
|----|------|----------------|
| onboard-chief-chat | [onboard-chief-chat.md](onboard-chief-chat.md) | Hello screen, onboarding, Chief's greeting/chat, and shared profile facts with a plain saved note |
| recruit-assign | [recruit-assign.md](recruit-assign.md) | Chief recruits or proposes a custom helper; assignment, wrap-up and long/bullet-only relay openings; real Marketing crew recipe, shared profile and Chief's read-only skill admission |
| office-layout | [office-layout.md](office-layout.md) | The Office view's counts and labels at desktop, phone and narrow widths |
| bubble-write-it-here | [bubble-write-it-here.md](bubble-write-it-here.md) | On the release APK: Chief's bubble over another app's box, Write it here, and the action it offers (Copy or Put it in) |
| ai-accounts-view | [ai-accounts-view.md](ai-accounts-view.md) | Settings' AI-accounts card: who is ready, resting, or plan-less, without any sign-in |
| chat-live | [chat-live.md](chat-live.md) | From send to reply the thread never sits still (live line, handoff mirror, end line), toasts never over words, and the phone's bubble never over the app's text |
| term-screens | [term-screens.md](term-screens.md) | Things, routines, helper details, the file panel, first run and the Share sheet wear Term: shared tiles, one blue primary, names in full |
| thread-clear | [thread-clear.md](thread-clear.md) | Phone threads scroll in their own column: the sign-in card's buttons clear the composer, no line under the top bar; Chief says the sign-in wait once, and his header says it too |
| reply-fold | [reply-fold.md](reply-fold.md) | A long chat reply folds behind More on whole items (no empty or half-cut bullet); More and Less toggle |
| pwa-demo-boot | [pwa-demo-boot.md](pwa-demo-boot.md) | The published static shell boots into the in-bundle demo on a public origin (no backend), while crewd's loopback stays real; ?demo/?real override |
| find-clients-send | [find-clients-send.md](find-clients-send.md) | Paired-phone-only corporate attestation, suppression and one exact Gmail review; local/helper approvals refused; stop before Send |

## Proof and skip reporting

- Every user-visible change also carries the Review evidence set from
  [`../SKILL.md`](../SKILL.md): the changed screen in dark and light at 390 and 1440, plus
  one motion recording of the changed interaction, in the evidence folder the PR names.
- Capture the user action and the resulting state, not only the final screen.
- UI proof = screenshot plus a geometry/state `eval` (label text, counts) — screenshots alone prove nothing on a text-only read.
- API proof = the request, the response body, and the durable state (message row, task row, file on disk).
- Anything the stub engine cannot exercise (real model words, real sign-ins, real relay) is reported as a stub-engine limitation, never as passed.
