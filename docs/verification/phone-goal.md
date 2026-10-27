# Your goal on the phone

The paired phone app shows the job search the computer's `#/goal` shows, read over the same link from the same board (`GET /api/state` `jobs`, through `A.goal` in `web/src/adapter.ts`): Home's "Your goal" row (the goal and how many roles are on the board, the board's own count), the board with a stage picker (Found, Drafted, Applied, Interview, Offer, each with its count), a role's own screen (company, title, place, pay as the posting says it or "Pay not in the posting", why it fits, what is missing, where it came from), the writer's draft card while it waits on that role (with the only-you fields named and blank, and Fill it in for me), the filled form's Submit card on the same role (the site and page, what was filled from the CV and draft, the person's own questions blank for them, one Submit, `A.cards` `evidence: 'form'`), and the role's moves that are the person's: Draft my application, I applied, I have an interview, I have an offer, Not for me, Prep for this interview or Open your interview prep (`mobile/src/goal.ts` `roleActions`). The prep reads like the web's: the brief with each fact's source, the likely questions and why, the only-you fields, and Practice with the interviewer (the writer's own chat). Only the Submit card submits, on the person's tap; no role move or helper action does.

## Driving it

Needs an emulator of the task's own (memory gate, stopped after), a release APK built from the head (`cd mobile && npx expo prebuild -p android --clean --no-install && cd android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64`), and a built web app (`npm run build:web`, the pairing lab serves it).

```bash
CREWHOUSE_TOOLS_DIR=<tools> ./crewhouse tools install browser   # once, in a scratch HOME
SERIAL=emulator-5612 BROWSER_TOOLS=<tools> bash scripts/verify/phone-goal.sh <out> <apk>
```

The pairing lab ([pwa-pair.md](pwa-pair.md), stub engine) gets Umer's goal and board through `jobs-loop.mjs` (a Found and a Drafted role, the writer's draft waiting), the emulator pairs by the typed relay code, and the journey captures at 390 wide, day and night: `home` (the Your goal row), `goal` (the board on Found), `role` (the drafted role with its draft card); then Fill it in for me (`jobs-apply.mjs fill`: the writer's real browser and gate on the posting's form) while the screen records `submit-card.mp4`, `submit` (the card as it arrives) and `submit-yours` (Umer's salary and sponsorship answers typed on the phone, above Submit); his Submit tap sends the form, which the posting writes to `sent.json` with his answers, and the board shows Applied 1; then, after the person's Interview tap and the writer's prep (`jobs-prep.mjs`), `prep-entry` (the role in Interview offering its prep) and `prep`. Exit 0 means every screen's words were read on screen.

## Pinned by

`test/phone-goal.test.ts`: a stub-engine crewd's board maps to its five stages with Home's count, pay and fit as the posting and CV say, and a role offers only the person's moves, never a submit; the form card alone carries Submit, only while the page has one and nothing stopped the writer, with the person's own fields blank.
