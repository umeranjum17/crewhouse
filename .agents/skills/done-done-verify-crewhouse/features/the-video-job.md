# The video job

Part of the crewhouse verification map. Source: `docs/verification/video-job.md`.

## How to get to it (user POV)

The person pastes a video link in Chief's chat. A card in Chief's chat lists the qualities and Audio only with sizes;
nothing downloads until they pick. After Save, Chief says it is saved and gives the link it came from; the video plays.

## Driving it

1. Needs a task-named `CHROME_DEVTOOLS_AXI_SESSION`, a built web app (`npm run build:web`), ffmpeg, chromium and xvfb-run.
2. Run `bash scripts/verify/video-job.sh <repo> <out>` (its own stub-engine lab, the stand-in yt-dlp at the manifest's pin,
   Video Vic hired, the link pasted to Chief; the pick is a tap in the installed app at 390).
3. Capture: `screens/video-card-*`, `pwa/video-card-installed-*`, `pwa/video-card-picked-day-390.png`,
   `pwa/video-result-installed-*`, `screens/video-result-*`, `look/video-result-*`; the step record `steps.json`.
4. It proves: no file before the pick, only the picked file after it with its link, the card answered with the pick.
