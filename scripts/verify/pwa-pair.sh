#!/usr/bin/env bash
set -euo pipefail
OUT=$(mkdir -p "${1:?evidence directory}" && cd "$1" && pwd)
export LAB=$(mktemp -d "${TMPDIR:-/tmp}/crewhouse-pwa-pair.XXXXXX")
. scripts/verify/crewd-group.sh   # HUP, INT and TERM exit through cleanup
cleanup() { bash scripts/verify/pair-lab.sh down 2>&"$crewd_err" || exit 1; rm -rf "$LAB"; }
trap cleanup EXIT
bash scripts/verify/pair-lab.sh up "$PWD" > "$OUT/lab.log" 2>&1
mkdir -p "$OUT/shots" "$OUT/motion"
node scripts/verify/pair-plan.mjs "$LAB" "$OUT" > "$LAB/plan.json"
xvfb-run -a -s '-screen 0 1920x1200x24' node scripts/verify/pwa-shell.mjs "$LAB/plan.json" > "$OUT/run.json"
node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1])); if(r.some(x=>x.error))process.exit(1)' "$OUT/run.json"
node scripts/verify/steps.mjs "$OUT" pwa-pair
