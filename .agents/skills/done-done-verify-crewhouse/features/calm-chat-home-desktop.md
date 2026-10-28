# Calm chat, Home list and desktop panes

Part of the crewhouse verification map. Source: `AGENTS.md` (the calm design bullet) and `test/office.test.ts`.

## How to get to it (user POV)

On a phone, Home is the chat list: Chief first with his count, then each helper, then The crew, the goal row and Hand me a job, with the places button and search floating at the foot. Tap Chief for his thread: a floating pill head, soft bubbles, your own lines in amber, a finished file as a small attachment. On a computer, `#/` opens three panes: the list, Chief's thread, and the details column only when it has content.

## Driving it

Harness: chrome-devtools-axi with its own CHROME_DEVTOOLS_AXI_SESSION for the browser UI; a shell for the lab and teardown.

1. Build the web app with `npm run build:web`.
2. Real daemon: `scripts/verify/home-states.sh <out> first|busy|resting` boots its own stub-engine crewd, seeds the state, and captures Home at 390 and 1280 (`GATE_WIDTHS=360,390,445` for those widths instead), day and night, through `home-gate.mjs` (no text under 16px, nothing clipped outside a `.clamp` line, no sideways scroll). `GATE_PWA=1 node scripts/verify/home-gate.mjs <repo> <url#/chief> <out> <slug>` takes the installed-app window mode.
3. The calm thread's reference household is `?demo=thread#/chief` (the recap, a link chip in a list, an attachment, a NEW divider, a look's roles as one group of compact rows, a live helper); `?demo` and `?demo=crew30` load the list. Read every PNG at 390 and 1280/1440, day and night.
4. The layout rules (no row overlaps, counts agree across the phone list, the computer's pane and the tab bar, compact attachment opens the read-only sheet) are `node scripts/test.mjs test/office.test.ts`.
5. Before and after: journey `calm-design` (`scripts/verify/calm-design.sh`) captures Chief's chat and Home at 390 and Chief in three panes at 1280, day and night, on `?demo`; `CALM_HEAD=$PWD done-done verify calm-design --outcome "..." --foreground` also drives `base_ref` (the commit before the redesign) into `before/` under the same names. The frames Main approved are in `docs/design/approved/`.
6. Stop the task-owned browser session with `chrome-devtools-axi stop`; home-states.sh stops its own daemon.

## The phone app (APK)

Web captures prove nothing about the APK. The Android app (`mobile/App.tsx`) carries the same calm design: Home is the chat list (your initial and a round + across the top, Your AI accounts first only while nothing is signed in, Chief's row with his amber count, each helper's row, The crew, then Your goal when there is one, Your AI accounts and Hand me a job as plain rows), with the places button and the search pill floating at its foot and no tab bar (the places button opens Your goal, Your crew, Your things, Routines and Settings); every other screen keeps the floating tab dock, and every thread has the pill head, soft bubbles, amber own lines and NEW divider, compact attachments, the one-row live line with Steps folded, and the pill composer. Phone-only: the head sits in a band above the thread (no blur).

1. Build the x86_64 release APK from the head through fm-mem-gate (`cd mobile && npx expo prebuild -p android --clean --no-install && cd android && ./gradlew assembleRelease --console=plain -PreactNativeArchitectures=x86_64`), with a fresh `TMPDIR` so Metro's cache cannot ship old JS, and check the bundle task ran (not UP-TO-DATE).
2. `PHONE_APK=<apk> done-done run phone-calm` (`scripts/verify/phone-calm.sh <out> [apk]`): its own emulator through fm-mem-gate at 390 wide, a golden-stub pairing lab seeded as home-states.sh's `busy`, paired by the typed code. It captures Home (top and scrolled to its end), Chief's and Writer Will's threads day and night with the screen's texts beside each, the box, its send and a file chip above the keyboard (`phone-keyboard.mjs`, `composer-keyboard.json`), one `hi` sent from Chief's box with his reply under it (checked in crewd too), and Home's Your goal row once a goal is on. `HOME_WIDTHS="360 390 445"` also takes Home at each of those widths, day and night (`home-<day|night>-<width>.png`). It stops its emulator and lab on exit.
