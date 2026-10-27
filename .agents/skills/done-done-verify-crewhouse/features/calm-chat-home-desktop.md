# Calm chat, Home list and desktop panes

Part of the crewhouse verification map. Source: `AGENTS.md` (the calm design bullet) and `test/office.test.ts`.

## How to get to it (user POV)

On a phone, Home is the chat list: Chief first with his count, then each helper, then The crew, the goal row and Hand me a job, with the places button and search floating at the foot. Tap Chief for his thread: a floating pill head, soft bubbles, your own lines in amber, a finished file as a small attachment. On a computer, `#/` opens three panes: the list, Chief's thread, and the details column only when it has content.

## Driving it

Harness: chrome-devtools-axi with its own CHROME_DEVTOOLS_AXI_SESSION for the browser UI; a shell for the lab and teardown.

1. Build the web app with `npm run build:web`.
2. Real daemon: `scripts/verify/home-states.sh <out> first|busy|resting` boots its own stub-engine crewd, seeds the state, and captures Home at 390 and 1280, day and night, through `home-gate.mjs` (no text under 16px, nothing clipped outside a `.clamp` line, no sideways scroll). `GATE_PWA=1 node scripts/verify/home-gate.mjs <repo> <url#/chief> <out> <slug>` takes the installed-app window mode.
3. The calm thread's reference household is `?demo=thread#/chief` (the recap, a NEW divider, link chips, an attachment, a live helper); `?demo` and `?demo=crew30` load the list. Read every PNG at 390 and 1280/1440, day and night.
4. The layout rules (no row overlaps, counts agree across the phone list, the computer's pane and the tab bar, compact attachment opens the read-only sheet) are `node scripts/test.mjs test/office.test.ts`.
5. Stop the task-owned browser session with `chrome-devtools-axi stop`; home-states.sh stops its own daemon.

## The phone app (APK)

Web captures prove nothing about the APK. The Android app (`mobile/App.tsx`) carries the same calm design: Home is the chat list (your initial, a round +, a search pill, Chief's row with his amber count, each helper's row, The crew, then Your AI accounts and Hand me a job), the places ride a floating dock, and every thread has the pill head, soft bubbles, amber own lines and NEW divider, compact attachments, the one-row live line with Steps folded, and the pill composer. Phone-only: the head sits in a band above the thread (no blur), and there is no goal row (the phone has no goal screen).

1. Build the x86_64 release APK from the head through fm-mem-gate (`cd mobile && npx expo prebuild -p android --clean --no-install && cd android && ./gradlew assembleRelease --console=plain -PreactNativeArchitectures=x86_64`), with a fresh `TMPDIR` so Metro's cache cannot ship old JS, and check the bundle task ran (not UP-TO-DATE).
2. A task-owned emulator (task HOME, adb server port and AVD; never the shared ones), then the pairing lab (`scripts/verify/pair-lab.sh up`) seeded as home-states.sh's `busy`, `wm size 1080x2400` and `wm density 443` (390 wide), and `scripts/verify/phone-pair-typed.mjs --apk <apk>`.
3. With `scripts/verify/phone-ui.mjs`, capture Home, Chief's thread (`tap '^Chief$'`) and Writer Will's thread (`tap '^Writer Will'`), day and night (`cmd uimode night yes|no`), with `ui texts` beside each. Stop the emulator with `adb -s <serial> emu kill` under the same task HOME.
