# News on an Android phone with the app closed

Part of the crewhouse verification map. Source: `docs/verification/phone-news.md`.

## How to get to it (user POV)

Pair the Android app and say Allow to the notification question and to running in the background. Leave the app (or let the phone kill it, or restart the phone): the shade keeps "Crewhouse is connected", and Chief's reply, a card for your yes and a helper's finished job each show as a notification; a tap opens that chat or card.

## Driving it

1. Build the x86_64 release APK (`cd mobile && npx expo prebuild -p android --clean --no-install`, then `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64`, through fm-mem-gate) and `npm run build:web`.
2. Run `done-done run phone-news` (or `FM_MEM_GATE=~/firstmate/config/fm-mem-gate.sh bash scripts/verify/phone-news.sh <out> [apk]`; its own AVD, emulator on port 5590, golden-stub lab, typed-code pairing; everything torn down after; the reboot takes a few minutes).
3. Capture: the nine `news-*.png` stills listed in the doc and the step record.
4. It proves: backgrounded, killed and rebooted cases each list the notification on the phone and the tap opens its screen. Not proven: news missed while the link was down, Doze delays.
