# Quiet-job nudge

Part of the crewhouse verification map. Source: `docs/verification/quiet-nudge.md`.

## How to get to it (user POV)

A helper's job goes quiet for hours: Chief says so once in his thread; a day later it is stopped and marked unsure.

## Driving it

1. Needs a task-named `CHROME_DEVTOOLS_AXI_SESSION` and a built web app.
2. Run `scripts/verify/quiet-nudge.sh <out>`; it boots its own stub-engine lab and tears it down.
3. Capture: `quiet-nudge/chief-{night,day}-{390,1280}.png`; exit 0 means one nudge, no repeat, stop ended unsure.
4. Paired phone-size app: `scripts/verify/quiet-nudge-pwa.sh <out>` (pair-lab, browser at 390 paired by relay code); capture `quiet-nudge-pwa/chief-{night,day}-390.png`.
