#!/usr/bin/env bash
# done-done journey `jobs-eval` (needs a browser session): run the jobs eval on its stub engine, open the report.html it
# writes the way a person does, and capture it at 390 and 1280 into <out>/screens/. The stub run proves the harness and
# the page only; the page says so and says the real-model run waits on the account owner's sign-in (docs/jobs-eval.md).
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/jobs-eval.sh "$DONE_DONE_EVIDENCE_ROOT"
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: jobs-eval.sh <evidence-dir>" >&2; exit 2; }
OUT=$1; mkdir -p "$OUT/screens"
REPO=$(git rev-parse --show-toplevel)
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
export NODE=/usr/bin/node PATH="/usr/bin:$PATH"
bash "$REPO/scripts/jobs-eval.sh" --engine stub --out "$OUT/report" --no-ledger
# The page over loopback, from a server of our own that dies with this script.
SERVER_LOG=$(mktemp -t jobs-eval-page.XXXXXX)
node -e '
const http = require("node:http"), fs = require("node:fs");
const html = fs.readFileSync(process.argv[1]);
http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(html); })
  .listen(0, "127.0.0.1", function () { console.log(this.address().port); });' "$OUT/report/report.html" > "$SERVER_LOG" &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true; rm -f -- "$SERVER_LOG"' EXIT
for _ in $(seq 100); do [ -s "$SERVER_LOG" ] && break; sleep 0.1; done
PORT=$(head -n1 "$SERVER_LOG"); [ -n "$PORT" ] || { echo "jobs-eval: the page server never started" >&2; exit 1; }
URL="http://127.0.0.1:$PORT/"
PAGE=$(curl -fsS --max-time 10 "$URL"); grep -q 'id="real-run"' <<<"$PAGE" || { echo "jobs-eval: the page lacks the real-run line" >&2; exit 1; }
THEMES=day WIDTHS="1280x800 390x844" FULL_PAGE=1 bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" jobs-eval "$URL"
node "$REPO/scripts/verify/steps.mjs" "$OUT" jobs-eval
echo "jobs-eval: $(ls "$OUT"/screens/*.png | wc -l) captures in $OUT/screens"
