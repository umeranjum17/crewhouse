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
| look-check | [look-check.md](look-check.md) | The mandatory UI-change step: each changed screen at 360 wide with the largest text, light and dark, on web and the Android app, fails on stretched pictures, clipped text, overlaps, off-screen parts and edge strips, beside its approved mock (`scripts/mocks.tsv`) |
| chat-attach | [chat-attach.md](chat-attach.md) | Chief's paperclip: a PDF or document lands in the helper's inbox under crewd's own name and shows as a one-line file card above the words, at 390/1440, the largest text and in the installed app; the phone app's + sheet, chip and big-file stream on an emulator |
| onboard-chief-chat | [onboard-chief-chat.md](onboard-chief-chat.md) | Hello screen and its trust links, onboarding, Chief's greeting/chat, and shared profile facts with a plain saved note |
| chief-capabilities | [chief-capabilities.md](chief-capabilities.md) | Real model words: Chief answers "What can you do?" plainly and truly (crew's computers, files, websites, yes before buying or sending, routines, Google once connected) and ends with one personal next step |
| recruit-assign | [recruit-assign.md](recruit-assign.md) | Chief recruits or proposes a custom helper; assignment, wrap-up and long/bullet-only relay openings; real Marketing crew recipe, shared profile and Chief's read-only skill admission |
| office-layout | [office-layout.md](office-layout.md) | The Office view's counts and labels at desktop, phone and narrow widths |
| crew-list | [crew-list.md](crew-list.md) | The crew rail and `#/crew`: only Chief says "Needs you"; a crew member waiting on the person reads "Waiting" |
| status-one-source | [status-one-source.md](status-one-source.md) | One status per member from the adapter: Chief idle reads Free (never green At work), no member "Resting", every card needing a yes counts on Chief, a relayed result leaves no unread badge; the same words and counts on header, rail, live line, Office, Chats, phone and iPad |
| bubble-write-it-here | [bubble-write-it-here.md](bubble-write-it-here.md) | On the release APK: Chief's bubble over another app's box, Write it here, and the action it offers (Copy or Put it in) |
| ai-accounts-view | [ai-accounts-view.md](ai-accounts-view.md) | Settings' AI-accounts card: who is ready, resting, or plan-less, without any sign-in |
| account-rests | [account-rests.md](account-rests.md) | An account limit: after a failover no standing "resting" line or Office strip and Chief reads "At work"; with every account resting Chief says once when work starts again, and it resumes with no ask |
| signin-card | [signin-card.md](signin-card.md) | Chief's sign-in card leads with one recommended account and keeps every other provider under Use another account, at both widths, both themes and in the installed iPad app |
| site-signin | [site-signin.md](site-signin.md) | A helper's `crew_signin` becomes Chief's Sign in to <site> card with the site's icon; one tap opens the helper's screen large and driving, Done hands it back, the helper carries on and the card becomes "Signed in to <site> · <time>" |
| unlock-card | [unlock-card.md](unlock-card.md) | A helper's `crew_unlock` becomes Chief's locked-files card (mock 3A): a password field per file, a wrong one keeps that file with a plain line, the right one leaves unlocked copies and "Unlocked · <time>", and no row, database file, log, model turn or browser profile holds a password |
| signin-stepper | [signin-stepper.md](signin-stepper.md) | The SignIn/ConnectApp shared stepper's labels wrap only between words at 320/360/390 and 1.3x text, with no sideways scroll, and unchanged at 390/desktop |
| voice-call | [voice-call.md](voice-call.md) | Talk with Chief: a hands-free call in Chief's chat that listens, sends, reads his reply aloud a sentence at a time in the device's own voice and speed, listens again (never while reading), and Stop ends it; every state beside its mock at 390/1440, day and night, and in the app window |
| chat-live | [chat-live.md](chat-live.md) | From send to reply the thread never sits still (live line, handoff mirror, "still working" on it after 4 s without an event, end line), toasts never over words, and the phone's bubble never over the app's text |
| send-stall | [send-stall.md](send-stall.md) | A send the computer hasn't answered says "Reconnecting…" with the words kept; a failed one says "Not sent" with a Retry that sends the same words once, day and night at 1440 and 390 |
| term-screens | [term-screens.md](term-screens.md) | Things, routines, helper details, the file panel, first run and the Share sheet wear Term: shared tiles, one blue primary, names in full; on a phone, Hello leads with the ideas, a thread is bubbles and plain text, and a card is one primary plus a ⋯ sheet |
| thread-clear | [thread-clear.md](thread-clear.md) | Phone threads scroll in their own column: the sign-in card's buttons clear the composer, no line under the top bar; Chief says the sign-in wait once, and his header says it too |
| thread-hygiene | [thread-hygiene.md](thread-hygiene.md) | The thread opens at its latest line and keeps the bottom, except that an open ask the footer card would hide lands on its own top; notes and cards sit in time order; "Your things", plain job names; `#/chief` and `#/` are one screen |
| stalled-run | [stalled-run.md](stalled-run.md) | A turn the engine went silent in ends itself after `CREWHOUSE_HUNG_MS` (10 min): the task fails plainly, its files stay, Chief says so once in his thread, and the next message runs |
| reply-fold | [reply-fold.md](reply-fold.md) | A long chat reply folds behind More on whole items (no empty or half-cut bullet); More and Less toggle |
| workbook-chart | [workbook-chart.md](workbook-chart.md) | A money answer with charts: `crew_workbook`'s `charts` become real chart parts in the .xlsx (LibreOffice draws them from the cells), `GET /api/workbook` reads them back, and the preview panel draws bar, line and pie over the sheet, at 1440/390, day and night, the largest text and in the installed app |
| delivered-files | [delivered-files.md](delivered-files.md) | `/files/` answers only the browser cookie the person's key mints (403 to a helper's shell over the shared loopback, and to the bare key); the app still shows pictures and videos, opens PDFs and downloads sheets through plain `/files/` links with that cookie, at 1440 and 390, night and day |
| pwa-demo-boot | [pwa-demo-boot.md](pwa-demo-boot.md) | The published static shell opens Chief's "Where should I work?" on a public origin (no backend), `?demo` the in-bundle demo, while crewd's loopback stays real; ?real overrides |
| where-cloud | [where-cloud.md](where-cloud.md) | The first screen (mock C): Chief asks where to work — In my cloud (behind its build flag until BYOKit's cloud kit is published) / On my computer / Just on this phone — then the phone's cloud steps: pick boat.dev (Hetzner Soon), paste a key kept in the phone's own lock; web's cloud and phone rows point to the phone app |
| chief-computer | [chief-computer.md](chief-computer.md) | Settings › Chief's computer (behind the cloud build flag): update, reset with its sheet, daily snapshots, disk, boat.dev; every action stops at the kit with the not-ready line and no invented values; flag off leaves Settings unchanged |
| pwa-shell | [pwa-shell.md](pwa-shell.md) | The home-screen app: status bar and browser bar in the look's colour, safe-area insets, iOS launch screens, the rich install sheet and Settings' quiet install row, installed for real in an isolated Chromium |
| pwa-offline | [pwa-offline.md](pwa-offline.md) | The service worker: a cold offline reload served from cache, a real push event showing a content-free notification, and the home-screen badge mirroring Needs you |
| pwa-pair | [pwa-pair.md](pwa-pair.md) | The demo's Pair card: a relay code or the 12-letter code pairs the installed app through @byokit/pair, the two words match the computer's, the same app reloads on real data over the link, and Unpair goes back to the demo |
| ipad-tailscale | [ipad-tailscale.md](ipad-tailscale.md) | The README's iPad route: `./crewhouse phones web` serves the link at the computer's Tailscale https name, the iPad installs from it, pairs with the 12-letter code, then sends to Chief, approves a card and stops a job from the installed app |
| pwa-resume | [pwa-resume.md](pwa-resume.md) | The installed app's cold relaunch returns to the last place (thread or screen), per mode; a named link/shortcut wins; a deleted thread falls back to Home; the offline shell still opens; proven on the iPad simulator's real Safari home-screen app |
| find-clients-send | [find-clients-send.md](find-clients-send.md) | Paired-phone-only corporate attestation, suppression and one exact Gmail review; local/helper approvals refused; stop before Send |
| mail-watch | [mail-watch.md](mail-watch.md) | Chief's Gmail watch: only new mail is noticed, one quiet notice in the Dot shape with a thread link, silence on nothing new |
| mail-attachments | [mail-attachments.md](mail-attachments.md) | A helper lists a conversation's attachments and saves one into its own `files/` folder over the read-only Gmail token (every call a GET, no card asked); the write is capped at 10 MB under a sanitised name, and nothing attached, too big, or unfetchable is a plain `error:` line |
| routine-history | [routine-history.md](routine-history.md) | A watch or check-in says what it waits for on its card and Routines row; beside Do it now the last run (nothing new / told you / didn't finish, with the cause) and up to five recent runs; Do it now holds Running… until the new result lands |
| routine-monthly | [routine-monthly.md](routine-monthly.md) | A schedule can name a date each month ("the 1st of every month 9am"); the card and Routines row read the same words, a shorter month skips the date, and the refusal names a monthly example |
| phone-only-signout | [phone-only-signout.md](phone-only-signout.md) | On the release APK with no computer: the Chief chat header's Sign out (beside Use a computer) confirms once, removes the saved key and returns to the first chooser, where a relaunch stays; at 360 and 320 dp with 1.3× text |
| phone-chat-keep | [phone-chat-keep.md](phone-chat-keep.md) | Phone-only chat kept in app storage: kill-proof turns (Stopped + Try again, Interrupted + Retry with one document file), the offline queue and banner, the exact-text approval sheet, and sign-out clearing the kept chat |
| phone-composer | [phone-composer.md](phone-composer.md) | The phone's message box keeps its placeholder and words on one line at the largest text: at `width / fontScale < 360` the field takes the whole row and the buttons drop under it, unchanged at normal text |
| phone-helper-header | [phone-helper-header.md](phone-helper-header.md) | A helper's chat header at the largest text: the name and role keep the full width and Stop/Details wrap to their own row under them (`width / fontScale < 360`), unchanged at normal text |
| phone-continue | [phone-continue.md](phone-continue.md) | Paired phone offers "Continue on your computer": the phone-only chat (queued and stopped turns marked) reaches Chief as one message, the phone copy is archived only after the computer answers, Not now keeps it, sign-out erases the archive |

## Proof and skip reporting

- Every user-visible change also carries the Review evidence set from
  [`../SKILL.md`](../SKILL.md): the changed screen in dark and light at 390 and 1440, plus
  one motion recording of the changed interaction, in the evidence folder the PR names.
- Capture the user action and the resulting state, not only the final screen.
- UI proof = screenshot plus a geometry/state `eval` (label text, counts) — screenshots alone prove nothing on a text-only read.
- API proof = the request, the response body, and the durable state (message row, task row, file on disk).
- Anything the stub engine cannot exercise (real model words, real sign-ins, real relay) is reported as a stub-engine limitation, never as passed.
