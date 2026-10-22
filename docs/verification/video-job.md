# The video job

The person pastes a video link in Chief's chat. Chief hands it to Video Vic (the `reel` template), whose `crew_video` call
has crewd run the pinned `yt-dlp` (`tools/video-download`) in Vic's own sandbox, on the crew host: first `-J`, which only
reads the link. crewd turns that read into a card in Chief's chat (`kind: 'video'`, Chief's like every ask): the video's
title, where it is from, up to three qualities at 1080p or under and Audio only, each with yt-dlp's own size estimate
(from the bit rate and length when it gives none). Nothing downloads before the pick. The tap names the pick; crewd then
downloads only that format into Vic's `files/` and delivers it with the link it came from; Chief answers from Vic's report.
A pick that comes after the call parked (no answer within the hold) requeues the job, which takes the answered card and
goes on; nothing is asked twice.

## Drive and witness

`CHROME_DEVTOOLS_AXI_SESSION=<task> bash scripts/verify/video-job.sh <repo> <out-dir>` (stub engine with
`CREWHOUSE_STUB_GOLDEN=1`, which scripts Chief's `sessions_send` hand-off and Vic's call; `npm run build:web` first). The
lab's `yt-dlp` is the stand-in from `test/video-saver.ts` at the manifest's own pin: `-J` answers with a YouTube upload's
formats and a download copies a real 6-second mp4 made with ffmpeg, so no site is reached.

What it proves, from the lab's own records: `before-pick.txt` (the card is Chief's, its choices and sizes, Vic's job
waiting, no file yet); `after-pick.txt` (exactly one file, ffprobe's read of it, the delivery note naming 720p and the link,
the card answered `720p`, Chief's job done); `card-geometry.txt` (the card's words and rows at 390, nothing clipped).

## Capture

`screens/video-card-{day,night}-{390,1440}.png` (the card in a browser tab), `pwa/video-card-installed-{day,night}-{390,1440}.png`
and `pwa/video-card-picked-day-390.png` (the installed app, then the tap on 720p), `pwa/video-result-installed-…` and
`screens/video-result-…` (Chief's thread after the pick), `look/video-result-{day,night}.png` (360 wide, largest text).
`test/video-download.test.ts` drives the same journey and the late-pick case on the stub engine.

Not covered: the native Expo app (the card is the web/PWA's), a real download from a real site, and a live model.
