---
name: "done-done-verify-crewhouse"
description: "Drive Crewhouse's real web app and HTTP API in an isolated lab and capture proof. Use when proving a Crewhouse change, capturing evidence, or maintaining the feature map."
---

# done-done-verify-crewhouse

Written by `done-done init` through claude from this repo's own files (surface: Web app (the crewd daemon's browser UI) plus its local HTTP API on loopback, which the web app itself uses.). The drive changes no repo file: note findings in the run's report; after the drive, run done-done maintain to see what drifted, then fix the skill.

## Launch

For the self-contained API smoke, run `done-done run stub-drive` (`node scripts/verify/stub-drive.mjs --out "$DONE_DONE_EVIDENCE_ROOT"`). It boots and tears down its own daemon; it does not leave an instance for later steps.

For the self-contained browser smoke, run `CHROME_DEVTOOLS_AXI_SESSION=<task-name> done-done run screens`. This calls `scripts/verify/screens-smoke.sh`, which captures Home and Chief in both themes at 390 and 1440 on its own live stub-engine daemon.

For manual feature drives, use the persistent isolated Launch recipe in `docs/verification/runbook.md`; wait for readiness, drive the selected feature, then clean up. Build the web app first with `npm run build:web`.

Safe: `scripts/verify/stub-drive.mjs` starts the real crewd on `CREWHOUSE_ENGINE=stub` with an explicit environment mask, private HOME/XDG/state/crew/tools directories, dead D-Bus address and an OS-assigned port. It stops only its own process group. No real account, sign-in, quota or owner state is touched.

Ready: The journey's own readiness check passes. For a manual lab: crewd's log prints 'crewd listening on http://127.0.0.1:$PORT (engine: stub' and GET /api/state, sent with x-crewhouse:1 and the lab's own person.key as a bearer token, returns JSON with a person key. Tear down what you started; never kill by process name.
Isolation: Every run makes its own lab with mktemp -d and a private HOME, state, crew and tools dir, and an OS-assigned port. crewd runs in its own process group under env -i with the XDG mask and a dead D-Bus address, and cleanup TERMs then KILLs that group only. Each browser run uses its own CHROME_DEVTOOLS_AXI_SESSION and profile. Never read the owner's install or the owner's person.key, and never signal a pid that the run did not spawn.
When the repo's .done-done.yaml has an instance block, done-done already runs the app at $DONE_DONE_BASE_URL (its own port and HOME): BASE is then that URL, never a hard-coded port.

## Drive

Select affected recipes from the full maintained map in `docs/verification/README.md`; the entries below are initial smoke routes, not exhaustive product coverage. Honor each recipe's preconditions, spending approval and limitations. Native and installed-PWA claims need their own recipes; web captures alone do not prove either.

Harness: curl for the HTTP API; chrome-devtools-axi with its own CHROME_DEVTOOLS_AXI_SESSION for the browser UI; a shell for the lab and teardown. Drive through the repo's real handles that each feature file names:

- [Onboard and chat with Chief](features/onboard-and-chat-with-chief.md): Open the app's first screen (Hello), or call the API directly after a fresh lab starts (`docs/verification/runbook.md`)
- [Recruit a helper and assign it a job](features/recruit-a-helper-and-assign-it-a-job.md): Send a message to Chief that carries a crew_recruit tool call, then post a job in the new helper's own thread (`docs/verification/recruit-assign.md`)
- [Chief's thread on a desktop and a phone](features/chief-s-thread-on-a-desktop-and-a-phone.md): Open the app's private launcher URL for the lab, then the Chief thread (#/chief) (`docs/verification/runbook.md`)
- [Chief's real reply on MiniMax Flash](features/chief-s-real-reply-on-minimax-flash.md): Run the `chat-real` journey; the stub reply is hidden, so only a real key shows one (`docs/verification/chat-real.md`)
- [The crew room and Chief's standup](features/the-crew-room-and-chief-s-standup.md): Run the `crew-room` journey; Chief hands one job to two helpers on a real key and the room ends on his standup (`docs/verification/crew-room.md`)
- [A bot's read of a file outside its own folder](features/a-bots-read-of-a-file-outside-its-own-folder.md): Run the `flash-read` journey; the crew reads its own work without a question, on a real key (`docs/verification/flash-read.md`)
- [Phone live control](features/phone-live-control.md): Open a working helper's chat on the phone layout; its control bar has Stop and Take control, and an ask shows Yes, go ahead (`docs/verification/phone-live-control.md`)
- [A pinned tool that failed](features/a-pinned-tool-that-failed.md): Run the pinned-tool drive script; the helper's "What happened" shows the failed step and the newer copy an update brings in
- [Key sign-in sheet](features/key-sign-in-sheet.md): Home's "Sign in with OpenRouter" opens the key sheet; paste a stub key, pick a live model (`docs/verification/key-sheet.md`)
- [Quiet-job nudge](features/quiet-job-nudge.md): Run `scripts/verify/quiet-nudge.sh <out>`; Chief says a job is quiet once, a day later it ends unsure (`docs/verification/quiet-nudge.md`)
- [Pair the PWA and get a real Chief reply](features/pair-the-pwa-and-get-a-real-chief-reply.md): The core journey — run the `core` journey (the `upgrade` journey proves the release path) (`docs/verification/pair-chat.md`)
- [Onboarding in Chief's chat](features/onboarding-from-hello-into-chief-s-threa.md): First run opens Chief's chat asking the name, then his pitch with ideas to try; run `onboard-chat` (`docs/verification/onboard-chief-chat.md`)

## Evidence

What to capture: Response bodies from /api/onboard, /api/bots/chief/messages and polled /api/bots/chief; crew.db rows read in read-only mode; crewd.log; screenshots at 1440x900 and 390x844 in day and night; getBoundingClientRect geometry for layout claims; the journey's exit code; the run's step record, which every journey in scripts/verify writes through the shared writer (scripts/verify/steps.mjs) beside its captures, from the records in scripts/verify/steps.json. Exercise the real user path, not internal setters; done-done's judge checks every capture in the run folder against the outcome, so save only captures of the resulting state there and keep any of earlier steps outside it; verify side effects alongside what is visible. Evidence goes to the run folder `done-done run` prints. Commit the skill/config before capturing. On the clean candidate run `done-done check --outcome "<bounded claim>" <explicit recorded files>`, then `done-done receipt` with the same arguments; the judge must pass at least one real-app capture. Name `done-done-verify-crewhouse` in the Checks proof line, and use `done-done signoff` to prepare the Evidence card. Never call a failed or inconclusive run proven.

## Cleanup

Stop the instances this run started and remove scratch state. Evidence survives cleanup: never delete the run folder.
