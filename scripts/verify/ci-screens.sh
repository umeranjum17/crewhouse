#!/usr/bin/env bash
# CI's screen pass: every row of screens-ci.tsv on ?demo through screens.sh (day and night, 390 and 1440), then the
# changed-frame list against a baseline folder (main's screens artifact). Artifacts only: nothing is published or commented.
#
#   scripts/verify/ci-screens.sh <out-dir> [baseline-dir]
#
# Needs a built shell (npm run build:web) and chrome-devtools-axi. <out-dir>/changed-frames.txt is text: "no screen
# changed" when every frame matches its baseline pixel for pixel, else one line per changed, new or gone frame.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: ci-screens.sh <out-dir> [baseline-dir]" >&2; exit 2; }
OUT=$1; BASE=${2:-}
VERIFY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$VERIFY_DIR" rev-parse --show-toplevel)
mkdir -p "$OUT"
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:-ci-screens}"

LAB=$(mktemp -d -t ci-screens.XXXXXX)
. "$(dirname "${BASH_SOURCE[0]}")/crewd-group.sh"
trap 'kill "$SRV" 2>/dev/null || true; crewhouse_remove_lab "$LAB"' EXIT
node "$VERIFY_DIR/serve-web.mjs" "$REPO/web/dist" > "$LAB/serve.log" 2>&1 & SRV=$!
for _ in $(seq 100); do
  grep -q '^serving ' "$LAB/serve.log" 2>/dev/null && break
  kill -0 "$SRV" 2>/dev/null || { cat "$LAB/serve.log" >&2; echo "ci-screens: the shell did not serve" >&2; exit 1; }
  sleep 0.1
done
PORT=$(sed -n 's|^serving .*localhost:\([0-9]*\)/.*|\1|p' "$LAB/serve.log" | head -n 1)
[ -n "$PORT" ] || { cat "$LAB/serve.log" >&2; echo "ci-screens: no port from serve-web" >&2; exit 1; }

# Before each shot (screens.sh THEN): the entrance animations end on their last frame, and the page has text before
# the shot, waiting at most 10 s. Without it two runs of one frame differ in the antialiasing of every line of text.
FREEZE='(async () => { const s = document.createElement("style"); s.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}"; document.head.append(s); for (const a of document.getAnimations()) a.finish(); for (let i = 0; i < 100 && !document.body.innerText.trim(); i++) await new Promise((r) => setTimeout(r, 100)); await document.fonts.ready; return document.body.innerText.trim().length > 0; })()'

# One screens.sh call per row; a failed row is reported at the end, so the other rows and the frame list still land.
failed=()
while IFS=$'\t' read -r slug query hash; do
  case "$slug" in ''|'#'*) continue ;; esac
  # One retry per row: chrome-devtools-axi sometimes loses its tab (BROWSER_ERROR) and a second open usually lands.
  THEN="$FREEZE" bash "$VERIFY_DIR/screens.sh" "$OUT" "$slug" "http://crewhouse.localhost:$PORT/$hash" "$query" \
    || THEN="$FREEZE" bash "$VERIFY_DIR/screens.sh" "$OUT" "$slug" "http://crewhouse.localhost:$PORT/$hash" "$query" \
    || failed+=("$slug")
done < "$VERIFY_DIR/screens-ci.tsv"

# The changed frames: a pixel count from ImageMagick's AE metric, against the same file name in the baseline.
FRAMES="$OUT/changed-frames.txt"
shopt -s nullglob
frames=("$OUT"/*.png)
if [ ${#frames[@]} -eq 0 ]; then
  echo "ci-screens: no frame was captured" >&2; exit 1
fi
baseline=()
[ -z "$BASE" ] || baseline=("$BASE"/*.png) # nullglob: no PNG leaves the array empty, not the literal pattern
if [ ${#baseline[@]} -eq 0 ]; then
  echo "no baseline: main has no screens artifact yet, so ${#frames[@]} frames were captured and none compared" > "$FRAMES"
else
  : > "$FRAMES"
  for f in "${frames[@]}"; do
    n=$(basename "$f")
    if [ ! -f "$BASE/$n" ]; then echo "new: $n" >> "$FRAMES"; continue; fi
    px=$(compare -metric AE "$BASE/$n" "$f" null: 2>&1 || true)
    px=${px%% *} # "0 (0)" when identical: the count comes first
    case "$px" in
      0) ;;
      [0-9]*) echo "changed: $n ($px px)" >> "$FRAMES" ;;
      *) echo "changed: $n (not comparable: $px)" >> "$FRAMES" ;;
    esac
  done
  for b in "$BASE"/*.png; do
    n=$(basename "$b")
    [ -f "$OUT/$n" ] || echo "gone: $n" >> "$FRAMES"
  done
  [ -s "$FRAMES" ] || echo "no screen changed" > "$FRAMES"
fi
cat "$FRAMES"
echo "ci-screens: ${#frames[@]} frames in $OUT"
[ ${#failed[@]} -eq 0 ] || { echo "ci-screens: capture failed for: ${failed[*]}" >&2; exit 1; }
