# Where should I work? (first screen C) and the cloud steps

The first screen on the phone app (`GetStarted` in `mobile/App.tsx`) and on the public web shell (`Where` in
`web/src/main.tsx`): Chief asks "Hi, I'm Chief. Where should I work?" with In my cloud / On my computer / Just on
this phone, the sign-in-yourself note and "You can change this later in Settings." The words are `A.where` and
`A.CLOUD` in `web/src/adapter.ts`, one source for both. Approved mocks: `where`, `cloud-pick`, `cloud-key` in
`scripts/verify/mocks.tsv` (data/ch-cloud-onboarding-mock, Main2691).

The cloud row is behind a build flag until BYOKit's cloud kit (`@byokit/cloud`: `boat()`, `setupKey`) is on npm:
`EXPO_PUBLIC_CREWHOUSE_CLOUD=1` for the phone, `CREWHOUSE_CLOUD=1` for `scripts/build-web.mjs`. Without it the
screen has two rows, On my computer first. Connect stops at the kit: nothing is checked or saved, and the phone says
"That isn't ready yet. It arrives with the next Crewhouse update." (`mobile/src/cloud.ts`).

## What it proves

- Phone: On my computer opens the pairing screen; Just on this phone opens phone-only mode
  ([phone-only-signout.md](phone-only-signout.md)); In my cloud opens the cloud pick (boat.dev chosen, Hetzner dimmed
  with Soon, the sandbox card), Continue with boat.dev opens Connect boat.dev (three steps, Open boat.dev, a hidden
  paste box, Connect, the "stays on this phone" line). Back, and the hardware back, return one step (from pairing
  too). Continue with boat.dev stays pinned under the list at the largest text.
- Web: On my computer opens the Pair sheet ([pwa-pair.md](pwa-pair.md)); the cloud and phone rows open "Use the
  phone app to set this up" with the app's download code (the cloud company's site refuses browser calls).

## How to drive it

Web, from the repo root:

```bash
CREWHOUSE_CLOUD=1 node scripts/build-web.mjs   # or without the flag for the two-row release screen
node scripts/verify/serve-web.mjs web/dist   # prints http://crewhouse.localhost:<port>/
node scripts/verify/look-check.mjs web --out <dir> --text 1.3 where=<url>
node scripts/verify/look-check.mjs web --out <dir> --text 1.3 \
  --then "document.querySelector('.where-opt').click()" where-app=<url>
```

Phone: a release APK built with the flag on a task-owned emulator, app data cleared so it opens on the first screen:

```bash
cd mobile && EXPO_PUBLIC_CREWHOUSE_CLOUD=1 npx expo prebuild -p android && (cd android && ./gradlew assembleRelease)
adb -s $SERIAL install -r android/app/build/outputs/apk/release/app-x86_64-release.apk
adb -s $SERIAL shell pm clear dev.crewhouse.app
SERIAL=$SERIAL node look-check.mjs android --out <dir> where
SERIAL=$SERIAL node look-check.mjs android --out <dir> --then 'In my cloud' cloud-pick
SERIAL=$SERIAL node look-check.mjs android --out <dir> --then 'In my cloud>>Continue with boat.dev' cloud-key
```

## Evidence

Each screen's look check (day and night, largest text) beside its mock, the web screen at 390 and 1440, and one
recording of the tap path choice → cloud → key paste (`scripts/verify/record.mjs` or `adb shell screenrecord`).
