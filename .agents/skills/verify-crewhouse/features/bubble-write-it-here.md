# Chief's bubble: Write it here, on the real app

A change to the bubble or its panel (`mobile/src/bubble.ts`, `mobile/src/panel.tsx`, `quick()`/`writeAsk()` in
`web/src/adapter.ts`) is proved on a release APK over another app's real text box, never by `test/ui.test.ts` alone.

**Setup.** Build the APK from the commit under proof (`cd mobile && npm ci && npx expo prebuild -p android --clean
--no-install && cd android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64`, through fm-mem-gate). Boot a
task-owned emulator with the camera fed a file and pair it with `scripts/phone-pair.mjs --apk …` (phone-pairing.md).
Recruit the writer (`POST /api/recruit {"template":"scribe","name":"Scribe"}`). On the phone: Settings, Chief on your
screen (after `appops set dev.crewhouse.app SYSTEM_ALERT_WINDOW allow`), and the service the panel's "Let Chief see the
box" points to (`settings put secure enabled_accessibility_services
dev.crewhouse.app/expo.modules.crewhousenet.CrewhouseAccessibilityService`). The first taps right after switching the
service on can read no box; tap again before calling it a failure.

**Where.** The box's app decides the action (`notesOn()`): an HN reader gets **Copy** and the labelled-notes ask,
anything else **Put it in** and the prose ask. Materialistic (`io.github.hidroh.materialistic`, the APK on its GitHub
releases) opens its own Add comment box on live Hacker News without a sign-in; Harmonic and the Reddit app hide reply
until signed in, which the test rules forbid. Google Messages (`am start -a android.intent.action.SENDTO -d sms:5551234`)
is the Put it in control.

**Drive** (`SERIAL=… node scripts/phone-ui.mjs tap '^Write it here$'`, `texts`, `shot <file>`): focus the box and type a
few words, tap the bubble, Write it here, type what it should say, Send, then the action button. Capture each step in the
phone's light and dark mode (`cmd uimode night yes|no`) and one `screenrecord` per theme. Read the ask crewd received
from `GET /api/bots/scribe` (`messages`): that is the proof of what was asked; the stub's reply is only an echo. After
Copy, paste into the box to prove the clipboard; never press the other app's Send. The panel has no desktop width; its
ask also shows in the writer's thread on the computer (`screens.sh … "#/h/scribe"`).

**Leaving.** If a panel is left open behind another app, the bubble stays hidden until it closes (`am task lock <task>`,
then `am task lock stop`, brings it back to tap away).
