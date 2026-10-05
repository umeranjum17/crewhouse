# J7 — pairing a phone to the computer by camera, on the real app

Everything below was produced on the real product through `.agents/skills/verify-crewhouse`
(`features/phone-pairing.md`, `scripts/phone-pair.mjs`): the phone app built from this branch's
`mobile/` as a release APK, an isolated crewd on the stub engine, and a task-owned emulator whose
camera reads the code. Media is not committed; the files live beside this README in the evidence
folder named in the PR.

## What was paired, and what was not

**Paired, for real, by camera.** `CREWHOUSE-APK-ch-pm-19.apk` (sha256 `ad25f968565bb6cf7b17dd71ec9f08b9b867c6b5a28354f271d91e9baf3d38c9`,
`assembleRelease` from this worktree at the branch head) on emulator `emulator-5562` (task AVD `fm-ch-pm-19`,
`-no-window -gpu swiftshader_indirect`), against an isolated crewd (`CREWHOUSE_ENGINE=stub`,
throwaway HOME/XDG/state/crew, person **Umer**, `CREWHOUSE_LINK_PORT=7812` because 7712 was held by
another lane). No code was typed on either side: the phone read the QR the computer's own card was
showing, the person confirmed on the computer, and the phone landed on "You're in".

The emulator's camera is fed the pairing QR through `-camera-back imagefile:` (the virtual-scene
camera renders black headless, which is what made QR pairing look broken before). For the recording
the image is **the computer's own card, decoded from that card's pixels**: `zbarimg` read the offer
text out of a screenshot of the live card, and that exact text is what the camera read.

**Not proven here.** The model is the scripted stub, so nothing on screen depends on real model words.
No sign-in, no push credential (the phone says so in plain words after pairing). No real handset: an
emulator camera is fed an image, so this proves the scan, the confirmation and the paired result, not
a person holding a phone up to a monitor.

## The pairing itself

`candidate/timings.json`, two cold pairings on the branch-head APK, after `final/timings.json`'s three
on the build before a type-only fix (same runtime code). App data is cleared before each run and the
camera starts cold:

| run | two words | code read | paired |
|---|---|---|---|
| 1 | grape creek | 9.1 s | 12.1 s |
| 2 | whistle hill | 7.3 s | 8.1 s |

and on the previous build of the same code:

| run | two words | code read | paired |
|---|---|---|---|
| 1 | cedar chess | 9.1 s | 12.1 s |
| 2 | ember moss | 7.1 s | 8.0 s |
| 3 | needle lagoon | 7.1 s | 9.1 s |

Every run paired. The 7–9 s before the code is read is the emulator's software camera: the preview is
up in 0.4 s (measured, screencaps every 300 ms) and the read follows 7–9 s later, because CameraX on
this emulator retries its camera list ("the device might underreport the amount of the cameras" in
logcat) before the analyser runs. Crewhouse's own share — code read, two words matched, grant stored,
"You're in" — is 0.9–3.0 s. Earlier runs on the same emulator measured the same shape (8.1 / 10.1 /
8.5 / 12.2 / 7.9 / 8.6 s paired). **The "under 10 s, three times in a row" bar is therefore met by the
product's own work but not by the cold camera on a software-rendered emulator**: two of the six cold
runs came in under 10 s end to end, the other four at 10.1–12.2 s. Say this to the captain rather
than quoting the fast pair.

## Motion

- `hero/pairing-web-and-phone.mp4` — the clip to watch: the computer's pairing card on the left, the
  phone reading it on the right, through "Check the words" to "You're in". 12 s, real pixels on both
  sides (`hero/web-card.webm` is the Chrome screencast, `hero/run1-pairing.mp4` the phone's own
  screenrecord, composed with ffmpeg).
- `hero/run1-pairing.mp4` — the phone alone, same run.

## Screens

The phone app has one theme (`userInterfaceStyle: light`), so the four design-bar captures are the
computer half of the pairing, the card a person reads while the phone scans (light and dark, 1440 and
390):

- `screens/pair-card-night-1440.png`, `-night-390.png`, `-day-1440.png`, `-day-390.png`

The phone's own screens, from the final APK, light (its only theme):

- `final/run1-1-pair.png` — "Scan the code"
- `final/run1-2-words.png` — "Check the words"
- `final/run1-3-yourein.png` — "You're in"
- `final/run1-4-open.png` — the crew on the phone, after "Open Crewhouse"
- `final/run2-*`, `final/run3-*` — the same four steps in runs 2 and 3

## A mistake at each step, in plain words

Every capture is the real app on the emulator after the same mistake.

| what the person did | what the phone said | file |
|---|---|---|
| scanned a QR that is not a Crewhouse code | "That's not a Crewhouse code. Point the camera at the code on your computer, then try again." | `candidate/wrong-code.png`, `final/wrong-code.png` |
| the computer said no at the confirmation | "Your computer said no to this device." | `final/declined.png` |
| scanned a code that had run out | "That code has run out. Show a new one on your computer, then try again." | before the change, same wording, `before-wrongqr.png` is the "before" of the first row |

`before-wrongqr.png` is the same wrong-code scan on the release APK this branch starts from
(`1.0.0-preview.20261001.16`): it said "That didn't go through. Check the code, then try again.", which
does not say what went wrong. That sentence is the before/after of this change.

## Skipped, and why

- **The phone in dark mode.** The app ships one theme; there is no dark pairing screen to capture.
- **The camera permission refused.** The one sentence for it ("Crewhouse needs the camera to read the
  code." plus "Open phone settings") was not re-shot on the emulator; the permission was granted in
  every run above. The change that touched it (that button no longer appears for other pairing
  failures) is visible in the wrong-code row.
- **Real model words, a real sign-in, a real push notification.** The stub engine and no credentials,
  as the skill requires; pairing does not depend on any of them.