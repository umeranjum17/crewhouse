# Interview prep (jobs crew, second slice)

A role the person moved to Interview offers **Prep for this interview** (`POST /api/jobs/:id/prep`). The writer's `crew_prep` puts a one-page company brief and the likely questions on the role (stored as `jobs.prep.<id>`, in `state.jobs.roles[].prep`); nothing is sent, filled in or signed.

## Sub-features

- `brief`: every fact carries the https page it was read from and words copied from it; crewd opens each page and refuses a fact whose page does not open or does not show the words.
- `questions`: 3 to 10 likely questions, each with why they ask it. A pay, visa, right-to-work, notice or consent question is dropped from the list; its empty field is under "Only you can answer these" (`yours`).
- `practice`: Practice with the interviewer (`POST /api/jobs/:id/practice`) starts the writer's own chat as the interviewer: one question at a time, then What landed / To tighten / try again. The person answers by typing or the mic (the writer's chat has the mic while a role in Interview has prep, `A.practising`); the chat's call button is off there. The interviewer's new lines (the question, then the feedback) are read aloud in the device's own voice and speed (`PracticeVoice`, web/src/parts.tsx; the same setting as a call), under a quiet "Device voice for now" label saying the person's own connected voice comes next; Stop and Mute sit beside it. The person's answer is never read back, nothing is recorded, no provider voice is picked.

## Driving it

`NODE=/usr/bin/node scripts/verify/jobs-prep.sh <out>` boots a stub crewd (`CREWHOUSE_STUB_GOLDEN=1` for the two scripted practice lines) and a local company page, and captures `home-goal` (Home's goal card, the way into the board; there is no Jobs tab), then `prep-offer`, `prep-card`, `prep-brief`, `prep-questions`, `practice` at 390 and 1280, day and night, plus `pwa-*` at 390. With `scripts/verify/voice-device.js` injected (two voices, every sentence logged, nothing plays) it also captures `practice-voice`, `practice-speaking` (question mid-sentence, Stop shown) and `practice-turn`; `practice-turn-said-*.json` must hold the question then the three feedback sentences and never the person's answer.

## Pinned by

`test/jobs.test.ts` (facts checked against their pages, pay questions kept out of practice, nothing raised for sending, practice needs prep first).
