#!/usr/bin/env bash
# Films the app as the person sees it, at phone width (390) and desktop width (1440) side by side, on an Xvfb of its own:
# two app windows of the bot's-owner's Chromium on x11 (the distro wrapper's Wayland flag would put them on the real desktop).
#
#   scripts/verify/app-film.sh <app url with #person=<key>> <out.mp4> <stop-file>
#
# Films until <stop-file> exists, then writes <out.mp4> (1830x900) and removes its profiles, windows and display.
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: app-film.sh <app url> <out.mp4> <stop-file>" >&2; exit 2; }
URL=$1 OUT=$(realpath -m "$2") STOP=$3
D=$(mktemp -d -t app-film.XXXXXX)
. "$(dirname "${BASH_SOURCE[0]}")/crewd-group.sh"
PIDS=()
trap 'for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; crewhouse_remove_lab "$D"' EXIT
Xvfb -displayfd 3 -screen 0 1840x910x24 -nolisten tcp 3> "$D/display" > /dev/null 2>&1 &
PIDS+=($!)
for _ in $(seq 100); do [ -s "$D/display" ] && break; sleep 0.1; done
export DISPLAY=:$(cat "$D/display")
win() { chromium --user-data-dir="$D/$1" --no-first-run --no-default-browser-check --disable-gpu --ozone-platform=x11 --force-device-scale-factor=1 \
  --window-position="$2,0" --window-size="$3,$4" --app="$URL" > /dev/null 2>&1 & PIDS+=($!); }
win phone 0 390 844
win desktop 400 1440 900
sleep 8
ffmpeg -y -loglevel error -f x11grab -video_size 1840x910 -framerate 8 -i "$DISPLAY" -vf crop=1840:900:0:0 -pix_fmt yuv420p "$D/film.mp4" < /dev/null &
FILM=$!
while [ ! -e "$STOP" ]; do sleep 0.5; done
kill -INT "$FILM"; wait "$FILM" || true
mv "$D/film.mp4" "$OUT"
