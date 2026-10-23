# An image both ways in Chief's chat

Part of the crewhouse verification map. Source: `docs/verification/image.md`.

## How to get to it (user POV)

In Chief's chat the person taps + (the paperclip on a computer), picks a photo, sees it in the box with its thumbnail,
types a few words and sends. The thread shows the photo with their words; Chief hands the job to a helper, and the
helper's finished picture comes back on Chief's reply, shown whole.

## Driving it

1. Needs a task-named `CHROME_DEVTOOLS_AXI_SESSION`, a built web app (`npm run build:web`), ImageMagick, chromium,
   xvfb-run and bwrap.
2. Run `bash scripts/verify/image.sh <repo> <out>` (its own stub-engine lab with Video Vic hired; the photo is staged on
   the composer's file input, the hand-off and Vic's picture ride the stub's call words, which the app never shows).
3. Capture: `screens/image-{attach,picked,sent,thread}-*`, `pwa/image-{picked,sent,thread}-installed-*`,
   `look/image-thread-*`; the step record `steps.json`.
4. It proves: the thumbnail and the words in the box with + and Send on screen at 390, the photo kept under crewd's name
   and given to Chief's model, Vic's picture on Chief's reply, the person's photo never repeated as a result.
