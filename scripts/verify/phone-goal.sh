#!/usr/bin/env bash
# Your goal on the phone app (docs/verification/phone-goal.md): the pairing lab (pair-lab.sh, stub engine) gets Umer's goal
# and board through the same calls as jobs-loop.sh (a Found and a Drafted role, the writer's draft waiting), the emulator
# pairs by the typed relay code, and the phone opens Home's Your goal row, the board, the drafted role with its draft, then
# Fill it in for me: the writer fills the posting's form in its own browser (jobs-apply.mjs fill: a scripted turn, the
# real browser and gate), and the role shows the one Submit card, recorded as it arrives; Umer answers his own questions
# and taps Submit on the phone, and the local posting records what was sent. Then (after his Interview tap and the
# writer's prep) the role's prep entry and the prep itself. Each at 390 wide, day and night.
#
#   SERIAL=emulator-5580 BROWSER_TOOLS=<tools-dir> bash scripts/verify/phone-goal.sh <out-dir> <apk>
# <tools-dir> holds an installed browser tool (CREWHOUSE_TOOLS_DIR=<tools-dir> ./crewhouse tools install browser).
#
# Exit 0 with {home,goal,role,role-draft,submit,submit-yours,prep-entry,prep}-{day,night}-390.png, submit-card.mp4, sent.json and
# the step record in <out-dir>. The emulator is the caller's (started and stopped by them).
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: SERIAL=<emulator> phone-goal.sh <out-dir> <apk>" >&2; exit 2; }
OUT=$1; APK=$2; : "${SERIAL:?set SERIAL to the emulator}"; [ -e "${BROWSER_TOOLS:-}/bin/playwright-axi" ] || { echo "phone-goal: set BROWSER_TOOLS to a tools folder with the browser installed" >&2; exit 2; }
VERIFY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$VERIFY_DIR" rev-parse --show-toplevel)
mkdir -p "$OUT"
adb() { command adb -s "$SERIAL" "$@"; }
ui() { SERIAL=$SERIAL node "$VERIFY_DIR/phone-ui.mjs" "$@"; }
# Scroll until a line is wholly on screen above the tab bar (reveal wants it in the top quarter, which a page's last rows never reach).
bring() { for _ in $(seq "${2:-8}"); do ui texts | grep -E -- "$1" | grep -qE '\[[0-9]+,[0-9]+,[0-9]+,(1[0-9]{3}|[0-9]{1,3}|20[0-9]{2})\]' && return 0; adb shell input swipe 540 1700 540 900 300; sleep 1; done; echo "phone-goal: could not bring $1 on screen" >&2; return 1; }
up() { for _ in 1 2 3 4 5; do adb shell input swipe 540 700 540 1900 200; done; }
see() { for _ in $(seq "${2:-30}"); do ui texts 2>/dev/null | grep -qE -- "$1" && return 0; sleep 1; done; ui texts >&2 || true; echo "phone-goal: never saw: $1" >&2; return 1; }

export LAB; LAB=$(mktemp -d -t phone-goal.XXXXXX)
. "$VERIFY_DIR/crewd-group.sh"
POSTING=""; COMPANY=""
trap '[ -z "$POSTING" ] || kill "$POSTING" 2>/dev/null; [ -z "$COMPANY" ] || kill "$COMPANY" 2>/dev/null; bash "$VERIFY_DIR/pair-lab.sh" down || true; adb shell wm size reset >/dev/null 2>&1 || true; adb shell wm density reset >/dev/null 2>&1 || true; adb shell cmd uimode night no >/dev/null 2>&1 || true; cp "$LAB/crewd.log" "$OUT/crewd.log" 2>/dev/null || true; crewhouse_remove_lab "$LAB"' EXIT
LAB_TOOLS=$BROWSER_TOOLS bash "$VERIFY_DIR/pair-lab.sh" up "$REPO" >/dev/null
. "$LAB/env"
free() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
# The postings carry the application form (jobs-apply.mjs serve; a POST is written to sent.json); the company's own page is apart.
PPORT=$(free); P="http://127.0.0.1:$PPORT"; CPORT=$(free); C="http://127.0.0.1:$CPORT"
node "$VERIFY_DIR/jobs-apply.mjs" serve "$PPORT" "$OUT/sent.json" &
POSTING=$!
node -e 'require("node:http").createServer((q,r)=>{r.setHeader("content-type","text/html");r.end("<p>Northwind serves two million customers across the UK. Its engineers ship the checkout app every two weeks, in squads of five.</p>")}).listen(+process.argv[1],"127.0.0.1")' "$CPORT" &
COMPANY=$!
PERSON=$(cat "$LAB/state/person.key")
drive() { node "$VERIFY_DIR/jobs-loop.mjs" "$1" "$B" "$PERSON" "$P"; }
drive_prep() { node "$VERIFY_DIR/jobs-prep.mjs" "$1" "$B" "$PERSON" "$C"; }
rm -f "$OUT/sent.json"
drive goal >/dev/null
drive board >/dev/null

# 390 wide: 1080 px at density 443.
adb shell wm size 1080x2400; adb shell wm density 443
node "$VERIFY_DIR/phone-pair-typed.mjs" --serial "$SERIAL" --apk "$APK"
ui tap '^Home$' >/dev/null || true
shot() { # $1 file stem, $2 the words that must be on screen
  for theme in day night; do
    adb shell cmd uimode night "$([ $theme = night ] && echo yes || echo no)" >/dev/null
    see "$2" 10 2>/dev/null || bring "$2"; sleep 1
    ui shot "$OUT/$1-$theme-390.png"
  done
  adb shell cmd uimode night no >/dev/null
}
bring ' Your goal$'
shot home ' Frontend engineer: 2 on your board$'
ui tap '^Your goal$' >/dev/null
shot goal ' Found 1$'
ui tap '^Drafted 1$' >/dev/null; see ' Northwind · London$'
ui tap '^Frontend Engineer at Northwind$' >/dev/null
shot role ' Writer Will drafted your application$'
shot role-draft ' Fill it in for me$'
# The card arrives on the open role while the screen records; screenrecord drops its last frames, so it runs on past them.
adb shell screenrecord --time-limit 45 /sdcard/submit-card.mp4 & REC=$!
node "$VERIFY_DIR/jobs-apply.mjs" fill "$B" "$PERSON" "$LAB/crew" "$LAB/state" "$BROWSER_TOOLS" >/dev/null
bring ' Nothing is sent until you press Submit$' 30
wait "$REC"; adb pull /sdcard/submit-card.mp4 "$OUT/submit-card.mp4" >/dev/null; adb shell rm /sdcard/submit-card.mp4
shot submit ' ONLY YOU CAN ANSWER THESE$'
# Umer's own answers, typed a few letters at a time (controlled inputs drop fast text), then his Submit.
bring ' Expected salary$'; ui tap '^Expected salary$' 1 >/dev/null
for part in 600 00; do adb shell input text "$part"; sleep 0.5; done
ui texts | grep -q '\] 60000' || { echo "phone-goal: the salary never took" >&2; exit 1; }
[ "$(adb shell dumpsys input_method | grep -c 'mInputShown=true')" = 0 ] || adb shell input keyevent 4
bring ' No$'; ui tap '^No$' >/dev/null
bring ' Submit$'
shot submit-yours ' Submit$'
ui tap '^Submit$' >/dev/null
for _ in $(seq 60); do [ -s "$OUT/sent.json" ] && break; sleep 1; done
grep -q '"salary":"60000"' "$OUT/sent.json" && grep -q '"visa":"No"' "$OUT/sent.json" || { echo "phone-goal: the form was not sent with his answers" >&2; cat "$OUT/sent.json" >&2 || true; exit 1; }
up; ui tap '^‹ Your goal$' >/dev/null
see ' Applied 1$'
drive_prep interview >/dev/null
drive_prep prep >/dev/null
ui tap '^Interview 1$' >/dev/null; see ' Northwind · London$'
ui tap '^Frontend Engineer at Northwind$' >/dev/null
shot prep-entry ' Open your interview prep$'
ui tap '^Open your interview prep$' >/dev/null
shot prep ' QUESTIONS YOU MAY BE ASKED$'
node "$VERIFY_DIR/steps.mjs" "$OUT" phone-goal
echo "phone-goal: Home's goal row, the board, a drafted role with its draft, the Submit card and his Submit, the prep entry and the prep, day and night"
