# Crewhouse verification map

The maintained source for verifying user-facing behavior of Crewhouse. Read this index
before driving the app, then use the matching feature file as the recipe. Launch, doctor,
evidence and cleanup live in [`runbook.md`](runbook.md); recipes assume an isolated crewd on the stub engine unless they explicitly require the real engine.

## done-done primitives and selection

The table below is the feature-to-journey map: select every row whose behavior or
surface the diff changes. The recipes' native, installed-app, real-engine and
negative/security legs remain required; generic smoke is not their replacement.

| Feature recipe | Named primitive / driver |
|---|---|
| composio-policy | `node scripts/test.mjs test/composio.test.ts` — isolated engine-host gate, completion, exact virtual connection-schema discovery (including older Chief jobs and stale native calls), and Composio-first Gmail/native-off checks; `done-done run screens` is app smoke only, not live Gmail acceptance ([recipe](composio-policy.md)) |
| mail-watch / Chief inbox triage | `done-done run inbox-triage` — recorded synthetic Gmail, read-only scripted Chief alert, cross-sender context and quiet repeat; real personal-inbox phone/PWA acceptance remains separate |
| delivered-files | `done-done run delivered-files` |
| workbook-chart | `done-done run workbook-chart` (includes installed PWA) |
| slides-deck | `done-done run slides-deck` (includes installed PWA) |
| signin-card | `done-done run signin-card` plus the iPad leg |
| unlock-card | `done-done run unlock-card` |
| custom-rules | `done-done run custom-rules` — confirmation, save/cancel/edit, scripted helper draft and restart (browser only) |
| chief-soul | `done-done run chief-soul` (live voice: the recipe's real-model leg) |
| helper-files | `done-done run unlock-card` — the rule is on that card, so its driver carries the helper-files leg (Keep it / Keep them, Forget this file, and Remove it when the job ends taking a copy) |
| thread-hygiene | `done-done run ask-in-view` and `done-done run -- bash scripts/verify/new-pill.sh "$DONE_DONE_EVIDENCE_ROOT"` plus the recipe's other cases |
| site-signin | `done-done run site-signin` |
| pwa-pair | `done-done run pwa-pair` plus typed-code and push legs |
| pair-chat (the core journey) | `done-done verify core --outcome "<claim>"` once the person approves the spend (below); `done-done verify upgrade --outcome "<claim>"` for the release path |
| pwa-shell / pwa-offline / pwa-resume / chief-computer | `done-done run pwa-plan` with the recipe's task-owned `PLAN` |
| phone-pairing | `done-done run phone-pair` plus typed/timed-code drivers |
| phone-chat-keep | `done-done verify phone-chat-keep --outcome "<claim>"` once the person approves the spend (below), plus approval-sheet driver |
| phone-continue | `done-done verify phone-continue --outcome "<claim>"` once the person approves the spend (below) |
| image | `done-done run image` (includes installed PWA) |
| where-cloud (the phone's cloud screen) | `done-done run cloud-screen` with `SERIAL`, `CLOUD_APK` and `CLOUD_OTHER` (a folder for every state besides the second phone's offer) set (an emulator and the flagged lab APK; [where-cloud.md](where-cloud.md)) |
| phone-only-minimax | `done-done run phone-only-minimax` with `SERIAL`, `PHONE_APK` and `PHONE_OTHER` (a folder for every state besides the model pick) set (an emulator and the release APK; [phone-only-minimax.md](phone-only-minimax.md)) |
| versions | `done-done run versions`, with `SERIAL` and `APK` for the phone ([versions.md](versions.md)) |
| binary-inspect | `done-done run binary-inspect` — Byte looks inside a binary in its own folder: the note holds the inspector's own words, and a file from outside that folder is refused |
| skill-eval | `done-done run skill-eval` — the paired skill eval on the stub engine: the same prompts with and without a bundled skill, every run's document checked, the raw runs in a JSONL file and the two arms diffed on one page |
| All other rows | Drive the recipe through `done-done run -- <command>`; use its existing tests and `scripts/verify/` drivers, retaining every manual leg |

Required input variables are explicit in `.done-done.yaml`; never use the owner's
instance or device. For a multi-step recipe use a task-owned drive script, export
its `EV=$DONE_DONE_EVIDENCE_ROOT`, trap cleanup and retain action, outcome and side
effects. Each selected feature has its own evidence and NOT RUN reasons. The
[runbook](runbook.md#selection-and-reporting) owns claims, receipts and sign-off.

Journeys marked `spends:` in `.done-done.yaml` (phone-chat-keep, phone-continue) make live
model calls, so `done-done run` refuses them (exit 2, nothing runs). Start one with
`done-done verify <journey> --outcome "<claim>"`: it parks at `awaiting_approval` (exit 4,
finding `spend-1`) until the person answers. `done-done respond --action approve --reason
"<who approved the spend>"` runs it; `--action skip` ends the run `fail` with nothing spent.
Without that approval the journey is NOT RUN; never drop `spends:` or wrap its driver in
`done-done run --` to get past the ask.

Every journey leaves the step record done-done reads beside its captures: what a person
did, and what they can see at the end. One writer for all of them
(`scripts/verify/steps.mjs`) and one record per journey in `scripts/verify/steps.json`,
named after the journey script. A journey adds its record with one call
(`node scripts/verify/steps.mjs "$OUT" <name>`, or `writeSteps(EV, '<name>')` in a node
driver); the record's own words come from the registry, and a journey that has words of
its own passes them on (`"ask=$ASK"`, `"model=$MODEL"`). A journey that leaves no record
cannot be sealed: `done-done check` refuses the run with "has no step record".

## Baseline preconditions

- crewd healthy at `http://127.0.0.1:$PORT` (engine: stub), started by this run, per runbook.md.
- `GET /api/state` answers with `person` and a `bots` list containing `chief`.
- Browser drive uses a task-named `CHROME_DEVTOOLS_AXI_SESSION` (shared default session is another lane's).
- HTTP headers and browser authority bootstrap follow [Drive](runbook.md#drive); use its `H` array for mutations before driving any feature.

## Features

| ID | File | What it proves |
|----|------|----------------|
| herdr-setup | [herdr-setup.md](herdr-setup.md) | The helper's Herdr setup and prerequisite refusal |
| phone-pairing | [phone-pairing.md](phone-pairing.md) | Native camera, typed and timed-code pairing on the release app |
| put-chief | [headless-host.md](headless-host.md#the-phones-one-line) | The phone's On my computer: a cloud/sandbox host is administered over SSH with a key supplied by path, uses the published relay for phone access, never joins the owner's tailnet, and is deleted after the run; `test/cloud-connect.test.ts` rejects any Tailscale invocation |
| look-check | [look-check.md](look-check.md) | The mandatory UI-change step: each changed screen at 360 wide with the largest text, light and dark, on web and the Android app, fails on stretched pictures, clipped text, overlaps, off-screen parts and edge strips, beside its approved mock (`scripts/verify/mocks.tsv`) |
| chat-attach | [chat-attach.md](chat-attach.md) | Chief's paperclip: a PDF or document lands in the helper's inbox under crewd's own name and shows as a one-line file card above the words, at 390/1440, the largest text and in the installed app; the phone app's + sheet, chip and big-file stream on an emulator |
| custom-rules | [custom-rules.md](custom-rules.md) | Chief confirms a standing instruction before saving; explicit Saved/Cancelled cards, editable rules in Settings, separate safety checks and helper draft (browser only) |
| onboard-chief-chat | [onboard-chief-chat.md](onboard-chief-chat.md) | Hello screen and its trust links, onboarding, Chief's greeting/chat, and shared profile facts with a plain saved note |
| crew-room | [crew-room.md](crew-room.md) | The crew room and Chief's standup on a real MiniMax M3.1 Flash run: Chief hands one job to Scout then Scribe, the room shows his brief to each and his closing words as the standup, at 390 wide, day and night |
| chat-real | [chat-real.md](chat-real.md) | First-day path on the real engine (no name, first request from Hello, MiniMax key): Chief starts on M3.1 Flash by itself and a real reply arrives (the stub engine's reply is hidden by design); `timeline.txt` times each step; the reply at 390 wide, day and night; fails when none arrives in time |
| flash-read | [flash-read.md](flash-read.md) | A bot's read of a file outside its own folder: the crew's own work (a helper's file) is read without a question and the job ends, the person's own files still ask, anything else is refused; driven on the real engine on MiniMax M3.1 Flash through OpenRouter, with Chief's thread at 390/1440, day and night |
| chief-wait | [chief-wait.md](chief-wait.md) | Chief waits for a helper's report: the hand-off goes out natively, the report comes back in Chief's next turn and Chief answers the person from it, with no work of his own and no question while the helper works; driven on the real engine with a scripted model, with Chief's thread at 390/1440, day and night |
| phone-live-control | [phone-live-control.md](phone-live-control.md) | A live helper run on the phone layout (390 wide, day and night) with its control bar, then Stop, Take control with Hand it back, and Yes, go ahead on a file ask each working, on MiniMax M3.1 Flash and the real engine; fails when any step does not happen in its bound |
| phone-web-pair | [phone-web-pair.md](phone-web-pair.md) | A new person's phone browser pairs by the computer's QR (a link to the computer's own web app) and chats with Chief on MiniMax M3.1 Flash: Where screen, Pair sheet, the two words, paired Home and Chief's reply at 390 wide |
| image | [image.md](image.md) | A photo both ways in Chief's chat: picked with + it shows its thumbnail in the box with the words, sent it is kept under crewd's name and given to Chief's model, and a helper's picture comes back on Chief's reply (never the person's photo again), at 390/1440, day and night, in the installed app, on the stub engine |
| video-job | [video-job.md](video-job.md) | A pasted video link: Chief's quality card with sizes before anything downloads, then only the pick saved with its link, at 390/1440, day and night, in the installed app |
| pinned-tool-failure | [pinned-tool-failure.md](pinned-tool-failure.md) | A pinned kit tool that failed: the step says the work did not happen and names the newer copy an update brings in, at 390/1440, day and night |
| answer-check | [answer-check.md](answer-check.md) | A scout's answer waits for a second helper to challenge it: Chief's thread names the checked answer, who checked it and what the check found (390, day and night), on the stub engine |
| quiet-nudge | [quiet-nudge.md](quiet-nudge.md) | A job quiet for hours: Chief's one line in his thread (390 and 1280, day and night), no repeat, ends unsure at 24 hours |
| chief-capabilities | [chief-capabilities.md](chief-capabilities.md) | Real model words: Chief answers "What can you do?" plainly and truly (crew's computers, files, websites, yes before buying or sending, routines, Google once connected) and ends with one personal next step |
| recruit-assign | [recruit-assign.md](recruit-assign.md) | Chief recruits or proposes a custom helper; assignment, wrap-up and long/bullet-only relay openings; real Marketing crew recipe, shared profile and Chief's read-only skill admission |
| home-stack | [home-stack.md](home-stack.md) | Home is the crew view (Stack): Chief's card is the one way to his asks and thread, crew cards and `#/crew` tiles read one status, at desktop and phone, web and native; a working face moves and Reduce Motion stills it (`scripts/verify/face-motion.mjs`) |
| chief-profile | [chief-profile.md](chief-profile.md) | Chief's profile from his hero (Stack J09c: blue portrait card; on a computer portrait left, rows right): Routines with Add a routine, the News switch silencing news, Instructions, the computer live (Chief's own, or the helper on one) with Take control, or No computer yet with its reason; You have control / Hand it back; Take control everywhere. Journey: `done-done run chief-profile` |
| settings-hub | [settings-hub.md](settings-hub.md) | Settings on the final Stack J09a: one card then Look on a phone, a header bar and two columns (You and Look, Connected) on a computer; a hire card's name on one line and its yes in the helper's first name |
| things | [things.md](things.md) | Your things on the final Stack J07a: each file its maker's colour card under Today, search and the newest sheet open beside on a computer; Open lands on the J07b read-only page, over Your things on a computer |
| add-to-crew | [add-to-crew.md](add-to-crew.md) | Add to your crew: every reviewed app, skill and plugin in sections by purpose (Mail, calendar and files first), search with a hit, a miss and the catalog, a filter chip, "N added", and a real Add on Weather turning into Added through the engine's trust gate |
| handoff | [handoff.md](handoff.md) | Chief's thread shows each hand-off as a chip (`Messaged <helper> · <status>`) under the one-limit sentence from crewd's grants; a helper's chat is read only with **Ask Chief about this**; the desk/iPad rail row carries the last line and time and a dot only while working, beside mocks `handoff` and `handoff-ipad` |
| handoff-lane-reset | [handoff-lane-reset.md](handoff-lane-reset.md) | A helper's job that fails (or a report that never comes) settles Chief's job at once in its own words and lets go of his lane; a helper that finished is read for its result instead of being reported failed |
| native-legwork | [native-legwork.md](native-legwork.md) | Chief's guarded spawned web lookups: admitted children only on his own job, web reads through the gate, one answer, no replay after a crewd kill |
| crew-list | [crew-list.md](crew-list.md) | The crew rail and `#/crew`: only Chief says "Needs you"; a crew member waiting on the person reads "Waiting" |
| status-one-source | [status-one-source.md](status-one-source.md) | One status per member from the adapter: Chief idle reads Free (never green At work), no member "Resting", every card needing a yes counts on Chief, a relayed result leaves no unread badge; the same words and counts on header, rail, live line, Home's cards, `#/crew` tiles, phone and iPad |
| bubble-write-it-here | [bubble-write-it-here.md](bubble-write-it-here.md) | On the release APK: Chief's bubble over another app's box, Write it here, and the action it offers (Copy or Put it in) |
| ai-accounts-view | [ai-accounts-view.md](ai-accounts-view.md) | Settings' AI-accounts card: who is ready, resting, or plan-less, without any sign-in; each account's one model |
| account-rests | [account-rests.md](account-rests.md) | An account limit: after a failover no standing "resting" line or Office strip and Chief reads "At work"; with every account resting Chief says once when work starts again, and it resumes with no ask |
| key-sheet | [key-sheet.md](key-sheet.md) | The key sign-in sheet for OpenRouter and MiniMax: paste a (stub) key, the kit checks it, the sheet lists the account's live models, a pick with a colon in its id is kept (390 and 1280, day and night; no model call) |
| signin-card | [signin-card.md](signin-card.md) | Chief's sign-in card leads with one recommended account; Go's published not-included key result reaches its existing plan recovery (HTTP fixture, web and installed PWA) |
| openrouter-signin | [openrouter-signin.md](openrouter-signin.md) | Real-engine recipe: the explicitly offered OpenRouter route opens its authorize URL through the published kit instead of a plugin allow-list rejection, and cancelling leaves the account signed out |
| site-signin | [site-signin.md](site-signin.md) | A helper's `crew_signin` becomes Chief's Sign in to <site> card with the site's icon; one tap opens the helper's screen large and driving, Done hands it back, the helper carries on and the card becomes "Signed in to <site> · <time>" |
| unlock-card | [unlock-card.md](unlock-card.md) | A helper's `crew_unlock` becomes Chief's locked-files card (mock 3A): a password field per file, a wrong one keeps that file with a plain line, the right one leaves unlocked copies and "Unlocked · <time>", and no row, database file, log, model turn or browser profile holds a password. The same card carries the one plain retention rule for the helper's files with the person's pick — the job's end takes its copies, or they are kept and each is a card in the helper's chat with **Forget this file** on it (`POST /api/bots/:id/forget-file`); the driver proves the kept copy, the forgotten one and a copy taken when its job ends |
| helper-files | [helper-files.md](helper-files.md) | The one plain rule for a helper's files in Chief's chat: unlocked copies go when the job ends, or stay when the person picks Keep, and a sent document or a kept copy is removed by **Forget this file** |
| signin-stepper | [signin-stepper.md](signin-stepper.md) | The SignIn/ConnectApp shared stepper's labels wrap only between words at 320/360/390 and 1.3x text, with no sideways scroll, and unchanged at 390/desktop |
| voice-call | [voice-call.md](voice-call.md) | Talk with Chief: a hands-free call in Chief's chat that listens, sends, reads his reply aloud a sentence at a time in the device's own voice and speed, listens again (never while reading), and Stop ends it; every state beside its mock at 390/1440, day and night, and in the app window |
| voice | [voice.md](voice.md) | Voice in and out in Chief's chat, in the installed app: the mic listens and the words wait in the box until send (Safari's recognizer counts as online, with its line); Talk sends what was said and reads Chief's reply aloud with the line marked, at 390 and 1440, day and night |
| chat-live | [chat-live.md](chat-live.md) | From send to reply the thread never sits still (live line, handoff mirror, "still working" on it after 4 s without an event, end line); the line follows the running turn, not the newest send (a queued one reads "Next: …", the clock counts from `run.admitted`); toasts never over words, and the phone's bubble never over the app's text |
| send-stall | [send-stall.md](send-stall.md) | A send the computer hasn't answered says "Reconnecting…" with the words kept; a failed one says "Not sent" with a Retry that sends the same words once, day and night at 1440 and 390 |
| term-screens | [term-screens.md](term-screens.md) | Things, routines, helper details, the file panel, first run and the Share sheet wear Term: shared tiles, one blue primary, names in full; on a phone, Hello leads with the ideas, a thread is bubbles and plain text, and a card is one primary plus a ⋯ sheet |
| thread-clear | [thread-clear.md](thread-clear.md) | Phone threads scroll in their own column: the sign-in card's buttons clear the composer, no line under the top bar; Chief says the sign-in wait once, and his header says it too |
| thread-hygiene | [thread-hygiene.md](thread-hygiene.md) | The thread opens at its latest line and keeps the bottom, except that an open ask the footer card would hide lands on its own top; reading up mid-turn keeps the place and a "↓ New" pill jumps to the latest (web, installed app and phone); notes and cards sit in time order; "Your things", plain job names; `#/chief` and `#/` are one screen |
| stalled-run | [stalled-run.md](stalled-run.md) | A turn the engine went silent in ends itself after `CREWHOUSE_HUNG_MS` (10 min): the task fails plainly, its files stay, Chief says so once in his thread, and the next message runs |
| desktop-start-refusal | [desktop-start-refusal.md](desktop-start-refusal.md) | Opening a helper's screen on a machine whose engine cannot load a system library refuses at start with the library named and the install hint (never a generic error, never "grant it on the Tools tab" for a granted computer); the same screen opens on a healthy machine |
| reply-fold | [reply-fold.md](reply-fold.md) | A long chat reply folds behind More on whole items (no empty or half-cut bullet); More and Less toggle |
| workbook-chart | [workbook-chart.md](workbook-chart.md) | A money answer with charts: `crew_workbook`'s `charts` become real chart parts in the .xlsx (LibreOffice draws them from the cells), `GET /api/workbook` reads them back, and the preview panel draws bar, line and pie over the sheet, at 1440/390, day and night, the largest text and in the installed app |
| slides-deck | [slides-deck.md](slides-deck.md) | A helper's `crew_slides` becomes a real `.pptx` crewd writes itself (LibreOffice opens it, 5 pages), delivered like any finished file and previewed one frame per slide at 1440/390 day/night and in the installed app |
| skill-eval | [skill-eval.md](skill-eval.md) | A skill measured against its own baseline on the stub engine: the same prompts with and without it, each run's document checked against a fixed rubric, the raw runs in a JSONL file, the two arms diffed; a skill that does not beat the baseline is said so plainly |
| delivered-files | [delivered-files.md](delivered-files.md) | `/files/` answers only the browser cookie the person's key mints (403 to a helper's shell over the shared loopback, and to the bare key); the app still shows pictures and videos, opens PDFs and downloads sheets through plain `/files/` links with that cookie, at 1440 and 390, night and day |
| pwa-demo-boot | [pwa-demo-boot.md](pwa-demo-boot.md) | The published static shell opens Chief's "Where should I work?" on a public origin (no backend), `?demo` the in-bundle demo, while crewd's loopback stays real; ?real overrides |
| where-cloud | [where-cloud.md](where-cloud.md) | First-screen choices and phone-only key-first boat.dev setup through to chatting with Chief on that computer (the host enrols the delivered phone key; the phone links through the computer's own relay address); web directs cloud setup to the phone app. The setup is repeatable: Try again sets the same computer up again, another computer in the account replaces the one the phone had, and the app's own refusals are named. See [where-cloud.md](where-cloud.md) for the flow, the fake-Boat journey test and the real-Boat recipe. |
| phone-accounts | [phone-accounts.md](phone-accounts.md) | The phone's Home row names the AI account signed in on the computer, with its mark (MiniMax on the stub), and keeps the sign-in sentence only when nothing is signed in; emulator, 390 wide, day and night |
| chief-computer | [chief-computer.md](chief-computer.md) | Settings › Chief's computer, including the phone-only boat.dev key row; see [chief-computer.md](chief-computer.md) for details. |
| pwa-shell | [pwa-shell.md](pwa-shell.md) | The home-screen app: status bar and browser bar in the look's colour, safe-area insets, iOS launch screens, the rich install sheet and Settings' quiet install row, installed for real in an isolated Chromium |
| pwa-offline | [pwa-offline.md](pwa-offline.md) | The service worker: a cold offline reload served from cache, a real push event showing a content-free notification, and the home-screen badge mirroring Needs you |
| pwa-pair | [pwa-pair.md](pwa-pair.md) | The demo's Pair card: a relay code or the 12-letter code pairs the installed app through @byokit/pair, the two words match the computer's, the same app reloads on real data over the link, and Unpair goes back to the demo |
| pair-chat | [pair-chat.md](pair-chat.md) | The core journey on the real engine: the app pairs to the computer (code, two words, yes there), says hello, and Chief really answers in his thread; the upgrade leg installs the previous published version and upgrades over it in place |
| ipad-tailscale | [ipad-tailscale.md](ipad-tailscale.md) | The README's iPad route: `./crewhouse phones web` serves the link at the computer's Tailscale https name, the iPad installs from it, pairs with the 12-letter code, then sends to Chief, approves a card and stops a job from the installed app |
| pwa-resume | [pwa-resume.md](pwa-resume.md) | The installed app's cold relaunch returns to the last place (thread or screen), per mode; a named link/shortcut wins; a deleted thread falls back to Home; the offline shell still opens; proven on the iPad simulator's real Safari home-screen app |
| find-clients-send | [find-clients-send.md](find-clients-send.md) | Paired-phone-only corporate attestation, suppression and one exact Gmail review; local/helper approvals refused; stop before Send |
| mail-reply-labels | [mail-reply-labels.md](mail-reply-labels.md) | One approval per Gmail draft/label, own sender/signature and formatted draft, no own-address reply, task/message/body-bound parked approval, real failure words, zero sends; normal and installed-PWA cards at both widths/themes |
| mail-watch | [mail-watch.md](mail-watch.md) | Chief's Gmail watch: only new mail is noticed, one quiet notice in the Dot shape with a thread link, silence on nothing new |
| event-routines | [event-routines.md](event-routines.md) | A routine starts on a new matching email or N minutes before a meeting, checked once a minute on the person's own Gmail/Calendar connection: first look is a baseline, each event starts the helper once, through a failed read, missed ticks and a restart; refused before the app is connected |
| mail-attachments | [mail-attachments.md](mail-attachments.md) | A helper lists a conversation's attachments and saves one into its own `files/` folder over the read-only Gmail token (every call a GET, no card asked); the write is capped at 10 MB under a sanitised name, and nothing attached, too big, or unfetchable is a plain `error:` line |
| routine-history | [routine-history.md](routine-history.md) | A watch or check-in says what it waits for on its card and Routines row; beside Do it now the last run (nothing new / told you / didn't finish, with the cause) and up to five recent runs; Do it now holds Running… until the new result lands |
| routine-monthly | [routine-monthly.md](routine-monthly.md) | A schedule can name a date each month ("the 1st of every month 9am"); the card and Routines row read the same words, a shorter month skips the date, and the refusal names a monthly example |
| test-scratch | [test-scratch.md](test-scratch.md) | `npm test` / `./crewhouse test` allocate a fresh mode-0700 root on the caller's physical disk with room for Chromium's and the firstwords bridge's sockets at the maximum PID width, remove only that root once its children exit, and never sweep or adopt a stale or foreign one |
| phone-only-signout | [phone-only-signout.md](phone-only-signout.md) | On the release APK with no computer: the Chief chat header's Sign out (beside Use a computer) confirms once, removes the saved key and returns to the first chooser, where a relaunch stays; at 360 and 320 dp with 1.3× text |
| phone-only-minimax | [phone-only-minimax.md](phone-only-minimax.md) | Chief on this phone offers MiniMax beside OpenRouter: a lab MiniMax key is saved through the kit's `minimax:key` route, the kit's MiniMax models are offered to pick from, the chat header names the pick, and Sign out leaves no key (390, day and night; no model call) |
| phone-chat-keep | [phone-chat-keep.md](phone-chat-keep.md) | Phone-only chat kept in app storage: kill-proof turns (Stopped + Try again, Interrupted + Retry with one document file), the offline queue and banner, the exact-text approval sheet, and sign-out clearing the kept chat |
| phone-composer | [phone-composer.md](phone-composer.md) | The phone's message box keeps its placeholder and words on one line at the largest text: at `width / fontScale < 360` the field takes the whole row and the buttons drop under it, unchanged at normal text |
| phone-helper-header | [phone-helper-header.md](phone-helper-header.md) | A helper's chat header at the largest text: the name and role keep the full width and Stop/Details wrap to their own row under them (`width / fontScale < 360`), unchanged at normal text |
| phone-continue | [phone-continue.md](phone-continue.md) | Paired phone offers "Continue on your computer": the phone-only chat (queued and stopped turns marked) reaches Chief as one message, the phone copy is archived only after the computer answers, Not now keeps it, sign-out erases the archive |

## Proof and skip reporting

- Every user-visible change also carries the Review evidence set from
  [`runbook.md`](runbook.md): the changed screen in dark and light at 390 and 1440, plus
  one motion recording of the changed interaction, in the evidence folder the PR names.
- Capture the user action and the resulting state, not only the final screen.
- UI proof = screenshot plus a geometry/state `eval` (label text, counts) — screenshots alone prove nothing on a text-only read.
- API proof = the request, the response body, and the durable state (message row, task row, file on disk).
- Anything the stub engine cannot exercise (real model words, real sign-ins, real relay) is reported as a stub-engine limitation, never as passed.
