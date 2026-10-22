#!/usr/bin/env bash
# The phone's cloud screen on the kit's fake boat.dev (boat-fake-lab.mjs, no computer in the account): Make a new
# computer, a failed install and its Try again, ready, then a second phone on that computer. Each state is captured
# at 390 wide, day and night. No real boat.dev, no money, no model (docs/verification/cloud-screen.md).
#
#   SERIAL=emulator-5580 bash scripts/verify/cloud-screen.sh <out-dir> <lab APK>
#
# The emulator is the caller's (started and stopped by them); the APK is built with EXPO_PUBLIC_CREWHOUSE_CLOUD=1 and
# EXPO_PUBLIC_CREWHOUSE_BOAT_API=http://127.0.0.1:7411/api/v1. The emulator has no shell clipboard and the key box
# only reads it, so the lab key is typed into the pairing-code field and copied from there.
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: SERIAL=<emulator> cloud-screen.sh <out-dir> <apk>" >&2; exit 2; }
OUT=$1; APK=$2; : "${SERIAL:?set SERIAL to the emulator}"
VERIFY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$VERIFY_DIR" rev-parse --show-toplevel)
PKG=dev.crewhouse.app KEY=lab-key-abcdefgh
mkdir -p "$OUT"
adb() { command adb -s "$SERIAL" "$@"; }
ui() { SERIAL=$SERIAL node "$VERIFY_DIR/phone-ui.mjs" "$@"; }
# Wait at most $2 seconds for a text on screen.
see() { for _ in $(seq "${2:-30}"); do ui texts 2>/dev/null | grep -qE -- "$1" && return 0; sleep 1; done; ui texts >&2 || true; echo "cloud-screen: never saw: $1" >&2; return 1; }
# One state, day and night, at 390 wide.
shot() {
  for theme in day night; do
    adb shell cmd uimode night "$([ $theme = night ] && echo yes || echo no)" >/dev/null
    see "$2" 15
    sleep 1
    ui shot "$OUT/cloud-$1-$theme-390.png"
  done
  adb shell cmd uimode night no >/dev/null
}

LAB=$(mktemp -d -t cloud-screen.XXXXXX)
(cd "$REPO" && exec env LAB_EMPTY=1 LAB_PORT=7411 LAB_DIR="$LAB" HOME="$LAB" node "$VERIFY_DIR/boat-fake-lab.mjs") > "$LAB/lab.log" 2>&1 & LABPID=$!
trap 'kill "$LABPID" 2>/dev/null || true; wait "$LABPID" 2>/dev/null || true; adb reverse --remove tcp:7411 >/dev/null 2>&1 || true; adb shell wm size reset >/dev/null 2>&1 || true; adb shell wm density reset >/dev/null 2>&1 || true; cp "$LAB/lab.log" "$OUT/lab.log" 2>/dev/null || true; chmod -R u+w "$LAB" 2>/dev/null; rm -rf -- "$LAB"' EXIT
for _ in $(seq 120); do grep -q 'the host is ready' "$LAB/lab.log" && break; kill -0 "$LABPID" 2>/dev/null || { cat "$LAB/lab.log" >&2; exit 1; }; sleep 1; done
grep -q 'the host is ready' "$LAB/lab.log" || { cat "$LAB/lab.log" >&2; echo "cloud-screen: the lab's host never got ready" >&2; exit 1; }

adb reverse tcp:7411 tcp:7411 >/dev/null
adb install -r "$APK" >/dev/null
# 390 wide: 1080 px at density 443.
adb shell wm size 1080x2400; adb shell wm density 443
open_app() { adb shell pm clear "$PKG" >/dev/null; adb shell am start -n "$PKG/.MainActivity" >/dev/null; see '^.* In my cloud$'; }
paste_key() {
  ui tap '^Pair with my computer$'; see 'Pairing code'; ui tap 'Pairing code'; sleep 1
  # Controlled inputs drop fast injected text: a few letters at a time.
  for part in $(echo "$KEY" | fold -w 3); do adb shell input text "$part"; sleep 0.4; done
  see "$KEY"
  adb shell input keycombination 113 29; adb shell input keycombination 113 31; sleep 1
  for _ in $(seq 20); do adb shell input keyevent 67; done
  adb shell dumpsys input_method | grep -q 'mInputShown=true' && adb shell input keyevent 4
  ui tap '^Back$'; see '^.* In my cloud$'
  ui tap '^In my cloud$'; see 'Paste key'; ui tap '^Paste key$'
}

# 1. A new account has no computer: the pick card says so, and Make a new computer is the way in.
open_app; paste_key
see "didn’t find a computer"
ui tap 'Make a new computer instead'
shot make 'Make it and set it up'
# 2. Make it, with the install failing: the stopped row says which step and that Try again is safe.
touch "$LAB/install-fails"; sleep 1
ui tap 'Make it and set it up'
shot failed 'Installing Chief stopped partway'
# 3. Try again once the install can pass: ready.
rm -f "$LAB/install-fails"; sleep 1
ui tap '^Try again$'
shot ready 'Chief is on your cloud computer'
# 4. A second phone (this app cleared: a new phone key) on that same computer: no move offered.
open_app; paste_key
see 'Use this computer'
ui tap '^Use this computer$'
shot second-phone 'set up with another phone'

node "$VERIFY_DIR/steps.mjs" "$OUT" cloud-screen
ls "$OUT"/*.png
