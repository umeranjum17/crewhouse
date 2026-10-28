#!/usr/bin/env bash
# A rule that holds sends, on the phone app (docs/verification/custom-rules.md): the pairing lab (pair-lab.sh, stub engine
# with its scripted replies, emulate's stateful Google with Umer's Calendar connected the way Settings connects it) and an
# emulator paired by the typed relay code. On the phone Umer types each line to Chief: a drafts-only rule (the shield card,
# Create rule), a lunch for his calendar (Chief's draft and crewd's own "Held by your rule" line; nothing added), "Keep
# drafts, but when I say send, do it." (the Update card, Update rule), then "Send it." (the lunch goes on his calendar,
# once), and the rule in Settings › Custom rules. Each at 390 wide, day and night, the journey recorded in two parts.
#
#   SERIAL=emulator-5580 bash scripts/verify/phone-rules.sh <out-dir> <apk>
#
# Exit 0 with {rule-card,held,update-card,sent,rules,rule-edit}-{day,night}-390.png, rule-journey-{1,2}.mp4 and lunches.json
# (the emulated calendar's Lunch with Ada count after each step) in <out-dir>. The emulator is the caller's.
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: SERIAL=<emulator> phone-rules.sh <out-dir> <apk>" >&2; exit 2; }
OUT=$1; APK=$2; : "${SERIAL:?set SERIAL to the emulator}"
VERIFY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$VERIFY_DIR" rev-parse --show-toplevel)
mkdir -p "$OUT"
adb() { command adb -s "$SERIAL" "$@"; }
ui() { SERIAL=$SERIAL node "$VERIFY_DIR/phone-ui.mjs" "$@"; }
bring() { for _ in $(seq "${2:-8}"); do ui texts | grep -E -- "$1" | grep -qE '\[[0-9]+,[0-9]+,[0-9]+,(1[0-9]{3}|[0-9]{1,3}|20[0-9]{2})\]' && return 0; adb shell input swipe 540 1700 540 900 300; sleep 1; done; echo "phone-rules: could not bring $1 on screen" >&2; return 1; }
see() { for _ in $(seq "${2:-30}"); do ui texts 2>/dev/null | grep -qE -- "$1" && return 0; sleep 1; done; ui texts >&2 || true; echo "phone-rules: never saw: $1" >&2; return 1; }

export LAB; LAB=$(mktemp -d -t phone-rules.XXXXXX)
. "$VERIFY_DIR/crewd-group.sh"
trap 'bash "$VERIFY_DIR/pair-lab.sh" down || true; adb shell wm size reset >/dev/null 2>&1 || true; adb shell wm density reset >/dev/null 2>&1 || true; adb shell cmd uimode night no >/dev/null 2>&1 || true; cp "$LAB/crewd.log" "$OUT/crewd.log" 2>/dev/null || true; crewhouse_remove_lab "$LAB"' EXIT
LAB_GOLDEN=1 LAB_GOOGLE=1 bash "$VERIFY_DIR/pair-lab.sh" up "$REPO" >/dev/null
. "$LAB/env"
# Calendar the way the person connects it (Connect, the sign-in page, Umer's account, back to crewd), then the lunch count.
lab() { (cd "$REPO" && node --input-type=module -e "
const [B, key, EMU, cmd] = process.argv.slice(1), { ME, CLIENT } = await import('./test/emulate-google.ts');
const api = async (m, p, b) => (await fetch(B + p, { method: m, headers: { authorization: 'Bearer ' + key, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json();
const g = (m, p) => fetch(EMU + p, { method: m, headers: { authorization: 'Bearer witness' } });
if (cmd === 'connect') {
  await api('POST', '/api/onboard', { address: 'Umer' }); await api('PUT', '/api/house/google', CLIENT);
  const { url } = await api('POST', '/api/connections/calendar');
  const form = (await (await fetch(url)).text()).split('<form').find((f) => f.includes('value=\"' + ME + '\"'));
  const un = (v) => v.replace(/&quot;/g, '\"').replace(/&#39;/g, \"'\").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const chosen = await fetch(EMU + '/o/oauth2/v2/auth/callback', { method: 'POST', body: new URLSearchParams([...form.matchAll(/<input type=\"hidden\" name=\"([^\"]+)\" value=\"([^\"]*)\"\/>/g)].map((m) => [m[1], un(m[2])])), redirect: 'manual' });
  if (!/is connected\./.test(await (await fetch(chosen.headers.get('location'))).text())) throw Error('calendar did not connect');
  // emulate ignores privateExtendedProperty, so calendar add's add-twice check would match a seeded event.
  for (const id of ['standup0001', 'dentist0001']) await g('DELETE', '/calendar/v3/calendars/primary/events/' + id);
} else console.log(((await (await g('GET', '/calendar/v3/calendars/primary/events')).json()).items ?? []).filter((e) => e.summary === 'Lunch with Ada' && e.status !== 'cancelled').length);
" "$B" "$(cat "$LAB/state/person.key")" "$GOOGLE" "$1"); }
lab connect
count() { printf '"%s": %s,\n' "$1" "$(lab count)" >>"$OUT/lunches.part"; }
rm -f "$OUT/lunches.part"; count connected

# 390 wide: 1080 px at density 443.
adb shell wm size 1080x2400; adb shell wm density 443
node "$VERIFY_DIR/phone-pair-typed.mjs" --serial "$SERIAL" --apk "$APK"
shot() { # $1 file stem, $2 the words that must be on screen
  for theme in day night; do
    adb shell cmd uimode night "$([ $theme = night ] && echo yes || echo no)" >/dev/null
    see "$2" 10 2>/dev/null || bring "$2"; sleep 1
    ui shot "$OUT/$1-$theme-390.png"
  done
  adb shell cmd uimode night no >/dev/null
}
# Umer's words, a few letters at a time (a controlled input drops fast text), checked in the box before Send.
say() {
  ui tap 'Tell Chief anything' >/dev/null; sleep 0.5
  local s=$1 i
  for ((i = 0; i < ${#s}; i += 3)); do adb shell input text "$(printf %s "${s:i:3}" | sed 's/ /%s/g')"; sleep 0.2; done
  ui texts | grep -qF -- "] $s" || { echo "phone-rules: the box never held: $s" >&2; exit 1; }
  # The keyboard goes first (BACK only while it shows, else BACK leaves the thread), then Send.
  [ "$(adb shell dumpsys input_method | grep -c 'mInputShown=true')" = 0 ] || { adb shell input keyevent 4; sleep 1; }
  ui tap '^Send$' >/dev/null
}
ui tap '^Chief$' >/dev/null; see 'Tell Chief anything'

adb shell screenrecord --time-limit 170 /sdcard/rule-journey-1.mp4 & REC=$!
say 'From now on, only prepare drafts. I will send messages myself.'
see ' New custom rule$'; bring ' Create rule$'
shot rule-card ' Create rule$'
ui tap '^Create rule$' >/dev/null; see 'Saved'
count drafts-rule
say 'Put lunch with Ada on my calendar for tomorrow at 1.'
see '^.* Held by your rule'
shot held ' Here is the draft: Lunch with Ada'
count held
wait "$REC"; adb pull /sdcard/rule-journey-1.mp4 "$OUT/rule-journey-1.mp4" >/dev/null; adb shell rm /sdcard/rule-journey-1.mp4

adb shell screenrecord --time-limit 170 /sdcard/rule-journey-2.mp4 & REC=$!
say 'Keep drafts, but when I say send, do it.'
see ' Update custom rule$'; bring ' Update rule$'
shot update-card ' Update rule$'
ui tap '^Update rule$' >/dev/null; see 'Saved'
count say-rule
say 'Send it.'
see ' Done: Lunch with Ada is on your calendar'
shot sent ' Done: Lunch with Ada is on your calendar'
count sent
wait "$REC"; adb pull /sdcard/rule-journey-2.mp4 "$OUT/rule-journey-2.mp4" >/dev/null; adb shell rm /sdcard/rule-journey-2.mp4

# The rule where the person keeps it: Settings › Custom rules, then its edit form.
adb shell input keyevent 4; see '\{Places\}'; ui tap '^Places$' >/dev/null; see ' Settings$'; ui tap '^Settings$' >/dev/null
bring ' (Custom rules|CUSTOM RULES)$' 12; bring ' Edit$' 6
shot rules ' Edit$'
ui tap '^Edit$' >/dev/null; see ' Save changes$'
shot rule-edit ' Save changes$'
{ echo '{'; sed '$ s/,$//' "$OUT/lunches.part"; echo '}'; } >"$OUT/lunches.json"; rm -f "$OUT/lunches.part"
node -e 'const l = require(process.argv[1]); if (JSON.stringify(Object.values(l)) !== "[0,0,0,0,1]") { console.error("phone-rules: lunches " + JSON.stringify(l)); process.exit(1); }' "$OUT/lunches.json"
echo "phone-rules: the rule held the add, the update card widened it, and Send it added the lunch once"
