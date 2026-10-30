#!/usr/bin/env bash
# Unlink boat.dev on the phone, against the kit's fake boat.dev (boat-fake-lab.mjs, no computer in the account): the account's
# list offers Unlink boat.dev, the confirmation names what happens, boat.dev cannot be reached (the phone's route to it is cut),
# the app says nothing was removed and offers Try again, and once boat.dev answers the key is ended there and the phone
# is signed out, and stays signed out after the app is closed and opened again. Each state is captured at 390 wide, day and
# night. No real boat.dev, no money, no model (docs/verification/chief-computer.md).
#
#   SERIAL=emulator-5580 [CLOUD_OTHER=<dir>] bash scripts/verify/cloud-unlink.sh <out-dir> <lab APK>
#   fm-device-lock.sh <serial> env CLOUD_UNLINK_UNDER_LOCK=<serial> bash scripts/verify/cloud-unlink.sh <out-dir> <lab APK>
# A physical device is never taken without asking Main first. A locked invocation proceeds only while the lock
# held by fm-device-lock.sh is still held.
#
# A judged run reads every capture in <out-dir> against one claim, so <out-dir> holds the one claimed state (and the step
# record): CLOUD_CLAIM names it (list, confirm, unreachable or signed-out; default unreachable). Every other state goes to
# CLOUD_OTHER when it is set, else beside it. The APK is built with EXPO_PUBLIC_CREWHOUSE_BOAT_API=http://127.0.0.1:7411/api/v1
# and no cloud-enable variable. The lab key is typed into the pairing-code field and copied from there (the key box only reads
# the clipboard); no screen is read while that field holds it, and the lab log says only whether the key is ended, never the key.
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: SERIAL=<emulator> cloud-unlink.sh <out-dir> <apk>" >&2; exit 2; }
OUT=$1; APK=$2; : "${SERIAL:?set SERIAL to the emulator}"
case "$SERIAL" in
  emulator-*) ;;
  *)
    LOCK_DIR=${FM_PHONE_LOCK_DIR:-/tmp}
    LOCK_FILE="$LOCK_DIR/fm-phone-$SERIAL.lock"
    LOCK_HELD=0
    if [ "${CLOUD_UNLINK_UNDER_LOCK:-}" = "$SERIAL" ] && exec 9>"$LOCK_FILE"; then
      if flock -n 9; then exec 9>&-; else LOCK_HELD=1; exec 9>&-; fi
    fi
    if [ "$LOCK_HELD" -ne 1 ]; then
      echo "cloud-unlink: $SERIAL is a physical device and the device lock is not held" >&2
      exit 2
    fi
    ;;
esac
OTHER=${CLOUD_OTHER:-$OUT} CLAIM=${CLOUD_CLAIM:-unreachable}
VERIFY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$VERIFY_DIR" rev-parse --show-toplevel)
PKG=dev.crewhouse.app KEY=lab-key-abcdefgh
mkdir -p "$OUT" "$OTHER"
adb() { command adb -s "$SERIAL" "$@"; }
ui() { SERIAL=$SERIAL node "$VERIFY_DIR/phone-ui.mjs" "$@"; }
see() { for _ in $(seq "${2:-30}"); do ui texts 2>/dev/null | grep -qE -- "$1" && return 0; sleep 1; done; ui texts >&2 || true; echo "cloud-unlink: never saw: $1" >&2; return 1; }
shot() {
  local dir; dir=$([ "$1" = "$CLAIM" ] && echo "$OUT" || echo "$OTHER")
  for theme in day night; do
    adb shell cmd uimode night "$([ $theme = night ] && echo yes || echo no)" >/dev/null
    see "$2" 15
    sleep 1
    ui shot "$dir/unlink-$1-$theme-390.png"
  done
  adb shell cmd uimode night no >/dev/null
}

LAB=$(mktemp -d -t cloud-unlink.XXXXXX)
. "$(dirname "${BASH_SOURCE[0]}")/crewd-group.sh"
(cd "$REPO" && exec env LAB_EMPTY=1 LAB_PORT=7411 LAB_DIR="$LAB" HOME="$LAB" node "$VERIFY_DIR/boat-fake-lab.mjs") > "$LAB/lab.log" 2>&1 & LABPID=$!
trap 'kill "$LABPID" 2>/dev/null || true; wait "$LABPID" 2>/dev/null || true; adb reverse --remove tcp:7411 >/dev/null 2>&1 || true; [ -z "${FAKE_PORT:-}" ] || adb reverse --remove "tcp:$FAKE_PORT" >/dev/null 2>&1 || true; adb shell settings put system font_scale 1.0 >/dev/null 2>&1 || true; adb shell wm size reset >/dev/null 2>&1 || true; adb shell wm density reset >/dev/null 2>&1 || true; cp "$LAB/lab.log" "$OTHER/lab.log" 2>/dev/null || true; crewhouse_remove_lab "$LAB"' EXIT
for _ in $(seq 120); do grep -q 'the host is ready' "$LAB/lab.log" && break; kill -0 "$LABPID" 2>/dev/null || { cat "$LAB/lab.log" >&2; exit 1; }; sleep 1; done
grep -q 'the host is ready' "$LAB/lab.log" || { cat "$LAB/lab.log" >&2; echo "cloud-unlink: the lab's host never got ready" >&2; exit 1; }
FAKE_PORT=$(sed -n 's/^adb reverse tcp:\([0-9][0-9]*\) tcp:\1.*/\1/p' "$LAB/lab.log" | head -n 1)
[ -n "$FAKE_PORT" ] || { cat "$LAB/lab.log" >&2; echo "cloud-unlink: the lab did not report its provider port" >&2; exit 1; }
adb reverse tcp:7411 tcp:7411 >/dev/null
adb reverse "tcp:$FAKE_PORT" "tcp:$FAKE_PORT" >/dev/null
for _ in 1 2 3; do adb install -r "$APK" >/dev/null 2>&1 && break; sleep 5; done; adb shell pm path "$PKG" >/dev/null
adb shell wm size 1080x2400; adb shell wm density 443
open_app() { adb shell pm clear "$PKG" >/dev/null; adb shell am start -n "$PKG/.MainActivity" >/dev/null; see 'Cloud$'; }
paste_key() {
  ui tap '^My computer$'; see 'Type the code'; ui tap '^Type the code$'; see 'Pairing code'; ui tap 'Pairing code'
  for part in $(echo "$KEY" | fold -w 3); do adb shell input text "$part"; sleep 0.4; done
  adb shell input keycombination 113 29; adb shell input keycombination 113 31; sleep 1
  for _ in $(seq 20); do adb shell input keyevent 67; done
  adb shell dumpsys input_method | grep -q 'mInputShown=true' && adb shell input keyevent 4
  ui tap '^Back$'; sleep 1; ui tap-if '^Back$'; see 'Cloud$'
  ui tap '^Cloud$'; see 'Sign in to boat.dev'; ui tap 'Other ways'; see 'Paste a boat.dev key'; ui tap 'Paste a boat.dev key'; see 'Paste key'; ui tap '^Paste key$'
}
ended() { grep -q 'the lab key is ended at boat.dev: true' "$LAB/lab.log"; }

# 1. Signed in, the account's list (no computer) offers Unlink boat.dev under the picks.
open_app; paste_key
see "didn’t find a computer"
shot list 'Unlink boat.dev'
# 2. One confirmation, in the app's own words, naming what will happen.
ui tap '^Unlink boat.dev$'
see 'Unlink boat\.dev\?'
shot confirm 'Chief will lose access'
# 3. boat.dev cannot be reached: nothing is removed, the key is still live, and Try again is offered.
adb reverse --remove tcp:7411 >/dev/null
ui tap '^(Unlink|UNLINK)$'
see 'nothing was removed'
! ended || { echo "cloud-unlink: the key was ended with boat.dev unreachable" >&2; exit 1; }
shot unreachable 'nothing was removed'
# 3b. Repeat the failed unlink at 360 dp with the largest font. Configure the
# display before opening the account screen; phone-ui taps accessibility bounds.
adb shell settings put system font_scale 2.0
adb shell wm size 1080x2400
adb shell wm density 480
adb reverse tcp:7411 tcp:7411 >/dev/null
adb shell am force-stop "$PKG"; adb shell am start -n "$PKG/.MainActivity" >/dev/null
see 'Cloud$'; ui tap '^Cloud$'
# The account card is taller than the 360 dp viewport at font scale 2.0.
# Reveal its lower actions before resolving the Unlink row from accessibility bounds.
adb shell input swipe 540 2050 540 500 500
see 'Unlink boat.dev'; ui tap '^Unlink boat.dev$'
see 'Unlink boat\.dev\?'; adb reverse --remove tcp:7411 >/dev/null
ui tap '^(Unlink|UNLINK)$'; see 'nothing was removed'
for theme in day night; do
  adb shell cmd uimode night "$([ "$theme" = night ] && echo yes || echo no)" >/dev/null
  see 'nothing was removed' 15; sleep 1
  ui shot "$OTHER/unlink-unreachable-360-largefont-$theme.png"
done
adb shell cmd uimode night no >/dev/null
# 4. Back in reach, Try again: boat.dev ends the key first, then the phone is signed out.
adb reverse tcp:7411 tcp:7411 >/dev/null
ui tap '^Try again$'
see 'boat.dev email'
for _ in $(seq 20); do ended && break; sleep 1; done
ended || { cat "$LAB/lab.log" >&2; echo "cloud-unlink: boat.dev never saw the key ended" >&2; exit 1; }
shot signed-out 'boat.dev email'
# 5. Closed and opened again: still signed out (a kept key would go straight to the account's list).
adb shell am force-stop "$PKG"; adb shell am start -n "$PKG/.MainActivity" >/dev/null
see 'Cloud$'; ui tap '^Cloud$'; see 'boat.dev email'
! ui texts | grep -q 'Which computer\|didn’t find a computer' || { echo "cloud-unlink: the phone still holds the key" >&2; exit 1; }

node "$VERIFY_DIR/steps.mjs" "$OUT" cloud-unlink
ls "$OUT"/*.png "$OTHER"/*.png | sort -u
