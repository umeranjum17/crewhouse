# Jobs loop (find, draft, apply)

Umer tells Chief he wants a job and sends his CV, pasted or as a file (crewd reads a PDF's words into his message with poppler's `pdftotext`). Chief shows one goal card (the hire card: what the crew will do, a Won't do list); nothing starts before yes. Then a quiet 8:00 routine looks for roles, and the board (`#/goal`, Jobs → Your goal) holds Found → Drafted → Applied → Interview → Offer.

## Sub-features

- `goal-card`: `crew_goal` (Chief: a job hunt with a CV is the goal, never a helper) → `propose` with `create` + `goal`, whose `focus` is his saved strategy (what to favour, from his profile), said on the card and handed to every look; yes runs `Crew.startGoal`: the finder (scout) and writer (scribe) get crewd's own job text and the won't-do list (`hireOff` drops the finder's browser grant; the writer keeps its browser for the application form, `docs/verification/jobs-apply.md`), a quiet `every day 8:00` routine, and a first look now.
- `results`: the first look is Chief's hand-on (task origin `chief`), so Chief's chat carries its chip, its live steps (the finder's `crew_report` lines and crewd's own "N found: <title> at <company>" per role) and its end: crewd's line naming each role found on a line of its own, which the web and the phone show as that role's card (why it fits, Draft my application). The daily look after it adds to the board and stays out of Chief's chat.
- `finding`: `crew_role` only into Found. crewd opens the posting (must open), the pay must be on the page word for word, each fit quotes a CV line; the same posting (page or company+title) is never added twice, and the daily run is handed the seen list.
- `drafting`: Draft my application (`POST /api/jobs/:id/draft`) → the writer's `crew_application`: CV lines must be exact lines of the CV, an answer to a pay/visa/right-to-work/notice/consent question is refused; the draft card lists the six only-you fields empty. Found → Drafted.
- `applying`: only the person's tap moves a role on (`POST /api/jobs/:id`); I applied sets a `once` follow-up routine in 7 days for the writer, removed if the role moves on. The inbox is never read.

## Driving it

The first hour on the phone: `bash scripts/verify/first-hour.sh <out> [apk]` pairs the release app on a task-owned emulator with a crewd on the real pinned OpenClaw engine, whose model is the scripted local provider `scripts/verify/first-hour-model.ts` (fixed words, no AI account; its roles are real remote engineering postings read from Ashby's public boards at start). His CV comes first: Umer sends the PDF from the phone's files with "This is my resume find me good stuff", sees Chief say he read it, taps Yes on the goal card, and Chief's chat shows the look live and then the roles as cards; then, in Chief's chat, he types hi with the keyboard up (the whole box and its send above it, the tab bar gone) and gets exactly one reply (on screen and in crewd's messages, as his CV did); then Research Rae's chat; then, with the app in the background, Chief's answer to a line from the computer arrives as a notification whose tap opens Chief's chat. This is the release gate's first hour in one take. It records `first-hour.mp4` with stills in `screens/` and keeps `first-hour.json`. `HOLD=1` keeps a failed run up until `<out>/.release` appears.

`scripts/verify/jobs-loop.sh <out>` (set `NODE=/usr/bin/node` on a host whose `node` is a mise shim) boots a stub crewd and a local posting page, drives the loop with `scripts/verify/jobs-loop.mjs`, and captures `goal-card`, `board`, `role`, `draft`, `applied` at 390 and 1280, day and night, plus `pwa-*` at 390 in standalone display mode, through `home-gate.mjs` (16px text, no clipping, no sideways scroll). `?demo=goal` and `?demo=ask-goal` show the same screens on demo data.

## Pinned by

`test/jobs.test.ts` (goal card, guards, dedupe, the first look as Chief's hand-on, a look's progress and its roles as cards in Chief's chat, drafts, person-only moves, the 7-day follow-up); `test/stub.test.ts` (a CV sent to Chief reaches the helper he hands the job to, read into text).

## Not built yet

Re-drafting a role, removing the goal. The native phone board is `docs/verification/phone-goal.md`. Interview prep is `docs/verification/jobs-prep.md`.
