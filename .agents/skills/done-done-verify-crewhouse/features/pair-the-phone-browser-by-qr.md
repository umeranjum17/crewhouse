# Pair the phone's browser by the computer's QR

Part of the crewhouse verification map. Source: `docs/verification/phone-web-pair.md`.

## How to get to it (user POV)

On the computer: Settings, Phones, turn on the phone's-browser address, then Add a phone. On the phone: scan the code with the camera, check the two words, then chat with Chief.

## Driving it

1. Needs a MiniMax key file and a task-named `CHROME_DEVTOOLS_AXI_SESSION`.
2. Run `done-done run phone-web-pair` with `KEY_FILE` set (or `scripts/verify/phone-web-pair.sh <out> <key file>`).
3. Capture: `shots/phone-where-*`, `phone-pair-sheet-*`, `computer-phones-{off,on}-*`, `phone-two-words-night-390.png`, `phone-paired-home-day-390.png`, `phone-chief-reply-day-390.png`.
