#!/usr/bin/env bash
# Your goal on the phone app (docs/verification/phone-goal.md): the pairing lab (pair-lab.sh, stub engine) gets Umer's goal
# and board through the same calls as jobs-loop.sh (a Found and a Drafted role, the writer's draft waiting), the emulator
# pairs by the typed relay code, and the phone opens Home's Your goal row, the board, the drafted role with its draft, then
# (after the person's own Interview tap and the writer's prep) the role's prep entry and the prep itself. Each at 390
# wide, day and night.
#
#   SERIAL=emulator-5580 bash scripts/verify/phone-goal.sh <out-dir> <apk>
#
# Exit 0 with {home,goal,role,prep-entry,prep}-{day,night}-390.png and the step record in <out-dir>. The emulator is the
# caller's (started and stopped by them).
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: SERIAL=<emulator> phone-goal.sh <out-dir> <apk>" >&2; exit 2; }
OUT=$1; APK=$2; : "${SERIAL:?set SERIAL to the emulator}"
VERIFY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$VERIFY_DIR" rev-parse --show-toplevel)
mkdir -p "$OUT"
adb() { command adb -s "$SERIAL" "$@"; }
ui() { SERIAL=$SERIAL node "$VERIFY_DIR/phone-ui.mjs" "$@"; }
see() { for _ in $(seq "${2:-30}"); do ui texts 2>/dev/null | grep -qE -- "$1" && return 0; sleep 1; done; ui texts >&2 || true; echo "phone-goal: never saw: $1" >&2; return 1; }

export LAB; LAB=$(mktemp -d -t phone-goal.XXXXXX)
. "$VERIFY_DIR/crewd-group.sh"
POSTING=""
trap '[ -z "$POSTING" ] || kill "$POSTING" 2>/dev/null; bash "$VERIFY_DIR/pair-lab.sh" down || true; adb shell wm size reset >/dev/null 2>&1 || true; adb shell wm density reset >/dev/null 2>&1 || true; adb shell cmd uimode night no >/dev/null 2>&1 || true; cp "$LAB/crewd.log" "$OUT/crewd.log" 2>/dev/null || true; crewhouse_remove_lab "$LAB"' EXIT
bash "$VERIFY_DIR/pair-lab.sh" up "$REPO" >/dev/null
. "$LAB/env"
PPORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'); P="http://127.0.0.1:$PPORT"
node -e 'require("node:http").createServer((q,r)=>{r.setHeader("content-type","text/html");r.end(/company/.test(q.url)?"<p>Northwind serves two million customers across the UK. Its engineers ship the checkout app every two weeks, in squads of five.</p>":q.url.endsWith("/2")?"<h1>UI Engineer</h1><p>Remote, UK. Design systems.</p>":"<h1>Frontend Engineer</h1><p>Salary: £55,000 to £65,000 a year. React, TypeScript, GraphQL.</p>")}).listen(+process.argv[1],"127.0.0.1")' "$PPORT" &
POSTING=$!
PERSON=$(cat "$LAB/state/person.key")
drive() { node "$VERIFY_DIR/jobs-loop.mjs" "$1" "$B" "$PERSON" "$P"; }
drive_prep() { node "$VERIFY_DIR/jobs-prep.mjs" "$1" "$B" "$PERSON" "$P"; }
drive goal >/dev/null
drive board >/dev/null

# 390 wide: 1080 px at density 443.
adb shell wm size 1080x2400; adb shell wm density 443
node "$VERIFY_DIR/phone-pair-typed.mjs" --serial "$SERIAL" --apk "$APK"
ui tap '^Home$' >/dev/null || true
shot() { # $1 file stem, $2 the words that must be on screen
  for theme in day night; do
    adb shell cmd uimode night "$([ $theme = night ] && echo yes || echo no)" >/dev/null
    see "$2" 20; sleep 1
    ui shot "$OUT/$1-$theme-390.png"
  done
  adb shell cmd uimode night no >/dev/null
}
ui texts | grep -q "Your goal" || ui reveal "Your goal" >/dev/null
shot home ' Frontend engineer: 2 roles on your board$'
ui tap '^Your goal$' >/dev/null
shot goal ' Found 1$'
ui tap '^Drafted 1$' >/dev/null; see ' Northwind · London$'
ui tap '^Frontend Engineer at Northwind$' >/dev/null
shot role ' Copy and open the form$'
ui tap '^‹ Your goal$' >/dev/null
drive_prep interview >/dev/null
drive_prep prep >/dev/null
ui tap '^Interview 1$' >/dev/null; see ' Northwind · London$'
ui tap '^Frontend Engineer at Northwind$' >/dev/null
shot prep-entry ' Open your interview prep$'
ui tap '^Open your interview prep$' >/dev/null
shot prep ' Questions you may be asked$'
node "$VERIFY_DIR/steps.mjs" "$OUT" phone-goal
echo "phone-goal: Home's goal row, the board, a drafted role with its draft, the prep entry and the prep, day and night"
