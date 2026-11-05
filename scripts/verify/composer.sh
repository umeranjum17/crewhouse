#!/usr/bin/env bash
# done-done journey `composer`: the pill composer on real crewd, from the approved "Same room, our crew" frame.
# One isolated stub-engine crewd onboarded as Umer with Scout on the crew. In Scout's chat at 390 and 1280, day and night:
#   ready      the empty pill: +, Ask Scout, the mic, the round voice button
#   typed      words, three photos as one pile counted 3 images, a PDF chip, the amber Send
#   listening  the mic lit amber, the wave and its clock, the words kept on their own row
# Then a tap lays the pile out, the installed-app window of typed and listening at 390, and heard/: what the mic heard
# joins the box, nothing has gone, and only a tap on Send sends it. Exits non-zero when a mark is missing or a word left early.
#
#   scripts/verify/composer.sh <out-dir>
#
# Needs /usr/bin/chromium. The ears are scripts/verify/voice-device.js, fed words as text; Hex writing a clip down is the
# voice-hex journey's. The picker is the device's own, so files are staged on the composer's own input as the dialog would.
set -euo pipefail
OUT=${1:?usage: composer.sh <out-dir>}; mkdir -p "$OUT"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-composer.XXXXXX)
trap 'crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
NODE=$(node -p process.execPath)
PORT=$("$NODE" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
[ -f "$REPO/web/dist/index.html" ] || (cd "$REPO" && npm run build:web > "$LAB/build-web.log" 2>&1)
crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  "$NODE" "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "composer: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl -fsS --max-time 10 "${H[@]}" -d "$2" "$B$1" > /dev/null; }
said() { sqlite3 -readonly "$LAB/state/crew.db" "SELECT count(*) FROM messages WHERE author = 'person'"; }
post /api/onboard '{"address":"Umer"}'
post /api/recruit '{"template":"scout","name":"Scout"}'
post /api/bots/scout/messages '{"text": "Challenge this answer: Pinewell has the brass lamp for $46, and delivery is $4."}'
for _ in $(seq 240); do curl -fsS --max-time 10 "${H[@]}" "$B/api/state" | grep -q 'Holds: the sources' && break; sleep 0.25; done

JS=$(cat <<'J'
const wait = async (what, ok) => { for (let i = 0; i < 100; i++) { if (ok()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('never saw ' + what + ': ' + document.querySelector('.composer')?.outerHTML.slice(0, 400)); };
const q = (s) => document.querySelector(s), box = () => q('.chat .dock textarea');
const type = (t) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box(), t); box().dispatchEvent(new Event('input', { bubbles: true })); };
const open = async () => { location.hash = '#/h/scout'; await wait('the pill', () => box()?.placeholder === 'Ask Scout' && q('.chat .dock .c-pill > .c-clip') && q('.c-pill > .mic:not(.off)') && q('.c-pill > .send.talk')); };
const photo = (i, a, b) => new Promise((done) => { const c = document.createElement('canvas'); c.width = 300; c.height = 400; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 400); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, 300, 400); x.fillStyle = '#e8b04a'; x.beginPath(); x.moveTo(95, 155); x.lineTo(205, 155); x.lineTo(175, 85); x.lineTo(125, 85); x.fill(); x.fillStyle = '#2b2b2b'; x.fillRect(143, 155, 14, 170); c.toBlob((blob) => done(new File([blob], `lamp-${i}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', .9); });
const stage = async () => { const dt = new DataTransfer(), input = q('.composer input[type=file]'); dt.items.add(await photo(1, '#5b7a8c', '#c9d6dc')); dt.items.add(await photo(2, '#8a7f6e', '#e7dcc8')); dt.items.add(await photo(3, '#3f5a50', '#a9c4b4')); dt.items.add(new File(['%PDF-1.4 the quote'], 'lamp-quote.pdf', { type: 'application/pdf' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); await wait('the pile', () => q('.c-pile')); if (!/3 images/.test(q('.c-pile').textContent)) throw new Error('pile: ' + q('.c-pile').textContent); await wait('the chip', () => /lamp-quote\.pdf/.test(q('.c-files').textContent)); };
const listen = async () => { await open(); type('Find the same lamp with free delivery'); await wait('the words', () => box().value); q('.c-pill > .mic').click(); await wait('the lit mic', () => q('.mic.on') && q('.c-wave')); await wait('the clock', () => /0:0[1-9]/.test(q('.c-wave').textContent)); };
J
)
READY="(async () => { $JS await open(); })()"
TYPED="(async () => { $JS await open(); await stage(); type(\"Check Pinewell's returns too\"); await wait('Send', () => q('.c-pill > .send:not(.talk):not(:disabled)')); })()"
LISTENING="(async () => { $JS await listen(); if (q('.send.talk')) throw new Error('Talk beside the lit mic'); })()"
LAID="(async () => { $JS await open(); await stage(); q('.c-pile').click(); await wait('four chips', () => document.querySelectorAll('.c-file').length === 4); })()"
HEARD="(async () => { $JS await listen(); window.ctl.heard('and a warranty', true); await wait('the heard words in the box', () => box().value === 'Find the same lamp with free delivery and a warranty' && !q('.mic.on')); if (q('.line.me.sending')) throw new Error('speaking sent it'); })()"
SENT="(async () => { $JS await listen(); window.ctl.heard('and a warranty', true); await wait('Send', () => !q('.mic.on') && q('.c-pill > .send:not(.talk):not(:disabled)')); q('.c-pill > .send').click(); await wait('the box emptied', () => !box().value); })()"

URL="$B/#person=$PERSON"
gate() { GATE_INIT="$REPO/scripts/verify/voice-device.js" node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$URL" "$@"; }
BEFORE=$(said)
gate "$OUT" ready "$READY"
gate "$OUT" typed "$TYPED"
gate "$OUT" listening "$LISTENING"
GATE_WIDTHS=390 gate "$OUT/laid-out" laid-out "$LAID"
GATE_PWA=1 gate "$OUT/installed" typed "$TYPED"
GATE_PWA=1 gate "$OUT/installed" listening "$LISTENING"
GATE_WIDTHS=390 gate "$OUT/heard" heard "$HEARD"
[ "$(said)" = "$BEFORE" ] || { echo "composer: a word left the box with no tap on Send" >&2; exit 1; }
GATE_WIDTHS=390 gate "$OUT/heard" sent "$SENT"
[ "$(said)" = "$((BEFORE + 2))" ] || { echo "composer: Send sent $(($(said) - BEFORE)) messages over two taps" >&2; exit 1; }
echo "person's messages: $BEFORE before the box was touched, the same after the mic, +2 after two taps on Send" > "$OUT/sent.txt"
node "$REPO/scripts/verify/steps.mjs" "$OUT" composer
