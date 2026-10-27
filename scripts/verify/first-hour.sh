#!/usr/bin/env bash
# The captain's first hour (docs/verification/jobs-loop.md): the release app on a task-owned emulator, paired to a crewd on
# the real pinned OpenClaw engine with the scripted local model first-hour-model.ts (fixed words, no AI account). Umer
# sends his CV PDF with "find me good stuff", taps Start and watches Rae's look land in Chief's chat; then Rae's chat.
#   bash scripts/verify/first-hour.sh <out-dir> [release-x86_64.apk]   (Android SDK, chromium, pdftotext, the network)
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUT=$(realpath -m "${1:?out dir}") APK=$(realpath "${2:-$REPO/mobile/android/app/build/outputs/apk/release/app-x86_64-release.apk}")
S=${FM_SCRATCH:-$HOME/.cache/fm-scratch}/first-hour-$$; SER=emulator-5596
export PATH=${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools:${ANDROID_HOME:-$HOME/Android/Sdk}/emulator:/usr/bin:/bin:$PATH \
  ANDROID_HOME=${ANDROID_HOME:-$HOME/Android/Sdk} HOME=$S/home ANDROID_USER_HOME=$S/android-user ANDROID_AVD_HOME=$S/android-user/avd \
  ANDROID_ADB_SERVER_PORT=5151 LAB=$S/lab SERIAL=$SER
mkdir -p "$OUT/screens" "$ANDROID_AVD_HOME" "$HOME"
EMU= MODEL= REC=
cleanup() {
  [ -z "$REC" ] || kill "$REC" 2>/dev/null || true
  adb -s $SER emu kill >/dev/null 2>&1 || true
  bash "$REPO/scripts/verify/pair-lab.sh" down >/dev/null 2>&1 || true
  [ -z "$MODEL" ] || kill "$MODEL" 2>/dev/null || true
  [ -n "$EMU" ] && wait "$EMU" 2>/dev/null || true
  adb kill-server >/dev/null 2>&1 || true
  chmod -R u+w "$S" 2>/dev/null || true; rm -rf -- "$S"
}
trap cleanup EXIT
echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n hour1 -k "system-images;android-36;google_apis;x86_64" -d pixel_6 >/dev/null 2>&1
${FM_MEM_GATE:-} emulator -avd hour1 -port 5596 -no-window -gpu swiftshader_indirect -memory 2048 -cores 2 -no-audio -no-boot-anim -no-snapshot-save >"$S/emu.log" 2>&1 &
EMU=$!
# His CV as the PDF he sends: the journey's CV lines (jobs-cv.txt), printed by chromium into Downloads on the phone.
{ echo '<!doctype html><meta charset=utf-8><body style="font:12pt sans-serif">'; sed 's/.*/<p>&<\/p>/' "$REPO/scripts/verify/jobs-cv.txt"; } >"$S/cv.html"
chromium --headless=new --no-sandbox --user-data-dir="$S/cv-profile" --no-pdf-header-footer --print-to-pdf="$S/Umer_CV.pdf" "file://$S/cv.html" >/dev/null 2>&1
node "$REPO/scripts/verify/first-hour-model.ts" "$S/model.url" >"$S/model.log" 2>&1 & MODEL=$!
for _ in $(seq 120); do [ -s "$S/model.url" ] && break; sleep 0.5; done
[ -s "$S/model.url" ] || { echo "first-hour: the scripted model never started" >&2; cat "$S/model.log" >&2; exit 1; }
for _ in $(seq 400); do [ "$(adb -s $SER shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break; sleep 3; done
[ "$(adb -s $SER shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || { echo "the emulator never booted" >&2; tail -5 "$S/emu.log" >&2; exit 1; }
LAB_MODEL=$(cat "$S/model.url") bash "$REPO/scripts/verify/pair-lab.sh" up "$REPO" >/dev/null
for _ in $(seq 600); do grep -q 'engine ready' "$LAB/crewd.log" && break; sleep 1; done
grep -q 'engine ready' "$LAB/crewd.log" || { echo "first-hour: the engine never became ready" >&2; tail -5 "$LAB/crewd.log" >&2; exit 1; }
. "$LAB/env"
node "$REPO/scripts/verify/phone-pair-typed.mjs" --serial $SER --apk "$APK"
# What the crew already knows of him: his name and his job-search strategy, kept in the profile every helper reads.
c() { curl -fsS -H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $(cat "$LAB/state/person.key")" "$@" >/dev/null; }
c -X POST --data '{"address":"Umer"}' "$B/api/onboard"
c -X PUT --data '{"text":"Looking for a job: remote-first, companies that are a way into AI, fast hiring processes."}' "$B/api/profile"
adb -s $SER push "$S/Umer_CV.pdf" /sdcard/Download/Umer_CV.pdf >/dev/null
adb -s $SER shell content call --method scan_volume --uri content://media --arg external_primary >/dev/null 2>&1 || true # the picker lists it
# Recorded from here: 170 s pieces until the stop file, joined afterwards.
adb -s $SER shell 'rm -f /sdcard/hour-stop /sdcard/hour-*.mp4; i=0; while [ ! -e /sdcard/hour-stop ]; do screenrecord --time-limit 170 /sdcard/hour-$i.mp4; i=$((i+1)); done' & REC=$!
# HOLD=1 keeps the phone and the lab up after a failed step until <out>/.release appears (adb under this script's HOME).
node "$REPO/scripts/verify/first-hour.mjs" "$OUT" "$LAB" || { echo "first-hour: held at $S" >&2; [ -z "${HOLD:-}" ] || until [ -e "$OUT/.release" ]; do sleep 2; done; exit 1; }
adb -s $SER shell touch /sdcard/hour-stop; sleep 1; adb -s $SER shell pkill -INT -x screenrecord || true
wait "$REC" 2>/dev/null || true; REC=
for f in $(adb -s $SER shell ls /sdcard/ | tr -d '\r' | grep '^hour-.*\.mp4$' | sort -t- -k2 -n); do adb -s $SER pull "/sdcard/$f" "$S/$f" >/dev/null; echo "file '$S/$f'"; done >"$S/list.txt"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$S/list.txt" -c copy "$OUT/first-hour.mp4"
cp "$LAB/crewd.log" "$OUT/crewd.log"
node "$REPO/scripts/verify/steps.mjs" "$OUT" first-hour
echo "first-hour: ok"
