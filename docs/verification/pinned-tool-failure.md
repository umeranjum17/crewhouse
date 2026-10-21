# A pinned tool that failed

A helper's pinned kit tool (the `video-download` kit's `yt-dlp`) fails on a link that is not there. The person must read
what failed and what to do: the step says the download did not happen, and it says that the copy Crewhouse pins is behind
the copy Crewhouse now pins, and that an update brings the newer one in. Nothing claims a video was downloaded.

## Drive and witness

`bash scripts/verify/pinned-tool.sh <out-dir>` (stub engine). The script boots its own isolated crewd (the runbook's Launch),
puts the pinned `yt-dlp` release the kit used before this change into the lab's tool folder with its own pin, onboards,
recruits a helper from the `reel` template (it holds `video-download` and `files`), and posts the job that runs the tool on
a link that never resolves. It waits for the job to settle, then captures the helper's "What happened" screen.

What it proves, all from the lab's own records:

- `GET /api/task/<id>/trail` — one row, `ok: false`, words "Couldn't download a video": a failed call never reads as work done.
- The helper's trail events — the step a person reads: "Couldn't download a video. yt-dlp is Crewhouse's pinned copy. A
  changed site is the usual reason a pinned copy stops working; Crewhouse has a newer copy (2026.10.10.233141) than yours
  (2026.08.19), and an update brings it in."
- The job's own record — the tool result the model read: `error: yt-dlp failed (exit 1): <the tool's own last words>`,
  then the kit's words about the copy and the newer one.
- `crewd.log` — the daemon ran on the stub engine with no account and no model call.

## Capture

`pinned-tool-{night,day}-{1440,390}.png`: the helper's "What happened" screen, the failed step and the way out, in both
themes at both widths. `look/pinned-tool-{day,night}.png`: the look check on the same screen at 360 wide with the largest
text (no approved mock for this screen yet).

Not covered: the native Expo app's own screens (the web app draws this trail), and a real download from a real site (the
link never resolves on purpose, so no site is touched; the exact reported error, "Requested format is not available", is
driven by `test/video-download.test.ts` with a fake binary).
