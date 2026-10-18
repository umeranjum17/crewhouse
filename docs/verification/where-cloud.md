# Where should I work? (first screen C) and the cloud steps

The first screen on the phone app (`GetStarted` in `mobile/App.tsx`) and on the public web shell (`Where` in
`web/src/main.tsx`): Chief asks "Hi, I'm Chief. Where should I work?" with In my cloud / On my computer / Just on
this phone, the sign-in-yourself note and "You can change this later in Settings." The words are `A.where` and
`A.CLOUD` in `web/src/adapter.ts`, one source for both. Approved mocks: `where`, `cloud-pick`, `cloud-key` in
`scripts/verify/mocks.tsv`.

The cloud row is behind a build flag until BYOKit's cloud kit (`@byokit/cloud`) is on npm (the branch builds against a
tarball packed from BYOKit main): `EXPO_PUBLIC_CREWHOUSE_CLOUD=1` for the phone, `CREWHOUSE_CLOUD=1` for
`scripts/build-web.mjs`. Without it the screen has two rows, On my computer first. The phone runs the kit
(`web/src/cloud.ts`, shared with `test/cloud-connect.test.ts`); a web page can't call boat.dev (kit D-6).

## What it proves

- Phone, key first (mocks `cloud-key`, `cloud-pick`, `cloud-make`, `cloud-steps`, `cloud-other`): In my cloud opens
  the boat.dev key card. The box is paste-only: typed letters are never sent, and the box never shows the key. A
  refused key says "boat.dev didn't accept your key…" and nothing is kept. An accepted key lists the account's
  computers ("I didn't find a computer…" when there are none). Make a new computer shows the cost line, and its
  Create button stays off. Use this computer walks the kit's setup steps on the five-row progress list: a failure
  marks its row "!" with Chief's words and Try again, and Try again resumes there. Ready says Chief knows this phone.
  Other ways lists the setup command and SSH (both "isn't ready yet") and Tailscale (opens Pair). Back, and the
  hardware back, return one step. A kept key skips the paste on the next visit.
- Web: On my computer opens the Pair sheet ([pwa-pair.md](pwa-pair.md)); the cloud and phone rows open "Use the
  phone app to set this up" with the app's download code.

## How to drive it

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

The emulator has no shell clipboard, and the key box takes only a paste. So type the key into the pairing-code
field (On my computer › Type a code), then `input keycombination 113 29` (select all), `113 31` (copy) and
`keyevent 67` (clear the field). Then paste it into the key box with `113 50`. Never dump the screen
(`phone-ui.mjs texts`) while that field holds a real key. To show Chief's computer with the key row, pair by the
typed relay code ([chief-computer.md](chief-computer.md)) without `pm clear`, which would drop the kept key.

A real boat.dev run spends money and needs the person's sign-in: the kit's `claim()` (a code someone approves at
boat.dev). It needs a lab driver that keeps the key in memory and deletes any computer it made (kit `remove`).
Boat refuses a key revoking itself (403: it needs a dashboard session), so the person revokes it at boat.dev.
Confirm the revoke with a 401 on `GET /me`.

## Evidence

Each screen (day and night) beside its mock, the web screen at 390 and 1440, and one recording of Use this computer
through the progress list (`adb shell screenrecord`).
