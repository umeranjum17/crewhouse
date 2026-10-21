# A pinned tool that failed

Part of the crewhouse verification map. Source: `docs/verification/pinned-tool-failure.md`.

## How to get to it (user POV)

A helper's pinned kit tool fails on a link. The person opens the helper's "What happened" and reads that the download did
not happen, that the copy Crewhouse pins is behind the newer one, and that an update brings it in.

## Driving it

1. Needs a task-named `CHROME_DEVTOOLS_AXI_SESSION` and a built web app (`npm run build:web`).
2. Run `scripts/verify/pinned-tool.sh <out>` (it boots its own stub-engine lab, puts the pinned `yt-dlp` release in the lab's tool
   folder, recruits the `reel` helper and posts the failing job) — the recipe names every command.
3. Capture: `pinned-tool-{night,day}-{1440,390}.png` and the look check's `look/pinned-tool-{day,night}.png`.
4. It proves: the trail row is `ok: false` and says "Couldn't download a video", the step names the newer copy, and the
   tool result the model read starts `error: yt-dlp failed (exit 1):` with the tool's own last words.
