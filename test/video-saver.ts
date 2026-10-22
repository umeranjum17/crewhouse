// The video job's stand-in for the pinned yt-dlp, shared by test/video-download.test.ts and scripts/verify/video-job.sh.
// What the pinned yt-dlp says about a YouTube link (`-J`, trimmed to the fields crewd reads): a 4K upload with the usual
// split video and sound streams, a 360p file with both, and a storyboard. A download writes which format it was asked for.
export const INFO = { title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film', duration: 635, formats: [
  { format_id: 'sb0', ext: 'mhtml', vcodec: 'none', acodec: 'none', height: 90 },
  { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', filesize: 10_283_000 },
  { format_id: '251', ext: 'webm', vcodec: 'none', acodec: 'opus', filesize: 9_810_000 },
  { format_id: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, filesize: 25_400_000 },
  { format_id: '135', ext: 'mp4', vcodec: 'avc1.4d401f', acodec: 'none', height: 480, tbr: 450 },
  { format_id: '136', ext: 'mp4', vcodec: 'avc1.4d401f', acodec: 'none', height: 720, filesize: 70_100_000 },
  { format_id: '247', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 720, filesize: 61_000_000 },
  { format_id: '137', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', height: 1080, filesize: 150_200_000 },
  { format_id: '313', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 2160, filesize: 902_000_000 }] };
export const SAVER = `#!/bin/sh
here=$(dirname "$(readlink -f "$0")"); out=""; fmt=""
while [ $# -gt 0 ]; do case "$1" in -J) cat "$here/info.json"; exit 0;; -f) fmt=$2; shift;; -o) out=$2; shift;; esac; shift; done
if [ -f "$here/sample.mp4" ]; then cp "$here/sample.mp4" "$out"; else printf 'video %s' "$fmt" > "$out"; fi
`;
