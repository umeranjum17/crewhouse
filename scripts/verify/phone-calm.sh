#!/usr/bin/env bash
# The calm chat on the phone app (features/calm-chat-home-desktop.md, its phone section): the release app on a task-owned
# emulator at 390 wide, paired to a golden-stub crewd seeded with Rae and Will at work and Chief asking to bring Ivy on.
# Home is the chat list, Chief's and Will's threads have the pill head, soft bubbles and the pill composer, day and night;
# the box and its send sit above the keyboard (phone-keyboard.mjs); one message sent from Chief's box gets his reply; and
# with a goal on, Home carries its Your goal row.
#   bash scripts/verify/phone-calm.sh <out-dir> [release-x86_64.apk]
# Needs the Android SDK, a built web/dist and the APK (see phone-mic-fallback.sh). Writes the stills below, each with the
# screen's texts beside it, and the step record in <out-dir>.
set -euo pipefail
exec 2>&1 # a failure says why in the run's own output
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUT=$(realpath -m "${1:?out dir}") APK=$(realpath "${2:-$REPO/mobile/android/app/build/outputs/apk/release/app-x86_64-release.apk}")
S=${FM_SCRATCH:-$HOME/.cache/fm-scratch}/phone-calm-$$; SER=emulator-5592
export PATH=/usr/bin:$PATH ANDROID_USER_HOME=$S/android-user ANDROID_AVD_HOME=$S/android-user/avd LAB=$S/lab SERIAL=$SER
mkdir -p "$OUT" "$ANDROID_AVD_HOME"
EMU=
cleanup() {
  local rc=$?
  # A failure keeps the screen it stopped on, so the cause is on record.
  [ $rc = 0 ] || { node "$REPO/scripts/verify/phone-ui.mjs" shot "$OUT/failed-screen.png" && node "$REPO/scripts/verify/phone-ui.mjs" texts >"$OUT/failed-screen.txt"; } >/dev/null 2>&1 || true
  adb -s $SER emu kill >/dev/null 2>&1 || true
  bash "$REPO/scripts/verify/pair-lab.sh" down >/dev/null 2>&1 || true
  [ -n "$EMU" ] && wait "$EMU" 2>/dev/null || true
  chmod -R u+w "$S" 2>/dev/null || true; rm -rf -- "$S"
}
trap cleanup EXIT
adb devices | grep -q "^$SER" && { echo "$SER is already running" >&2; exit 1; }
echo no | "${ANDROID_HOME:-$HOME/Android/Sdk}/cmdline-tools/latest/bin/avdmanager" create avd -n calm1 -k "system-images;android-36;google_apis;x86_64" -d pixel_6 >/dev/null
${FM_MEM_GATE:-} emulator -avd calm1 -port 5592 -no-window -gpu swiftshader_indirect -memory 2048 -cores 2 -no-audio -no-boot-anim -no-snapshot-save >"$S/emu.log" 2>&1 &
EMU=$!
for _ in $(seq 400); do [ "$(adb -s $SER shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break; sleep 3; done
[ "$(adb -s $SER shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || { echo "the emulator never booted" >&2; tail -5 "$S/emu.log" >&2; exit 1; }
LAB_GOLDEN=1 bash "$REPO/scripts/verify/pair-lab.sh" up "$REPO" >/dev/null
. "$LAB/env"; KEY=$(<"$LAB/state/person.key")
api() { curl -fsS --max-time 10 -X "$1" -H x-crewhouse:1 -H "authorization: Bearer $KEY" -H content-type:application/json "$B$2" ${3:+-d "$3"}; }
until_state() { for _ in $(seq 120); do api GET /api/state | grep -q "$1" && return 0; sleep 0.5; done; echo "never saw $1 in the state" >&2; exit 1; }
# home-states.sh's busy crew: Will's heating letter (a finished document), Rae at work, Chief asking to bring Ivy on.
api POST /api/onboard '{"address":"Umer"}' >/dev/null
api POST /api/recruit '{"template":"scout","name":"Research Rae"}' >/dev/null
api POST /api/recruit '{"template":"scribe","name":"Writer Will"}' >/dev/null
api POST /api/bots/writer-will/messages '{"text": "Write to the landlord about the heating [tool crew_document {\"name\": \"Heating letter\", \"blocks\": [{\"heading\": \"Dear landlord\"}, {\"text\": \"The heating has been off since Monday. Please send someone this week.\"}]}]"}' >/dev/null
api POST /api/bots/chief/messages '{"text":"I need someone to sort out my invoices"}' >/dev/null
until_state '"kind":"propose"'
api POST /api/bots/research-rae/messages '{"text":"Compare six phone plans that keep my number, and ask permission before you pick"}' >/dev/null
node "$REPO/scripts/verify/phone-pair-typed.mjs" --serial $SER --apk "$APK"
P="node $REPO/scripts/verify/phone-ui.mjs"
see() { for _ in $(seq 40); do $P texts | grep -qE -- "$1" && return 0; sleep 1; done; $P texts >&2 || true; echo "never saw: $1" >&2; exit 1; }
shot() { sleep 1; $P shot "$OUT/$1.png"; $P texts >"$OUT/$1.txt"; }
look() { adb -s $SER shell cmd uimode night "$1" >/dev/null; adb -s $SER shell am start -n dev.crewhouse.app/.MainActivity >/dev/null; sleep 2; }
adb -s $SER shell wm density 443 >/dev/null # 1080 px across at 443 dpi: 390 wide
# 1. Home as the chat list and both threads, by day and by night.
for night in no yes; do
  name=$([ $night = yes ] && echo night || echo day)
  look $night
  see 'Search your chats'
  see 'Chief has 1 thing for you'
  shot home-$name-390
  $P tap '^Chief$' >/dev/null; see 'Tell Chief anything'; see 'Invoice Ivy'
  shot chief-$name-390
  adb -s $SER shell input keyevent BACK; see 'Search your chats'
  $P tap '^Writer Will$' >/dev/null; see 'Talk to Writer Will'; see 'Heating letter'
  shot will-$name-390
  adb -s $SER shell input keyevent BACK; see 'Search your chats'
  # The list's end clears the floating dock: the versions foot is the last thing on Home.
  for _ in 1 2 3; do adb -s $SER shell input swipe 540 1700 540 500 200; sleep 0.5; done
  see '\] (Crewhouse|App) [0-9]'; shot home-end-$name-390
  for _ in 1 2 3; do adb -s $SER shell input swipe 540 500 540 1900 200; sleep 0.5; done
done
# 2. The box and its send above the keyboard, by day and by night (the layout read from the screen, phone-keyboard.mjs).
mkdir -p "$S/kb"
kb=0; node "$REPO/scripts/verify/phone-keyboard.mjs" --serial $SER --out "$S/kb" --widths 390 || kb=$?
for f in day night; do [ ! -e "$S/kb/390-$f.png" ] || cp "$S/kb/390-$f.png" "$OUT/composer-keyboard-$f-390.png"; done
cp "$S/kb/keyboard.json" "$OUT/composer-keyboard.json"
[ $kb = 0 ] || { $P texts >&2 || true; echo "the box or its send was not above the keyboard (composer-keyboard.json)" >&2; exit 1; }
# 3. One message sent from Chief's box: it reaches crewd and his reply shows under it.
adb -s $SER shell wm density 443 >/dev/null; look no
$P tap '^Chief$' >/dev/null; see 'Tell Chief anything'
for _ in 1 2 3; do $P tap-if '^Remove Umer_Resume.pdf$' >/dev/null; done
$P tap 'Tell Chief anything' >/dev/null
for _ in $(seq 25); do adb -s $SER shell dumpsys input_method | grep -q mInputShown=true && break; sleep 0.4; done # keys sent before the keyboard is up get lost
adb -s $SER shell input keyevent 123 $(printf '67 %.0s' $(seq 40)) # the kept draft goes first: end, then deletes (a ctrl+a's Ctrl can stick to the next key)
adb -s $SER shell input text hi
see '^dev.crewhouse.app .*\] hi( \{|$)'
$P tap '^Send$' >/dev/null
see 'What would you like to work on'
api GET /api/bots/chief | grep -q '"text":"hi"' || { echo "the sent message never reached crewd" >&2; exit 1; }
adb -s $SER shell input keyevent 111 # keyboard down
shot chief-sent-day-390
# 4. With a goal on, Home carries its Your goal row under the chats.
api POST /api/bots/chief/messages "$(node -e 'console.log(JSON.stringify({text: "Find me a job [tool crew_goal " + JSON.stringify({title: "Product designer", places: "Remote or London", brief: "Umer, product designer, eight years of mobile apps and design systems, wants a calm team."}) + "]"}))')" >/dev/null
until_state 'Start looking for Product designer'
ask=$(api GET /api/state | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).asks.find(a=>a.state==="open"&&/Product designer/.test(a.title)).id))')
api POST "/api/asks/$ask/answer" '{"answer":"allow"}' >/dev/null
until_state '"goals":\[{'
adb -s $SER shell input keyevent BACK; look no
see 'Your goal'; see 'Product designer: '
shot home-goal-day-390
node "$REPO/scripts/verify/steps.mjs" "$OUT" phone-calm
echo "phone-calm: Home's chat list, Chief's and Will's threads day and night, the box above the keyboard, one sent message, the goal row"
