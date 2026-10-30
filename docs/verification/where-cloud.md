# Where should I work? (first screen C) and the cloud steps

The first screen on the phone app (`GetStarted` in `mobile/App.tsx`) and on the public web shell (`Where` in
`web/src/main.tsx`): Chief asks "Hi, I'm Chief. Where should I work?" with two doors, My computer and Cloud (the quiet "Just chat from this phone, no setup" line sits inside My computer),
the sign-in-yourself note and "You can change this later in Settings." The words are `A.where` and
`A.CLOUD` in `web/src/adapter.ts`, one source for both. Approved mocks: `where`, `cloud-pick`, `cloud-key` in
`scripts/verify/mocks.tsv`.

Cloud first is the release default (`@byokit/cloud` 0.6.1 from npm). Build without any cloud-enable variable:
phone and web both show both doors, My computer then Cloud. An explicit
`EXPO_PUBLIC_CREWHOUSE_CLOUD=0` (phone) or `CREWHOUSE_CLOUD=0` (web) opts out for a deployment. The phone runs the kit
(`web/src/cloud.ts`, shared with `test/cloud-connect.test.ts`); a web page can't call boat.dev (kit D-6).

## What it proves

- Phone, code sign-in first: Cloud opens "Sign in to boat.dev". The person types their boat.dev email (sent to boat.dev
  alone, as the kit's `claim` login hint), the card shows boat.dev's link (Open boat.dev to sign in) and the code to type on
  boat.dev's own page, then waits and carries on by itself with the account's computers listed. The key boat.dev issues goes
  into the kit's store and nowhere else (`signIn` in `web/src/cloud.ts`; `test/cloud-signin.test.ts`). Each way it can end is
  named: refused ("boat.dev didn't accept that address…"), expired ("That sign-in expired…"), unreachable, provider, and the
  app's own wait running out (10 minutes, said without a number), each with Try again. The sign-in is kept by the phone
  (`mobile/src/cloud.ts`), so leaving the Cloud screen and coming back finds the same code still waiting, or the failure.
  A key the store will not keep is ended at boat.dev at once. The key paste below is under Other ways (advanced) › Paste a
  boat.dev key, and works as before.
- Phone, key paste (mocks `cloud-key`, `cloud-pick`, `cloud-make`, `cloud-steps`, `cloud-other`): Paste a boat.dev key opens
  the boat.dev key card. The box is a Paste key button: it reads the clipboard, nothing can be typed, and the key never shows. A
  refused key says "boat.dev didn't accept your key…" and nothing is kept. An accepted key lists the account's
  computers ("I didn't find a computer…" when there are none). Make a new computer shows the cost line, and Make it
  and set it up rents a small computer in the person's own account (`make()`, the kit's `create`; one rental per
  press) and sets it up like a picked one. Use this computer walks the kit's setup steps on the five-row progress
  list: a failure marks its row "!" and says which step stopped, then the kit's cause ("Installing Chief stopped
  partway. boat.dev reports a problem…"); when it is retryable, "Trying again is safe…" and Try again follow, and
  retry reruns the kit setup sequence while retaining the completed-step display. Once set up, the title reads
  "Your cloud computer", with no lede under it. A second phone on a computer another phone set up gets the kit's words ("…You can move it
  to this phone instead. The other phone then loses access.") with Move Chief to this phone and Back. The move asks
  first ("The phone that set up this computer loses access to Chief at once…"), then Yes, move Chief reruns setup
  with the kit's `replaceOwner`: the kit delivers the new key as its owner file, `scripts/headless.mjs` hands it to
  crewd as a replacement (`POST /api/phones/enrol {replace: true}`, kit `replacePhoneKey`), the old phone's grant is
  revoked and the new phone reaches Chief. The recipe's one root step installs Xvfb, so Chief's own screen has a
  display there. A setup exception marks the row
  setup was on (no row before the kit's first step), with the error and Try again. Before setup the phone asks
  boat.dev for the computer's own public address on port 7300 (`url()`); the recipe runs the headless host with its
  relay published there (`CREWHOUSE_RELAY_PUBLIC`), so no Crewhouse server and no Tailscale sit in the middle. The kit
  delivers this phone's public key; `scripts/headless.mjs` hands it to crewd (`POST /api/phones/enrol`, refused to
  any phone), which enrols it as the host's owner and writes the kit's receipt. The receipt becomes the phone's link
  grant: Ready says Chief knows this phone, and Talk to Chief opens the app on that computer, where Chief answers.
  Other ways (advanced) lists the paste of a key, the setup command and SSH (both "isn't ready yet") and Tailscale (opens Pair). Back, and the
  hardware back, return one step. A kept key skips the sign-in on the next visit.
- The setup is repeatable, not a once-per-phone thing. Try again on the same computer sets it up again: the
  install runs again over the computer that already has Chief (the download unpacks read-only files, so the
  recipe makes the old tree writable and clears it first, and the kit's own folder with this phone's key stays),
  the phone pairs again, and the card reaches "Chief is on your cloud computer." Picking another computer in the
  same account replaces the one the phone had (the computer itself stays in the person's boat.dev account), and
  the phone's computer is the one the person picked.
- The app's own refusals are named, not one generic line: a computer that is gone from the account ("That
  computer is not in your boat.dev account any more. Pick another one."), a computer boat.dev gave no public
  address, and a setup already running on this phone.
- My computer opens the how-to-run card on phone and web (`A.PUT`: the one line, Copy that says copied or could not copy, What happens, no time claim until one is measured); Type the code goes on to the Pair screen and Back returns to the card.
- Web: The card's Type the code opens the Pair sheet ([pwa-pair.md](pwa-pair.md)); the cloud and phone rows open "Use the
  phone app to set this up" with the app's download code.

## How to drive it

Journey test (fake boat.dev plus a real headless runner on the stub engine, the provider's public port stood in by
the runner's published relay): `node --test test/cloud-connect.test.ts`. It walks key, pick, a failed install,
setup to ready, the receipt's grant reaching Chief, owner authority, a phone refused at `/api/phones/enrol`, and a
restart that keeps the binding (a second phone's key is refused). It also walks the retry: the same computer set
up a second time (the install runs again, the phone pairs again, the card reaches ready), another computer in the
same account replacing the one the phone had, and the app's own refusals (a computer that is gone, a setup already
running).

The install on a real disk, with the download the person really gets (read-only files, so unpacking it over an
earlier install failed with "File exists"): `node --test test/cloud-install.test.ts`. It runs the recipe's own
install steps twice in one work directory and reads the tree back; the kit's own folder survives the second run.

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

The retry (the phone's own Try again) needs the fake's computer to have a real host behind it, or the pairing step
waits for a receipt that never comes: run the repo's own headless host (`scripts/headless.mjs`) with
`CREWHOUSE_CLOUD_DIR` set, and bridge the fake's inbox to the host's inbox and the host's receipt back to the fake's
outbox (the journey test does the same). Script the install's `curl` to fail, tap Use this computer, then let the
`curl` pass and tap Try again: the card reaches "Chief is on your cloud computer." with Talk to Chief.

The emulator has no shell clipboard, and the key box only reads it. So type the key into the pairing-code
field (On my computer › the code box), then `input keycombination 113 29` (select all), `113 31` (copy) and
`keyevent 67` (clear the field). Then tap Paste key. Never dump the screen
(`phone-ui.mjs texts`) while that field holds a real key. To show Chief's computer with the key row, pair by the
typed relay code ([chief-computer.md](chief-computer.md)) without `pm clear`, which would drop the kept key.

A real boat.dev run spends money. Every Boat run, from Crewhouse or BYOKit, uses the one long-lived fleet key in
`~/firstmate/config/boat-api-key` (mode 600): never print it, never put it in a repo, log or evidence, and
never revoke it. Each run deletes the computers it made. Start
`BOAT_KEY_FILE=~/firstmate/config/boat-api-key node scripts/verify/boat-run.mjs <adb port> <serial> <out dir>`
from the repo root. All driver actions use the mode-600 Unix socket `<out>/ctrl.sock`, never a TCP port; for example:
`curl --unix-socket <out>/ctrl.sock http://x/list` (also `/make`, `/deliver`, `/ai`, `/upload`, `/model`, `/logs`, `/thread`, `/cost`, `/cleanup`, `/me`, `/stop`).
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
lane runs `MiniMax-M3.1-Flash` until the sheet's model pick (MiniMax M3, say) takes the next run; `/thread` shows Chief's
thread from crew.db and `provider=minimax … status=200` from the engine's own log (`~/.local/state/crewhouse/logs/openclaw.log`,
not the journal). Ask Chief to look at his own screen: the engine transcript shows `computer {"action":"screenshot"}` and
its image. The driver types a key three letters at a time (a controlled field drops faster injected text). Pair a desktop browser with the box's relay code
(`POST /api/phones/code` and `/api/phones/approve` with the `person.key`, since the download has no `web/src` for the CLI).
Only with no key file does it make the one claim (the kit's `claim()`, `BOAT_EMAIL`) and save the key there. Boat
documents a self-revoke (`POST /api/boat/oauth2/revoke`, unused here); `DELETE /api-keys/{id}` answers 403 to an agent key.

The cloud screen's states on an emulator, at 390 wide by day and night (Make, a failed install, ready after Try
again, a second phone): build a lab APK with **no cloud-enable variable** (only
`EXPO_PUBLIC_CREWHOUSE_BOAT_API=http://127.0.0.1:7411/api/v1`), start an emulator, then
`SERIAL=<serial> bash scripts/verify/cloud-screen.sh <out> <apk>`. It runs `boat-fake-lab.mjs` with `LAB_EMPTY=1`
(an account with no computer), writes `cloud-{make,failed,ready,second-phone,move-confirm,moved}-{day,night}-390.png` (with `CLOUD_OTHER` set, every one but the claimed state goes there: `CLOUD_CLAIM`, default the second phone's offer) and the
`cloud-screen` step record, and stops the lab.

## Evidence

Each screen (day and night) beside its mock, the web screen at 390 and 1440, and one recording of Use this computer
through the progress list (`adb shell screenrecord`).

The retry adds one recording of the failed install through Try again to "Chief is on your cloud computer.", with a
still of each step: the row that failed with its "!", and the card after the retry.

The real run adds one phone-side recording from Paste key to Chief's reply in the chat, with stills of each step and of
the reply by day and night, and the service journal from the computer (`/logs`): the owner phone enrolled, the engine
ready, and Chief's first words. Every computer the run made is deleted (`/cleanup`, then `/list` is empty).
