#!/usr/bin/env bash
# News with the app closed on Android, no push credential (docs/verification/phone-news.md): the release app on a
# task-owned emulator paired to a golden-stub crewd. The first run asks for notifications; then, with the app in the
# background, its process killed, and after a reboot with the app never opened, Chief's reply, the hire card and the new
# helper's finished job each show as a notification that opens that chat or card.
#   bash scripts/verify/phone-news.sh <out-dir> [release-x86_64.apk]
# Needs the Android SDK, a built web/dist and the APK (see phone-mic-fallback.sh). Writes the stills below and the step
# record in <out-dir>; a reboot takes a few minutes. SERIAL=<emulator> uses one already running (rebooted, never stopped).
set -euo pipefail
exec 2>&1 # a failure says why in the run's own output
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUT=$(realpath -m "${1:?out dir}") APK=$(realpath "${2:-$REPO/mobile/android/app/build/outputs/apk/release/app-x86_64-release.apk}")
S=${FM_SCRATCH:-$HOME/.cache/fm-scratch}/phone-news-$$; OWN=${SERIAL:-}; SER=${SERIAL:-emulator-5590} PKG=dev.crewhouse.app
export PATH=/usr/bin:$PATH ANDROID_USER_HOME=$S/android-user ANDROID_AVD_HOME=$S/android-user/avd LAB=$S/lab SERIAL=$SER
mkdir -p "$OUT" "$ANDROID_AVD_HOME"
EMU=
cleanup() {
  if [ -z "$OWN" ]; then adb -s $SER emu kill >/dev/null 2>&1 || true; else adb -s $SER shell cmd uimode night no >/dev/null 2>&1 || true; fi
  bash "$REPO/scripts/verify/pair-lab.sh" down >/dev/null 2>&1 || true
  [ -n "$EMU" ] && wait "$EMU" 2>/dev/null || true
  chmod -R u+w "$S" 2>/dev/null || true; rm -rf -- "$S"
}
trap cleanup EXIT
if [ -z "$OWN" ]; then
  adb devices | grep -q "^$SER" && { echo "$SER is already running" >&2; exit 1; }
  echo no | "${ANDROID_HOME:-$HOME/Android/Sdk}/cmdline-tools/latest/bin/avdmanager" create avd -n news1 -k "system-images;android-36;google_apis;x86_64" -d pixel_6 >/dev/null
  ${FM_MEM_GATE:-} emulator -avd news1 -port 5590 -no-window -gpu swiftshader_indirect -memory 2048 -cores 2 -no-audio -no-boot-anim -no-snapshot-save >"$S/emu.log" 2>&1 &
  EMU=$!
fi
booted() { for _ in $(seq 400); do [ "$(adb -s $SER shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && return 0; sleep 3; done; echo "the emulator never booted" >&2; tail -5 "$S/emu.log" >&2 || true; exit 1; }
booted
# Root, so the app's process can be killed as the phone kills it; done before the ports are carried, which it resets.
adb -s $SER root >/dev/null; adb -s $SER wait-for-device; booted
LAB_GOLDEN=1 bash "$REPO/scripts/verify/pair-lab.sh" up "$REPO" >/dev/null
. "$LAB/env"; KEY=$(<"$LAB/state/person.key")
node "$REPO/scripts/verify/phone-pair-typed.mjs" --serial $SER --apk "$APK" --ask "$OUT/news-permission-first-run-phone-390.png"
P="node $REPO/scripts/verify/phone-ui.mjs"
api() { curl -fsS -X "$1" -H x-crewhouse:1 -H "authorization: Bearer $KEY" -H content-type:application/json "$B$2" ${3:+-d "$3"}; }
say() { api POST /api/bots/chief/messages "$(node -e 'console.log(JSON.stringify({text: process.argv[1]}))' "$1")" >/dev/null; }
# A notification holding these words, as the phone lists it (only the app says them).
posted() { for _ in $(seq 90); do adb -s $SER shell dumpsys notification --noredact | grep -qF "$1" && return 0; sleep 2; done; echo "no notification saying: $1" >&2; exit 1; }
shade() { adb -s $SER shell cmd statusbar expand-notifications; sleep 2; $P shot "$OUT/$1"; }
opens() { $P tap "$1"; for _ in $(seq 30); do $P texts | grep -q "$2" && break; sleep 1; done; $P texts | grep -q "$2" || { echo "the tap did not open: $2" >&2; exit 1; }; sleep 1; $P shot "$OUT/$3"; }
away() { adb -s $SER shell input keyevent HOME; sleep 2; }
pid() { adb -s $SER shell pidof $PKG | tr -d '\r' || true; } # none while the phone restarts it
shown() { adb -s $SER shell dumpsys activity activities | grep -E 'ResumedActivity' | grep -q "$PKG"; } # on screen, not just in recents

# 1. In the background: the ongoing line says it is connected, and Chief's reply opens his chat.
away
posted 'Crewhouse is connected'
say hi
posted 'What would you like to work on?'
shade news-backgrounded-chief-reply-shade.png
opens 'What would you like to work on' 'What would you like to work on' news-chief-reply-opens-chat-phone-390.png

# 2. Killed: the phone kills the app's process; the link service comes back on its own and the hire card opens.
away
was=$(pid); adb -s $SER shell kill -9 "$was"
for _ in $(seq 90); do now=$(pid); [ -n "$now" ] && [ "$now" != "$was" ] && break; sleep 2; done
[ -n "$now" ] && [ "$now" != "$was" ] || { echo "the link service did not come back after the kill" >&2; exit 1; }
shown && { echo "the app's screen is open: not a closed app" >&2; exit 1; }
sleep 5; posted 'Crewhouse is connected'
say 'I need someone to sort out my invoices'
posted 'Invoice Ivy'
shade news-killed-hire-card-shade.png
opens 'Invoice Ivy' 'Invoice Ivy' news-hire-card-opens-card-phone-390.png
away
ask=$(api GET /api/state | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).asks.find(a=>a.state==="open"&&/Invoice Ivy/.test(a.title)).id))')
api POST "/api/asks/$ask/answer" '{"answer":"allow"}' >/dev/null
posted 'Invoice Ivy finished'
shade news-helper-finished-shade.png
opens 'Invoice Ivy finished' 'two are due this week' news-finished-opens-chat-phone-390.png

# 3. After a reboot, the app never opened: the link is back on its own, in dark mode, and Chief's reply shows.
adb -s $SER shell cmd uimode night yes >/dev/null
adb -s $SER reboot; adb -s $SER wait-for-device; booted
adb -s $SER root >/dev/null; adb -s $SER wait-for-device; booted
for port in $LINK_PORT ${RELAY##*:}; do adb -s $SER reverse tcp:$port tcp:$port >/dev/null; done
posted 'Crewhouse is connected'
shown && { echo "the app's screen opened after the reboot" >&2; exit 1; }
say hi
posted 'What would you like to work on?'
shade news-after-reboot-dark-shade.png
node "$REPO/scripts/verify/steps.mjs" "$OUT" phone-news
