# Onboarding timing

How long a person really takes from installing the phone app to Chief's first useful answer, one recipe per run:
phone only, phone plus their own computer, phone plus a rented cloud computer. `scripts/verify/onboard-timing.sh` is the
repeatable harness (`onboard-timing.mjs` drives the phone); the numbers it produced are in
`data/ch-onboard-s5-timing-proof/timings.md` of the Juggernaut home, never estimated.

## What it records

For each run: the wall-clock time from install start to the first useful answer, every step with its timestamp, the
slowest step, and every wait above 30 seconds with the step it was spent in. Steps the harness itself performs for the
person (typing a key a person would paste, typing the code, typing the question) are marked `harness`; they count in the
wall clock and are totalled apart (`harnessSeconds`), and never count as the slowest step.

The host's one-minute load is recorded at start and end (`hostLoad`): a loaded host slows every wait, so the numbers are an upper bound. When the app says "Your computer is slow to answer" the harness presses Pair again, as a person would, and records the retry.

A "useful answer" is a model reply to the question the harness sent. Chief's "sign in when you're ready" and his fixed
name greeting are not answers. A run that never reaches one records no total (`totalSeconds: null`, the failure named).

## How to drive it

Install the pinned kits first (`npm ci` at the root and in `mobile/`; a stale `node_modules` timed a different app). A fresh emulator (wiped, at least 6 GB: a 4 GB one has the system kill the UI dump mid-run), the release APK built from
the head (`cd mobile && npx expo prebuild -p android --clean --no-install && cd android && ./gradlew assembleRelease
-PreactNativeArchitectures=x86_64`) and a MiniMax key file (`~/firstmate/config/minimax-api-key`, never printed):

```bash
SERIAL=emulator-5690 bash scripts/verify/onboard-timing.sh phone    <out> <apk>
SERIAL=emulator-5690 bash scripts/verify/onboard-timing.sh computer <out> <apk>   # starts a real crewd in a scratch HOME, times that too
```

The computer recipe writes `host-computer.json`: seconds until crewd and its freshly installed engine were ready, and
until the AI account was signed in (before the phone's clock starts). The phone pairs by the relay code, because an
emulator cannot hear the Wi-Fi announcement the 12-letter code needs.

The cloud recipe rents a real machine, so it is run by hand, once: start `scripts/verify/boat-run.mjs`
([where-cloud.md](where-cloud.md)) and `node scripts/verify/onboard-timing.mjs --recipe cloud --serial <emulator> --apk <apk>
--out <dir> --boat-sock <out>/ctrl.sock`. The key reaches the phone only through the driver. The sign-in by emailed code needs a
person at boat.dev, so the run pastes the fleet key (the key box reads the clipboard; the harness stages it through the
sign-in's email box). The rented computer has no AI account: Chief says so and keeps the question waiting, and the run signs
in with the MiniMax key in Settings, after which he answers. `--tail signin|ask` times that part, or a first question, on
its own clock on a computer that is already up. The machine the phone rents is not the driver's: delete it afterwards
(the driver's `/cleanup` only removes one it made itself) and read its cost from the provider.

## What it cannot show

The install is `adb install` of a local file (seconds), not a store download. The one-line command on the person's own
computer (download, unpack, engine install) is not in the phone's clock; `host-computer.json` covers the engine part only.
A person types and reads at their own pace.
