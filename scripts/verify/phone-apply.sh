#!/usr/bin/env bash
# The application hand-off on the phone (docs/verification/jobs-apply.md): the release app on a task-owned emulator paired to
# a stub-engine crewd whose writer has the real pinned browser, and a local posting with its own form. Umer opens Chief's
# card, taps Fill it in for me, opens the filled form's card, answers his own questions there and taps Submit; the posting
# records what it got and the role is Applied. The writer's turn is scripted (jobs-apply.mjs fill); the gate, crewd's
# reading of the page and its one press of Submit are real. Records phone-apply.mp4 with stills of each step.
#   BROWSER_TOOLS=<tools-dir> bash scripts/verify/phone-apply.sh <out-dir> [release-x86_64.apk]
# Needs the Android SDK, /usr/bin/chromium and the APK (cd mobile/android && ./gradlew assembleRelease
# -PreactNativeArchitectures=x86_64, through fm-mem-gate). adb runs under the scratch HOME, with its own keys and server.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUT=$(realpath -m "${1:?out dir}") APK=$(realpath "${2:-$REPO/mobile/android/app/build/outputs/apk/release/app-x86_64-release.apk}")
[ -n "${BROWSER_TOOLS:-}" ] && [ -e "$BROWSER_TOOLS/bin/playwright-axi" ] || { echo "phone-apply: set BROWSER_TOOLS to a tools folder with the browser installed" >&2; exit 2; }
S=${FM_SCRATCH:-$HOME/.cache/fm-scratch}/phone-apply-$$; SER=emulator-5594
export PATH=${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools:${ANDROID_HOME:-$HOME/Android/Sdk}/emulator:/usr/bin:$PATH \
  ANDROID_HOME=${ANDROID_HOME:-$HOME/Android/Sdk} HOME=$S/home ANDROID_USER_HOME=$S/android-user ANDROID_AVD_HOME=$S/android-user/avd \
  ANDROID_ADB_SERVER_PORT=5149 LAB=$S/lab SERIAL=$SER
mkdir -p "$OUT/screens" "$ANDROID_AVD_HOME" "$HOME"
EMU= POSTING= REC=
cleanup() {
  [ -z "$REC" ] || kill "$REC" 2>/dev/null || true
  [ -z "$POSTING" ] || kill "$POSTING" 2>/dev/null || true
  adb -s $SER emu kill >/dev/null 2>&1 || true
  bash "$REPO/scripts/verify/pair-lab.sh" down >/dev/null 2>&1 || true
  [ -n "$EMU" ] && wait "$EMU" 2>/dev/null || true
  adb kill-server >/dev/null 2>&1 || true
  chmod -R u+w "$S" 2>/dev/null || true; rm -rf -- "$S"
}
trap cleanup EXIT
echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n apply1 -k "system-images;android-36;google_apis;x86_64" -d pixel_6 >/dev/null 2>&1
${FM_MEM_GATE:-} emulator -avd apply1 -port 5594 -no-window -gpu swiftshader_indirect -memory 2048 -cores 2 -no-audio -no-boot-anim -no-snapshot-save >"$S/emu.log" 2>&1 &
EMU=$!
for _ in $(seq 400); do [ "$(adb -s $SER shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break; sleep 3; done
[ "$(adb -s $SER shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || { echo "the emulator never booted" >&2; tail -5 "$S/emu.log" >&2; exit 1; }
bash "$REPO/scripts/verify/pair-lab.sh" up "$REPO" >/dev/null
ln -s "$BROWSER_TOOLS/bin" "$LAB/tools/bin"; ln -s "$BROWSER_TOOLS/browser" "$LAB/tools/browser"
. "$LAB/env"; KEY=$(cat "$LAB/state/person.key")
PPORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
node "$REPO/scripts/verify/jobs-apply.mjs" serve "$PPORT" "$LAB/sent.json" & POSTING=$!
node "$REPO/scripts/verify/phone-pair-typed.mjs" --serial $SER --apk "$APK"
drive() { local s=$1; shift; node "$REPO/scripts/verify/jobs-apply.mjs" "$s" "$B" "$KEY" "$@"; }
drive board "http://127.0.0.1:$PPORT/job/1" Northwind 'Frontend Engineer' '£55,000 to £65,000 a year' >/dev/null
# Recorded from here (pairing is never in the clip): 170 s pieces until the stop file, joined afterwards.
adb -s $SER shell 'rm -f /sdcard/apply-stop /sdcard/apply-*.mp4; i=0; while [ ! -e /sdcard/apply-stop ]; do screenrecord --time-limit 170 /sdcard/apply-$i.mp4; i=$((i+1)); done' & REC=$!
drive phone "$OUT" "$LAB"
adb -s $SER shell touch /sdcard/apply-stop; sleep 1; adb -s $SER shell pkill -INT -x screenrecord || true
wait "$REC" 2>/dev/null || true; REC=
for f in $(adb -s $SER shell ls /sdcard/ | tr -d '\r' | grep '^apply-.*\.mp4$' | sort -t- -k2 -n); do adb -s $SER pull "/sdcard/$f" "$S/$f" >/dev/null; echo "file '$S/$f'"; done >"$S/list.txt"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$S/list.txt" -c copy "$OUT/phone-apply.mp4"
cp "$LAB/sent.json" "$OUT/sent.json"
node "$REPO/scripts/verify/steps.mjs" "$OUT" phone-apply
echo "phone-apply: ok"
