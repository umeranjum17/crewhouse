#!/usr/bin/env bash
# done-done journey `skill-eval`: the paired skill eval on the stub engine. The same prompts run with and without a
# bundled skill (crewhouse-research-report), each run's document checked against the rubric, every raw run kept in a
# JSONL file, and the two arms diffed on one page a person can read.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> bash scripts/verify/skill-eval.sh <out-dir>
#
# Exit 0 with results.jsonl, crew.log, report.html, skill-eval.txt and skill-eval-report.png in <out-dir>; non-zero
# when the harness fails or reaches no verdict. No account, no network and no model: the pages a run reads are
# fixture pages on loopback, served by the harness itself.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: skill-eval.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
node "$REPO/scripts/skill-eval.mjs" --out "$OUT" > "$OUT/skill-eval.txt"
cat "$OUT/skill-eval.txt"
grep -qE 'beats the baseline|does NOT beat the baseline' "$OUT/skill-eval.txt" || { echo "skill-eval: the harness reached no verdict" >&2; exit 1; }
# The result as a person reads it: the trigger table, the checks both arms passed, and the verdict.
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
cleanup() { chrome-devtools-axi stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
ax() { timeout -k 10 120 chrome-devtools-axi "$@"; }
pages=$(ax pages) || { echo "skill-eval: chrome-devtools-axi could not list pages" >&2; exit 1; }
first=$(printf '%s\n' "$pages" | awk -F, 'NR>1 { gsub(/ /, "", $1); if ($1 ~ /^[0-9]+$/) { print $1; exit } }')
if [ -n "$first" ]; then ax selectpage "$first" >/dev/null; else ax newpage about:blank >/dev/null; fi
ax emulate --viewport 1280x900x1 >/dev/null
ax open "file://$OUT/report.html" >/dev/null
ax screenshot "$OUT/skill-eval-report.png" --full-page >/dev/null
[ -s "$OUT/skill-eval-report.png" ] || { echo "skill-eval: no capture of the report" >&2; exit 1; }
VERDICT=$(grep -E 'beats the baseline' "$OUT/skill-eval.txt" | head -1)
node "$REPO/scripts/verify/steps.mjs" "$OUT" skill-eval "verdict=$VERDICT"
echo "skill-eval: both arms diffed; captures in $OUT"
