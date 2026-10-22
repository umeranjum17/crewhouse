#!/usr/bin/env bash
# Chief on this phone with a MiniMax key: on a lab release APK, Use this phone only, pick MiniMax beside OpenRouter, paste a
# lab key, see every model the live list gives, pick one, confirm it, and Chief's chat names it. Sign out then leaves no
# key. Each state is captured at 390 wide, day and night. The live list is a lab fake of MiniMax's /anthropic/v1/models
# with the 9 ids MiniMax listed on 2026-10-22, served here and reached through adb reverse; the APK is built with
# EXPO_PUBLIC_CREWHOUSE_MINIMAX_API=http://127.0.0.1:$FAKE_PORT/anthropic. No model is called and nothing is sent
# (docs/verification/phone-only-minimax.md).
#
#   SERIAL=emulator-5580 [PHONE_OTHER=<dir>] [FAKE_PORT=7412] bash scripts/verify/phone-only-minimax.sh <out-dir> <lab APK>
#
# A judged run reads every capture in <out-dir> against one claim, so <out-dir> holds the one claimed state (and the step
# record): PHONE_CLAIM names it (choice, model, picked or chat; default model, the full list). Every
# other state goes to PHONE_OTHER when it is set, else beside it. The emulator is the caller's (started and stopped by them).
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: SERIAL=<emulator> phone-only-minimax.sh <out-dir> <apk>" >&2; exit 2; }
OUT=$1; APK=$2; : "${SERIAL:?set SERIAL to the emulator}"; OTHER=${PHONE_OTHER:-$OUT} CLAIM=${PHONE_CLAIM:-model} FAKE_PORT=${FAKE_PORT:-7412}
VERIFY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PKG=dev.crewhouse.app KEY=lab-minimax-key-0000
mkdir -p "$OUT" "$OTHER"
adb() { command adb -s "$SERIAL" "$@"; }
ui() { SERIAL=$SERIAL node "$VERIFY_DIR/phone-ui.mjs" "$@"; }
# Wait at most $2 seconds for a text on screen.
see() { for _ in $(seq "${2:-30}"); do ui texts 2>/dev/null | grep -qE -- "$1" && return 0; sleep 1; done; ui texts >&2 || true; echo "phone-only-minimax: never saw: $1" >&2; return 1; }
# The keyboard covers the lower half; BACK only while it shows, or BACK leaves the screen.
hide_keys() { adb shell dumpsys input_method | grep -q 'mInputShown=true' && adb shell input keyevent 4 || true; sleep 1; }
# One state, day and night, at 390 wide: the claimed one into the run's own folder, the rest into PHONE_OTHER.
shot() {
  local dir; dir=$([ "$1" = "$CLAIM" ] && echo "$OUT" || echo "$OTHER")
  for theme in day night; do
    adb shell cmd uimode night "$([ $theme = night ] && echo yes || echo no)" >/dev/null
    see "$2" 15
    sleep 1
    ui shot "$dir/phone-only-minimax-$1-$theme-390.png"
  done
  adb shell cmd uimode night no >/dev/null
}
# The lab fake of MiniMax's live list (any other path is refused, as a lab key would be).
node -e '
const ids = ["MiniMax-M3.1-Flash","MiniMax-M3","MiniMax-M2.7","MiniMax-M2.7-highspeed","MiniMax-M2.5","MiniMax-M2.5-highspeed","MiniMax-M2.1","MiniMax-M2.1-highspeed","MiniMax-M2"];
require("node:http").createServer((q, r) => q.url === "/anthropic/v1/models"
  ? r.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: ids.map((id) => ({ id, type: "model", display_name: id.replace("highspeed", "Highspeed") })) }))
  : r.writeHead(401).end()).listen(+process.argv[1], "127.0.0.1");' "$FAKE_PORT" &
FAKE=$!
trap 'kill $FAKE 2>/dev/null || true; adb reverse --remove tcp:$FAKE_PORT >/dev/null 2>&1 || true; adb shell wm size reset >/dev/null 2>&1 || true; adb shell wm density reset >/dev/null 2>&1 || true; adb shell cmd uimode night no >/dev/null 2>&1 || true' EXIT
for _ in $(seq 20); do curl -sf "http://127.0.0.1:$FAKE_PORT/anthropic/v1/models" >/dev/null && break; sleep 0.5; done
adb reverse tcp:$FAKE_PORT tcp:$FAKE_PORT >/dev/null

adb install -r "$APK" >/dev/null
# 390 wide: 1080 px at density 443.
adb shell wm size 1080x2400; adb shell wm density 443
adb shell pm clear "$PKG" >/dev/null; adb shell am start -n "$PKG/.MainActivity" >/dev/null
see '^.* Use this phone only$' 90
ui tap '^Use this phone only$'
see 'Chief on this phone'

# 1. Both key accounts are offered; MiniMax is picked and the screen names it throughout.
see '(\] |\{)OpenRouter\}?$'
ui tap '^MiniMax$'
see 'Paste your MiniMax key'
ui tap 'Paste your MiniMax key'; sleep 1
# Controlled inputs drop fast injected text: a few letters at a time.
for part in $(echo "$KEY" | fold -w 3); do adb shell input text "$part"; sleep 0.4; done
hide_keys
shot choice 'Billed per use by MiniMax'

# 2. Connect saves the key on the phone and offers every model the live list gives, unfiltered, the recommended one first
# and tagged, with a search box for the long list and the default named; nothing is picked yet.
ui tap '^Connect$'
see 'Which model should Chief use'
see 'Search 9 models'
see '^.*Recommended$'
for m in 'M3.1 Flash' 'M3' 'M2.7' 'M2.7 Highspeed' 'M2.5' 'M2.5 Highspeed' 'M2.1' 'M2.1 Highspeed' 'M2'; do see "(\\] |\\{)MiniMax $m\\}?\$" 5; done
shot model 'MiniMax M2.1 Highspeed'

# 3. Tapping MiniMax M3 selects it (the row is marked and the button names it); confirming keeps it: Chief's chat opens and
# its header names the model.
ui tap '^MiniMax M3$'
see '^.*Use MiniMax M3$'
shot picked 'Use MiniMax M3'
ui tap '^Use MiniMax M3$'
see 'Ask Chief anything' 30
see '\] MiniMax M3$'
shot chat 'Ask Chief anything'

# 4. Sign out removes the key: Use this phone only asks for a key again.
ui tap '^Sign out$'; see 'Sign out of Chief'
# The confirm's own button is the last Sign out on screen (the header's sits under the dialog).
read -r x1 y1 x2 y2 < <(ui texts | grep -E '\] (SIGN OUT|Sign out)$' | tail -1 | sed -E 's/.*\[([0-9]+),([0-9]+),([0-9]+),([0-9]+)\].*/\1 \2 \3 \4/')
adb shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
see '^.* Use this phone only$'
ui tap '^Use this phone only$'
see 'Chief on this phone'
see 'Paste your OpenRouter key'

node "$VERIFY_DIR/steps.mjs" "$OUT" phone-only-minimax
ls "$OUT"/*.png "$OTHER"/*.png | sort -u
