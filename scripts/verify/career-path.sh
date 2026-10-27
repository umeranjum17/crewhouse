#!/usr/bin/env bash
# done-done journey `career-path`: build the web app of this checkout, serve it, and capture "Your path to the US" on the ?demo=goal
# household: the goal with its entry row, the four closed stages, one stage open with a claim open, and the sponsors stage, at 390 and
# 1280 (day and night) and in the installed app's window mode at 390. home-gate.mjs gates each shot: text 16px or more, nothing
# clipped, no sideways scroll. The plan's quotes are checked against the live pages by scripts/check-career-sources.mjs (network).
#
#   scripts/verify/career-path.sh <out-dir>
set -euo pipefail
OUT=${1:?usage: career-path.sh <out-dir>}; mkdir -p "$OUT"
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(pwd)
[ -e "$REPO/node_modules" ] || ln -s "$HERE/../../node_modules" "$REPO/node_modules"
npm run build:web > "$OUT/build-web.log" 2>&1
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$REPO/web/dist" > "$OUT/server.log" 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for _ in $(seq 100); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break; sleep 0.1; done
B="http://127.0.0.1:$PORT/?demo=goal"
open_item() { echo "document.querySelectorAll('.path-head')[$1].click(); setTimeout(() => document.querySelector('.path-item summary').click(), 200)"; }
gate() { node "$HERE/home-gate.mjs" "$REPO" "$B#$2" "$OUT" "$1" "${3:-}"; }
for pwa in "" 1; do
  p=${pwa:+pwa-}
  GATE_PWA=$pwa gate "${p}career-goal" /goal
  GATE_PWA=$pwa gate "${p}career-closed" /goal/path
  GATE_PWA=$pwa gate "${p}career-open" /goal/path "$(open_item 0)"
  GATE_PWA=$pwa gate "${p}career-sponsors" /goal/path "$(open_item 2)"
done
node "$HERE/steps.mjs" "$OUT" career-path
