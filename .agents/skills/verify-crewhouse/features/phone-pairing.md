# Phone pairing, on the real app

The Android app (`mobile/`) has its own surface and its own build, so the loopback crewd run above
proves nothing about it. This feature is the native proof of pairing: the phone's **camera** reads the
code the computer is showing, the person says yes on the computer, and the phone lands on
"You're in" with the crew on it. Nothing is typed by hand.

`scripts/phone-pair.mjs` drives the whole journey and writes the evidence:

```bash
REPO=$PWD                                  # the script renders the code with this repo's @byokit/ui-core
CREWHOUSE_REPO=$REPO node .agents/skills/verify-crewhouse/scripts/phone-pair.mjs \
  --out "$EV/phone" --serial emulator-5562 --base http://127.0.0.1:$PORT \
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

**A pairing failure is part of the proof.** Point the camera at something that is not a Crewhouse code
(`node -e "…qrMatrix('hello')…" > not-a-code.png`, or any QR), and at a code that has run out
(`CREWHOUSE_PAIR_MS=1` on the crewd side, or wait two minutes), and keep the screenshot of what the
phone says. Each failure must be one plain sentence that says what to do next, never an error code.