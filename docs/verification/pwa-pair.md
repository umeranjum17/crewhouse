# PWA pair

The public shell's way out of the demo (`web/src/link.ts`, `PairSheet` in `web/src/flows.tsx`). The demo's Home and
Settings show "Pair — yes, let's go", which opens a card with the desktop commands and one paste box. The box takes the
relay code (`SHORT-CODE@relay`) or the computer's 12-letter code, told apart by shape (`web/src/typed.ts` `readTyped`, which the
phone uses too). `@byokit/pair` pairs the browser and shows the two words while the person says yes at the computer.
The grant is sealed in IndexedDB (`browserDeviceStore('crewhouse.grant')`), and the same installed app reloads on real
data: every call, live event and desktop stream rides the link (`web/src/api.ts` `setLink`). Unpair forgets the grant,
clears the icon badge and goes back to "Where should I work?".

## What it proves

- With no grant, the public shell opens "Where should I work?", whose On my computer row is the Pair sheet (see [where-cloud.md](where-cloud.md)); `?demo` boots the demo with the Pair row (see [pwa-demo-boot.md](pwa-demo-boot.md)). With a
  grant, it boots paired and never shows the demo.
- A relay code and the 12-letter code both pair. The page's two words equal crewd's `phones pending`.
- Once paired, the app shows crewd's own state. A change (a message to Chief, the first-run name) lands in crewd over
  the link. Settings reads "Paired with <computer name>" and hides Phones, which stay the computer's to manage.
- Paired notifications are first-class: the paired card in Settings carries the notifications on/off switch, the
  mailbox's public Web Push key is asked over the link (`POST /api/push {key}`, never `/api/phones/link`, which crewd
  refuses), `{off: true, web}` removes the calling device's own address at the mailbox, a computer with no mailbox is
  said in plain words with no dead toggle, and no Getting-set-up item whose call the link refuses is left — Home's
  setup nudge waits for the computer too.
- Unpair: crewd's device list drops the browser, and the app goes back to "Where should I work?" with no reinstall.
- The link's trust rules hold: crewd still refuses admin writes over the link (`src/link.ts`).

## How to drive it

`test/pwa-pair.test.ts` runs the whole journey headless: relay code, two words, yes, real data, onboarding as Maya,
reload, Unpair, the 12-letter code. For the installed app, start the lab: a stub crewd with an isolated HOME and every XDG dir,
the repo's relay, and the built shell on `http://crewhouse.localhost:<port>/`. Then run the plan under a real X server
so Chromium installs the app for real:

```bash
node scripts/build-web.mjs
S=scripts/verify; export LAB=~/.cache/fm-scratch/<task>/lab EV=<evidence dir>
trap '$S/pair-lab.sh down' EXIT
$S/pair-lab.sh up . > "$EV/lab.log" 2>&1  # writes $LAB/env
mkdir -p "$EV/shots" "$EV/motion"; node $S/pair-plan.mjs "$LAB" "$EV" > "$LAB/plan.json"
timeout -k 10 600 xvfb-run -a -s "-screen 0 1920x1200x24" node $S/pwa-shell.mjs "$LAB/plan.json" > "$EV/run.json"
$S/pair-lab.sh down
```

`pair-lab.sh cli phones code | pending | approve <words>` is the computer's own CLI against the lab. `phones code`
prints the 12-letter code, then "Away from this computer, paste this one instead:" and the relay code.

A real paired delivery needs a browser whose push service the kit's relay allows: **google-chrome-stable** subscribes
at `fcm.googleapis.com`; the distro `chromium` hands out the staging endpoint `jmt17.google.com`, which the relay's
push-host allowlist refuses ("bad subscription") — a lab-only artifact, since production browsers use the allowed
hosts. Drive it from the paired, installed app: `Browser.grantPermissions ['notifications']` (pwa-shell's `grant`
step), click `.notify-on`, confirm the subscription endpoint at `pushManager.getSubscription()` and the record under
the device's grant id in `<lab>/relay/relay.json`, then post a message to Chief through crewd's own API and read
`getNotifications()` for "Crewhouse has news". Toggle off (`.notify-off`), send again, and confirm nothing arrives.

## Read it

`run.json` lists every step. Expect no `error`, `standalone: true`, `rec-real` and `paired` as `real`, `rec-back` as
`demo`, and two words for `words-day` and `words-night`. Shots: `demo-pair-button-`, `pair-card-`, `two-words-`,
`paired-real-` and `paired-settings-{day,night}-{390,1440}.png`, plus `install-sheet.png` and `installed-window.png`.
The recording is `motion/demo-pair-real-unpair.webm`.

## Limits

- The 12-letter code dials only the page's own origin (`wss://<host>/link` on an https page). So the typed code
  works only when the page is the computer's own link (`./crewhouse phones web`, [ipad-tailscale.md](ipad-tailscale.md)); off it, the
  relay code over an https relay is the way in. This lab's shell is a separate `*.localhost` origin, so its own-origin
  try fails and the plan pastes the relay code; `test/pwa-pair.test.ts` loads the shell from crewd's link port for the
  12-letter code.
- A relay-code pairing bakes only the relay address into the grant, so with the relay off that app is stranded
  offline until it unpairs.
