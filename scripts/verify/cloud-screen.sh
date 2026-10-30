#!/usr/bin/env bash
# The phone's cloud screen on the kit's fake boat.dev (boat-fake-lab.mjs, no computer in the account): Make a new
# computer, a failed install and its Try again, ready, then a second phone on that computer moving Chief to itself
# (offered, confirmed, moved). Each state is captured
# at 390 wide, day and night. No real boat.dev, no money, no model (docs/verification/cloud-screen.md).
#
#   SERIAL=emulator-5580 [CLOUD_OTHER=<dir>] bash scripts/verify/cloud-screen.sh <out-dir> <lab APK>
#
# A judged run reads every capture in <out-dir> against one claim, so <out-dir> holds the one claimed state (and the step
# record): CLOUD_CLAIM names it (make, failed, ready, second-phone, move-confirm or moved; default second-phone, the
# offer to move Chief). Every other state and the lab's log go to CLOUD_OTHER when it is set, else beside it.
#
# The emulator is the caller's (started and stopped by them); the APK has no cloud-enable variable, only
# EXPO_PUBLIC_CREWHOUSE_BOAT_API=http://127.0.0.1:7411/api/v1. The emulator has no shell clipboard and the key box
# only reads it, so the lab key is typed into the pairing-code field and copied from there.
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: SERIAL=<emulator> cloud-screen.sh <out-dir> <apk>" >&2; exit 2; }
OUT=$1; APK=$2; : "${SERIAL:?set SERIAL to the emulator}"; OTHER=${CLOUD_OTHER:-$OUT} CLAIM=${CLOUD_CLAIM:-second-phone}
VERIFY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$VERIFY_DIR" rev-parse --show-toplevel)
PKG=dev.crewhouse.app KEY=lab-key-abcdefgh
mkdir -p "$OUT" "$OTHER"
adb() { command adb -s "$SERIAL" "$@"; }
ui() { SERIAL=$SERIAL node "$VERIFY_DIR/phone-ui.mjs" "$@"; }
# Wait at most $2 seconds for a text on screen.
see() { for _ in $(seq "${2:-30}"); do ui texts 2>/dev/null | grep -qE -- "$1" && return 0; sleep 1; done; ui texts >&2 || true; echo "cloud-screen: never saw: $1" >&2; return 1; }
# One state, day and night, at 390 wide: the claimed one into the run's own folder, the rest into CLOUD_OTHER.
shot() {
  local dir; dir=$([ "$1" = "$CLAIM" ] && echo "$OUT" || echo "$OTHER")
  for theme in day night; do
    adb shell cmd uimode night "$([ $theme = night ] && echo yes || echo no)" >/dev/null
    see "$2" 15
    sleep 1
    ui shot "$dir/cloud-$1-$theme-390.png"
  done
  adb shell cmd uimode night no >/dev/null
}

LAB=$(mktemp -d -t cloud-screen.XXXXXX)
. "$(dirname "${BASH_SOURCE[0]}")/crewd-group.sh"
(cd "$REPO" && exec env LAB_EMPTY=1 LAB_PORT=7411 LAB_DIR="$LAB" HOME="$LAB" node "$VERIFY_DIR/boat-fake-lab.mjs") > "$LAB/lab.log" 2>&1 & LABPID=$!
trap 'kill "$LABPID" 2>/dev/null || true; wait "$LABPID" 2>/dev/null || true; adb reverse --remove tcp:7411 >/dev/null 2>&1 || true; [ -z "${FAKE_PORT:-}" ] || adb reverse --remove "tcp:$FAKE_PORT" >/dev/null 2>&1 || true; adb shell wm size reset >/dev/null 2>&1 || true; adb shell wm density reset >/dev/null 2>&1 || true; cp "$LAB/lab.log" "$OTHER/lab.log" 2>/dev/null || true; crewhouse_remove_lab "$LAB"' EXIT
for _ in $(seq 120); do grep -q 'the host is ready' "$LAB/lab.log" && break; kill -0 "$LABPID" 2>/dev/null || { cat "$LAB/lab.log" >&2; exit 1; }; sleep 1; done
grep -q 'the host is ready' "$LAB/lab.log" || { cat "$LAB/lab.log" >&2; echo "cloud-screen: the lab's host never got ready" >&2; exit 1; }

# The phone reaches the fake through 7411, but the fake's OAuth metadata and claim
# links advertise its own listener port. Reverse that port too so the phone can
# poll the provider after the person approves the code.
FAKE_PORT=$(sed -n 's/^adb reverse tcp:\([0-9][0-9]*\) tcp:\1.*/\1/p' "$LAB/lab.log" | head -n 1)
[ -n "$FAKE_PORT" ] || { cat "$LAB/lab.log" >&2; echo "cloud-screen: the lab did not report its provider port" >&2; exit 1; }
adb reverse tcp:7411 tcp:7411 >/dev/null
adb reverse "tcp:$FAKE_PORT" "tcp:$FAKE_PORT" >/dev/null
adb install -r "$APK" >/dev/null
# 390 wide: 1080 px at density 443.
adb shell wm size 1080x2400; adb shell wm density 443
open_app() { adb shell pm clear "$PKG" >/dev/null; adb shell am start -n "$PKG/.MainActivity" >/dev/null; see '^.* Cloud$'; }
paste_key() {
  ui tap '^My computer$'; see 'Pairing code'; ui tap 'Pairing code'
  # Controlled inputs drop fast injected text: a few letters at a time.
  for part in $(echo "$KEY" | fold -w 3); do adb shell input text "$part"; sleep 0.4; done
  see "$KEY"
  adb shell input keycombination 113 29; adb shell input keycombination 113 31; sleep 1
  for _ in $(seq 20); do adb shell input keyevent 67; done
  adb shell dumpsys input_method | grep -q 'mInputShown=true' && adb shell input keyevent 4
  ui tap '^Back$'; see '^.* Cloud$'
  # The front door is the code sign-in; a key already held is pasted from Other ways (advanced).
  ui tap '^Cloud$'; see 'Sign in to boat.dev'; ui tap 'Other ways'; see 'Paste a boat.dev key'; ui tap 'Paste a boat.dev key'; see 'Paste key'; ui tap '^Paste key$'
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
# Set up, the title stands alone: the key-first lede is for the steps before it.
! ui texts | grep -q 'lets me set up your computer' || { echo "cloud-screen: the set-up screen still shows the key lede" >&2; exit 1; }
# 4. A second phone (this app cleared: a new phone key) on that same computer is offered the move, confirms it, and
#    Chief moves here: the computer's own host revokes the first phone.
open_app; paste_key
see 'Use this computer'
ui tap '^Use this computer$'
see 'Move Chief to this phone'; adb shell input swipe 540 1700 540 1250 400; sleep 1 # both buttons above the fold
shot second-phone 'Move Chief to this phone'
ui tap '^Move Chief to this phone$'
shot move-confirm 'loses access to Chief at once'
ui tap '^Yes, move Chief$'
shot moved 'Your cloud computer'

node "$VERIFY_DIR/steps.mjs" "$OUT" cloud-screen
ls "$OUT"/*.png "$OTHER"/*.png | sort -u
