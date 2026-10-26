# The phone's first run and typed pairing

Part of the crewhouse verification map. Source: `docs/verification/phone-pairing.md`.

## How to get to it (user POV)

A clean install opens on "Where should I work?" with Chief asking. **On my computer** opens the Pair screen
itself: the code box ("Type or paste the code"), Scan the code above it, and one link for a computer that has
none ("Crewhouse isn't on my computer yet"). Pasting the code the computer shows, pressing Pair and saying yes
to the two words on the computer lands on "You're in", then Home, where a message gets Chief's answer.

## Driving it

1. Needs an emulator (start it through the memory gate, stop it after) and a release APK built from the commit
   under proof: `mobile/android/app/build/outputs/apk/release/app-x86_64-release.apk` after
   `npx expo prebuild -p android --no-install && ./gradlew assembleRelease` in `mobile/android`.
2. Start a task-owned lab with its own relay and link port: `LAB=<lab> bash scripts/verify/pair-lab.sh up <repo>`
   (stub engine, no account). The phone reaches it over `adb reverse` for the link and relay ports, so
   nothing touches the owner's instance.
3. `LAB=<lab> node scripts/verify/phone-pair-typed.mjs --serial <emulator> --apk <apk>`: installs, clears the
   app, taps **On my computer** on the first screen (which now opens the code box; an older build stops on
   Put Chief and needs **Type the code**), types the relay code, taps Pair and answers yes over the API. It
   exits 0 once the app is on Home. `phone-pair-timed.mjs --cps <n>` does the same at a person's typing pace
   and times typing, the two words and the computer's yes; `phone-pair.mjs` proves the camera path instead.
4. Capture: the journey's own frames, plus the changed screen at 390 wide in day and night for a UI change
   (`look-check` covers the largest text at 360).

## Pitfalls

- The 12-letter same-Wi-Fi code needs mDNS, which an emulator cannot do (its NAT rewrites the query's source
  port), so an emulator run types the relay code instead and `adb reverse` must work; on a real phone the
  12-letter path is `phone-pair-timed.mjs` with the test phone's own records.
- `pm clear` drops POST_NOTIFICATIONS, so grant it again or the prompt covers the app.
- The pair screen's and Put Chief's back rows both read "On my computer", so a driver that taps by that label
  without checking for the code box first can walk backwards.
