#!/usr/bin/env bash
# done-done journey `calm-design`: build the web app of the checkout it runs in, serve it, and capture Chief's chat and Home
# at 390 and Chief in three panes at 1280, day and night, on the ?demo data (calm-cap.mjs). With base_ref the same drive runs
# at the base commit into before/, where these scripts do not exist yet: CALM_HEAD names the checkout that has them, and its
# node_modules stands in for the base checkout's missing one (the package files are the same).
#
#   scripts/verify/calm-design.sh <out-dir>
set -euo pipefail
OUT=${1:?usage: calm-design.sh <out-dir>}; mkdir -p "$OUT"
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(pwd)
[ -e "$REPO/node_modules" ] || ln -s "$HERE/../../node_modules" "$REPO/node_modules"
npm run build:web > "$OUT/build-web.log" 2>&1
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$REPO/web/dist" > "$OUT/server.log" 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for _ in $(seq 100); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break; sleep 0.1; done
node "$HERE/calm-cap.mjs" "$REPO" "http://127.0.0.1:$PORT/" "$OUT"
cat > "$OUT/steps.json" <<J
{"target":{"version":"$(git rev-parse HEAD)"},"start":"the web app built from this checkout, on the ?demo data",
"steps":["open Chief's chat and Home on a 390 phone, day and night","open Chief in the three panes on a 1280 computer, day and night"],
"result":"Chief's chat, Home and the desktop shell as this commit draws them"}
J
