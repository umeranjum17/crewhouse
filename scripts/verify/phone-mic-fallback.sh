#!/usr/bin/env bash
# Speaking to Chief on a phone with no on-device speech pack (docs/verification/voice.md): the release app on a task-owned
# emulator paired to a stub-engine crewd; the person taps the mic on Home and the phone's speech service opens the mic
# (a stop button in the box) instead of the "can't hear yet" toast.
#   bash scripts/verify/phone-mic-fallback.sh <out-dir> [release-x86_64.apk]
# Needs the Android SDK, a built web/dist and the APK (cd mobile/android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64,
# through fm-mem-gate). No audio goes in: the proof is that the listener opens after the on-device recogniser reports no pack.
# Writes mic-listening-no-pack-phone-390.png, logcat.txt and steps.json in <out-dir>.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUT=$(realpath -m "${1:?out dir}") APK=$(realpath "${2:-$REPO/mobile/android/app/build/outputs/apk/release/app-x86_64-release.apk}")
S=${FM_SCRATCH:-$HOME/.cache/fm-scratch}/phone-mic-fallback-$$; SER=emulator-5586
export PATH=/usr/bin:$PATH ANDROID_USER_HOME=$S/android-user ANDROID_AVD_HOME=$S/android-user/avd LAB=$S/lab SERIAL=$SER
mkdir -p "$OUT" "$ANDROID_AVD_HOME"
EMU=
cleanup() {
  adb -s $SER emu kill >/dev/null 2>&1 || true
  bash "$REPO/scripts/verify/pair-lab.sh" down >/dev/null 2>&1 || true
  [ -n "$EMU" ] && wait "$EMU" 2>/dev/null || true
  chmod -R u+w "$S" 2>/dev/null || true; rm -rf -- "$S"
}
trap cleanup EXIT
echo no | "${ANDROID_HOME:-$HOME/Android/Sdk}/cmdline-tools/latest/bin/avdmanager" create avd -n mic1 -k "system-images;android-36;google_apis;x86_64" -d pixel_6 >/dev/null
GATE=${FM_MEM_GATE:-}
$GATE emulator -avd mic1 -port 5586 -no-window -gpu swiftshader_indirect -memory 2048 -cores 2 -no-audio -no-boot-anim -no-snapshot-save >"$S/emu.log" 2>&1 &
EMU=$!
for _ in $(seq 120); do [ "$(adb -s $SER shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break; sleep 3; done
bash "$REPO/scripts/verify/pair-lab.sh" up "$REPO" >/dev/null
node "$REPO/scripts/verify/phone-pair-typed.mjs" --serial $SER --apk "$APK"
adb -s $SER shell pm grant dev.crewhouse.app android.permission.RECORD_AUDIO
adb -s $SER logcat -c
P="node $REPO/scripts/verify/phone-ui.mjs"
$P tap 'Speak to Chief'
for _ in $(seq 30); do adb -s $SER logcat -d | grep -q 'RecognitionService#onStartOfSpeech' && break; sleep 1; done
$P texts | grep -q 'Stop listening' || { echo "the mic did not open a listener" >&2; exit 1; }
$P texts | grep -qi "can't hear yet" && { echo "the not-ready toast showed" >&2; exit 1; }
$P shot "$OUT/mic-listening-no-pack-phone-390.png"
adb -s $SER logcat -d | grep -i 'SodaSpeechRecognizer\|onStartOfSpeech' | cut -c1-200 >"$OUT/logcat.txt"
grep -q 'error 13' "$OUT/logcat.txt" || { echo "this emulator had a pack: the no-pack case was not exercised" >&2; exit 1; }
node "$REPO/scripts/verify/steps.mjs" "$OUT" phone-mic-fallback
