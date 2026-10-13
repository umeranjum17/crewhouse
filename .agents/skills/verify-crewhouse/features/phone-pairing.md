# Phone pairing, on the real app

The Android app (`mobile/`) has its own surface and its own build, so the loopback crewd run above
proves nothing about it. This feature is the native proof of pairing: the phone's **camera** reads the
code the computer is showing, the person says yes on the computer, and the phone lands on
"You're in" with the crew on it. Nothing is typed by hand.

`scripts/phone-pair.mjs` drives the whole journey and writes the evidence:

(Drift, seen 2026-10-13 on v1.0.0-preview.20261012.18: the app now opens on a chooser, "Use this phone only" or
"Pair with a computer", and the script still expects the Pair screen first. Its default `TAP_SCAN` (540,1598)
misses. Tap "Pair with a computer" first with `phone-ui.mjs`, or pair by typing the computer's code.)

```bash
REPO=$PWD                                  # the script renders the code with this repo's @byokit/ui-core
CREWHOUSE_REPO=$REPO node .agents/skills/verify-crewhouse/scripts/phone-pair.mjs \
  --out "$EV/phone" --state "$LAB/state" --serial emulator-5562 --base http://127.0.0.1:$PORT \
  --camera-file /path/to/live-qr.png --apk /path/to/app.apk --runs 3 --record
```

Outputs, all outside the repo: `run<n>-1-pair.png` (the phone's own "Scan the code"),
`run<n>-2-words.png` (the two words, while the computer's card asks for the same two),
`run<n>-3-yourein.png`, `run<n>-4-open.png` (the crew on the phone), `run<n>-pairing.mp4` with
`--record`, `offer-<n>.json` (the live code the camera read) and `timings.json`.

**The emulator's camera.** Boot the emulator with
`-no-window -gpu swiftshader_indirect -camera-back imagefile:<absolute path>`, through
`fm-mem-gate.sh`, on a port and an `ANDROID_USER_HOME` of this task's own. The `imagefile` camera
renders that file stretched into its 1280x960 frame, so the code is drawn pre-squashed (module 8x4)
inside the window the preview keeps. The virtual-scene camera (`virtualscene`) is not a substitute:
headless it renders black, and a scan that never fires proves nothing. The script rewrites the same
file before the phone opens the camera, which is when the camera reads it, so one emulator serves every
run and every run gets its own live code.

**What "it worked" means, and what it does not.** `secondsToPaired` is measured from the tap on
"Scan the code" to the computer listing the phone, so it covers camera start, the read, the words and
the confirmation. The camera is fed the exact code the computer offered (`offer-<n>.json` and the code
the phone pairs with are the same), so the pairing is real; what the emulator cannot show is a person
holding a phone up to a monitor. Say that in the report.

**The computer's half is a browser, not a phone.** Settings, Phones, "Add a phone" mints the code and
the same card shows the phone's two words with "Yes, the words match". Drive that card in the browser
(`screens.sh`-style captures at 1440 and 390, `?night` and `?day`) when the change touches pairing, and
note that the card's own request is what the script sends when it confirms.

**The post-sign-in offer (cut 10).** While no phone is paired, Chief's chat shows "Add your phone" with
the same code card in place right after sign-in, plus "Not now" to put it away; a paired phone ends it
for good. Drive it with `?demo=nophone` (no paired phones, signed-in accounts): the prompt mints its
code through `POST /api/phones/pair` like Settings does. Capture the prompt at 1440 and 390, `?night`
and `?day`, and prove Settings still mints its own code on the same build.

**A pairing failure is part of the proof.** Point the camera at something that is not a Crewhouse code
(`node -e "…qrMatrix('hello')…" > not-a-code.png`, or any QR), and at a code that has run out
(`CREWHOUSE_PAIR_MS=1` on the crewd side, or wait two minutes), and keep the screenshot of what the
phone says. Each failure must be one plain sentence that says what to do next, never an error code.

**The typed code.** Under the code, every card (Settings › Phones, "Add your phone", Chief's phone offer)
shows the kit's 12-letter code (`Host.code`, `XXXX-XXXX-XXXX`; case, spaces and dashes optional).
The phone's "Type a code" box takes it and finds the computer by its `_crewhouse._tcp` mDNS
announcement, so nothing else is typed. The code is single use, lives two minutes, and the computer proves it
before the phone sends who it is. `scripts/phone-pair-timed.mjs` types it one keystroke at a time at
`--cps` (default 2, a person's pace). It times typing, the two words and the computer's yes, and never
clears or reinstalls the app, so it runs on the test phone through `fm-device-lock.sh` from phone-only
mode or the chooser. The emulator can't do mDNS, so use the real phone. If the host firewall drops LAN
connections (`ufw` here drops even ssh), route the hop over USB rather than touching the firewall. Run
`adb -s <serial> reverse tcp:$LPORT tcp:$LPORT`, then publish a lab-only record while the run lasts:
`avahi-publish -s crewhouse-lab _crewhouse._tcp $LPORT "url=ws://127.0.0.1:$LPORT/link"`. The phone's
discovery and handshake are still the real ones; say in the report that the hop went over USB.
Measured 13 Oct on the test phone (discover 0.8.1, which keeps Android's `<host>._crewhouse._tcp` name): 12 letters
typed in 6.8 s, the two words 8.3 s after Pair, paired 18.6 s after the first key. Before 0.8.1 every Android run
ended on "Couldn't find your computer on this Wi-Fi…" about 3 s after Pair.
Failure proof: a wrong code ("doesn't match"), and the phone off the computer's Wi-Fi ("Couldn't find
your computer on this Wi-Fi…").

## The computer is gone: the out-of-touch screen is never a dead end

A phone paired to a computer that no longer answers (stopped, deleted, asleep with nothing kept)
opens on "Can't reach the home computer", in plain words with no setup jargon, while the link
keeps retrying by itself. The screen keeps three ways out, all reusing existing flows:

- **Pair again** opens the same scan/type flow (`Pair` in `mobile/App.tsx`), with a Back way out.
  The kept grant is replaced only when the new pairing succeeds; backing out keeps retrying the old one.
- **Try again** retries the link once (`link.retry()`), beside the automatic retry.
- **Just on this phone** enters the existing phone-only mode without touching the grant; leaving
  phone-only returns to the paired app, still retrying.

Prove it on the test phone through one `fm-device-lock.sh` call for both baseline and candidate:
pair to a lab crewd by the typed code (`phone-pair-timed.mjs`), then stop and delete that lab.
Keep the phone's current font, density and theme; install without `-g`, never grant permissions,
and deny any permission dialog. Capture the baseline dead end and candidate ways out, tap
"Pair again", then "Type a code" to reach the code box, and tap Back to the retry screen.
Run the largest-text, day/night Android `look-check.mjs` only on an owned emulator, never the
test phone: it changes density, font scale and theme. The retry screen scrolls on short screens. The same rule on the web twin
(`Unreachable` in `web/src/flows.tsx`): a paired app whose computer is gone keeps "Pair again"
to the code sheet beside "Try now".
