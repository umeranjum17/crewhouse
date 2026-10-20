# Where should I work? (first screen C) and the cloud steps

The first screen on the phone app (`GetStarted` in `mobile/App.tsx`) and on the public web shell (`Where` in
`web/src/main.tsx`): Chief asks "Hi, I'm Chief. Where should I work?" with In my cloud / On my computer / Just on
this phone, the sign-in-yourself note and "You can change this later in Settings." The words are `A.where` and
`A.CLOUD` in `web/src/adapter.ts`, one source for both. Approved mocks: `where`, `cloud-pick`, `cloud-key` in
`scripts/verify/mocks.tsv`.

The cloud row is behind a build flag (`@byokit/cloud` 0.2.1 from npm):
`EXPO_PUBLIC_CREWHOUSE_CLOUD=1` for the phone, `CREWHOUSE_CLOUD=1` for
`scripts/build-web.mjs`. Without it the screen has two rows, On my computer first. The phone runs the kit
(`web/src/cloud.ts`, shared with `test/cloud-connect.test.ts`); a web page can't call boat.dev (kit D-6).

## What it proves

- Phone, key first (mocks `cloud-key`, `cloud-pick`, `cloud-make`, `cloud-steps`, `cloud-other`): In my cloud opens
  the boat.dev key card. The box is a Paste key button: it reads the clipboard, nothing can be typed, and the key never shows. A
  refused key says "boat.dev didn't accept your key…" and nothing is kept. An accepted key lists the account's
  computers ("I didn't find a computer…" when there are none). Make a new computer shows the cost line, and its
  Create button stays off. Use this computer walks the kit's setup steps on the five-row progress list: a failure
  marks its row "!" with Chief's words and Try again; retry reruns the kit setup sequence while retaining the
completed-step display. A setup exception marks the row
  setup was on (no row before the kit's first step), with the error and Try again. Before setup the phone asks
  boat.dev for the computer's own public address on port 7300 (`url()`); the recipe runs the headless host with its
  relay published there (`CREWHOUSE_RELAY_PUBLIC`), so no Crewhouse server and no Tailscale sit in the middle. The kit
  delivers this phone's public key; `scripts/headless.mjs` hands it to crewd (`POST /api/phones/enrol`, refused to
  any phone), which enrols it as the host's owner and writes the kit's receipt. The receipt becomes the phone's link
  grant: Ready says Chief knows this phone, and Talk to Chief opens the app on that computer, where Chief answers.
  Other ways lists the setup command and SSH (both "isn't ready yet") and Tailscale (opens Pair). Back, and the
  hardware back, return one step. A kept key skips the paste on the next visit.
- Web: On my computer opens the Pair sheet ([pwa-pair.md](pwa-pair.md)); the cloud and phone rows open "Use the
  phone app to set this up" with the app's download code.

## How to drive it

Journey test (fake boat.dev plus a real headless runner on the stub engine, the provider's public port stood in by
the runner's published relay): `node --test test/cloud-connect.test.ts`. It walks key, pick, a failed install,
setup to ready, the receipt's grant reaching Chief, owner authority, a phone refused at `/api/phones/enrol`, and a
restart that keeps the binding (a second phone's key is refused).

Web, from the repo root:

```bash
CREWHOUSE_CLOUD=1 node scripts/build-web.mjs   # or without the flag for the two-row release screen
node scripts/verify/serve-web.mjs web/dist   # prints http://crewhouse.localhost:<port>/
node scripts/verify/look-check.mjs web --out <dir> --text 1.3 where=<url>
```

Phone, on the kit's fake boat.dev (no real machine, no spend): run a lab that serves
`startFakeSandboxServer` from `@byokit/cloud/testing` on a fixed loopback port, with a key of 16 or more letters and
one seeded computer. Script the install's `curl` to fail, then pass, with `server.machine.script('curl', …)`. Build
the flagged APK with `EXPO_PUBLIC_CREWHOUSE_BOAT_API=http://127.0.0.1:<port>/api/v1`, and `adb reverse` that port.
Changing an `EXPO_PUBLIC_*` value needs Metro's cache (`$TMPDIR/metro-cache`) cleared, or the bundle keeps the old
value: grep `assets/index.android.bundle` in the APK for the address before you use it.

The emulator has no shell clipboard, and the key box only reads it. So type the key into the pairing-code
field (On my computer › Type the code), then `input keycombination 113 29` (select all), `113 31` (copy) and
`keyevent 67` (clear the field). Then tap Paste key. Never dump the screen
(`phone-ui.mjs texts`) while that field holds a real key. To show Chief's computer with the key row, pair by the
typed relay code ([chief-computer.md](chief-computer.md)) without `pm clear`, which would drop the kept key.

A real boat.dev run spends money. Every Boat run, from Crewhouse or BYOKit, uses the one long-lived fleet key in
`~/firstmate/config/boat-api-key` (mode 600): never print it, never put it in a repo, log or evidence, and
never revoke it. Each run deletes the computers it made. Start
`BOAT_KEY_FILE=~/firstmate/config/boat-api-key node scripts/verify/boat-run.mjs <adb port> <serial> <out dir>`
from the repo root. All driver actions use the mode-600 Unix socket `<out>/ctrl.sock`, never a TCP port; for example:
`curl --unix-socket <out>/ctrl.sock http://x/list` (also `/make`, `/deliver`, `/ai`, `/upload`, `/model`, `/logs`, `/cost`, `/cleanup`, `/me`, `/stop`).
It keeps the key in memory, `/deliver` types it into the focused field, and `/stop` deletes its own computer (kit `remove`).
For a run before the release carries the change, build the candidate download from the branch under test
(`npm run build:web && node scripts/package.mjs <out>`), start the driver with `CANDIDATE=<out>/crewhouse-<version>-linux-x64.tar.gz`,
and build the lab APK with `EXPO_PUBLIC_CREWHOUSE_CLOUD_DOWNLOAD=file:///tmp/crewhouse-candidate.tar.gz` and, for a
computer with no AI sign-in, `EXPO_PUBLIC_CREWHOUSE_CLOUD_ENV='{"CREWHOUSE_ENGINE_BASE_URL":"http://127.0.0.1:7399/v1",...}'` (state, crew and
tools dirs under `/home/user/crewhouse`; delete `mobile/android/app/build/generated/assets/react` and Metro's cache
first, or Gradle keeps the old bundle). After `/make`, `/upload` puts the download on the driver's own computer and
`/model` starts `scripts/verify/boat-model.mjs` there, plus a unit drop-in with its `CREWHOUSE_ENGINE_API_KEY` (the
kit refuses a run env name holding KEY, TOKEN, SECRET or PASSWORD), so OpenClaw runs Chief for real on fixed words
(the app drops the stub engine's lines from the chat, so `CREWHOUSE_ENGINE=stub` never shows a reply); `/logs` reads
the service journal. Then paste, Use this computer, Talk to Chief and send a message.

**Real model (no fixed words).** Skip `/model` and the lab model env. Start the driver with `AI_KEY_FILE=~/firstmate/config/minimax-api-key`.
After Talk to Chief, send the question; with no AI account Chief waits ("Sign in on your computer"). Open Settings › Your AI
accounts › Paste your MiniMax key (shown only on the phone that set up the computer), tap the box, `curl … /ai` (types the
key, masked; check the bullets, never dump the screen), then Sign in. Chief starts the waiting question by itself. The kit's key
lane runs `MiniMax-M3`; `/logs` shows `provider=minimax … model=MiniMax-M3 status=200` in the engine events and the service in
product mode (state under `/home/user/.local/state/crewhouse`). Pair a desktop browser with the box's relay code
(`POST /api/phones/code` and `/api/phones/approve` with the `person.key`, since the download has no `web/src` for the CLI).
Only with no key file does it make the one claim (the kit's `claim()`, `BOAT_EMAIL`) and save the key there. Boat
documents a self-revoke (`POST /api/boat/oauth2/revoke`, unused here); `DELETE /api-keys/{id}` answers 403 to an agent key.

## Evidence

Each screen (day and night) beside its mock, the web screen at 390 and 1440, and one recording of Use this computer
through the progress list (`adb shell screenrecord`).

The real run adds one phone-side recording from Paste key to Chief's reply in the chat, with stills of each step and of
the reply by day and night, and the service journal from the computer (`/logs`): the owner phone enrolled, the engine
ready, and Chief's first words. Every computer the run made is deleted (`/cleanup`, then `/list` is empty).
