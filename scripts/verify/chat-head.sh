#!/usr/bin/env bash
# done-done journey `chat-head`: the head across the top of a chat on real crewd, from the approved "Same room, our crew" frame.
# One isolated stub-engine crewd onboarded as Umer with Scout, a long-named helper and Chief's open ask. At 390 and 1280, day and night:
#   helper   back, Scout's face and name chip, the call control, the menu
#   chief    the same head with Chief's star, over his card
#   calling  a call started from the head: the control lit, Listening and Stop in the box's place
#   off      a browser with no ears or voices: the control dimmed, and a tap says why
# Then long/ (a long name at 360 and 390), sent/ (words said on a head call reach crewd once, and the head ends it), and installed/.
# Exits non-zero when a mark or the order is wrong.
#
#   scripts/verify/chat-head.sh <out-dir>
#
# Needs /usr/bin/chromium. The ears and voices are scripts/verify/voice-device.js; the off state runs without it, as headless has neither.
set -euo pipefail
OUT=${1:?usage: chat-head.sh <out-dir>}; mkdir -p "$OUT"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-chathead.XXXXXX)
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
[ -n "$PERSON" ] || { echo "chat-head: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl -fsS --max-time 10 "${H[@]}" -d "$2" "$B$1" > /dev/null; }
said() { sqlite3 -readonly "$LAB/state/crew.db" "SELECT count(*) FROM messages WHERE author = 'person'"; }
post /api/onboard '{"address":"Umer"}'
post /api/recruit '{"template":"scout","name":"Scout"}'
post /api/recruit '{"template":"scribe","name":"Bartholomew Longfellow-Smythe"}'
post /api/bots/scout/messages '{"text": "Challenge this answer: Pinewell has the brass lamp for $46, and delivery is $4."}'
post /api/bots/chief/messages '{"text":"I need someone to sort out my invoices [tool crew_create {\"name\": \"Invoice Ivy\", \"role\": \"Keeps your invoices in order\", \"job\": {\"does\": \"Sorts your invoices.\", \"aim\": \"Nothing you owe slips past its due date.\", \"gets\": \"Invoices you share.\", \"how\": \"One sheet by due date.\", \"great\": \"Two due this week, flagged first.\"}, \"personality\": \"Tidy and calm.\", \"first\": \"Sort out my invoices\"}]"}'
for _ in $(seq 240); do S=$(curl -fsS --max-time 10 "${H[@]}" "$B/api/state"); grep -q 'Holds: the sources' <<< "$S" && grep -q '"kind":"propose"' <<< "$S" && break; sleep 0.25; done
LONG=$("$NODE" -e 'const s=JSON.parse(process.argv[1]);console.log(s.bots.find((b)=>/Bartholomew/.test(b.display??b.name??"")).id)' "$S")

JS=$(cat <<'J'
const wait = async (what, ok) => { for (let i = 0; i < 100; i++) { if (ok()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('never saw ' + what + ': ' + document.querySelector('.pill-head')?.outerHTML.slice(0, 500)); };
const q = (s) => document.querySelector(s), box = (s) => q(s).getBoundingClientRect();
const open = async (hash, label, cls = ':not(.off)') => { location.hash = hash; await wait('the head', () => q('.pill-head .ph-who') && q(`.ph-go${cls}`)?.getAttribute('aria-label') === label); };
const order = () => { const phone = innerWidth < 900, go = box('.ph-go'), who = box('.ph-who'), menu = box('.ph-menu'), size = phone ? 44 : 36;
  if (phone && box('.ph-btn.back').left !== 12) throw new Error('back off the gutter: ' + box('.ph-btn.back').left);
  if (go.width !== size || go.height !== size || menu.width !== size) throw new Error(`control sizes ${go.width}x${go.height} ${menu.width}`);
  if (who.right > go.left || go.right > menu.left || menu.right > innerWidth) throw new Error(`head order ${who.right} ${go.left} ${go.right} ${menu.left}`);
  if (phone && box('.ph-btn.back').right > who.left) throw new Error('back over the chip'); if (!phone && q('.ph-btn.back').offsetWidth) throw new Error('back on a computer'); };
J
)
HELPER="(async () => { $JS await open('#/h/scout', 'Call Scout'); order(); if (q('.pill-head .cl-star')) throw new Error('a star on a helper'); if (q('.ch-name').textContent !== 'Scout') throw new Error('name'); if (!q('.c-pill > .send.talk')) throw new Error('the box lost its voice button'); })()"
CHIEF="(async () => { $JS await open('#/chief', 'Call Chief'); order(); if (!q('.pill-head .ch-art .cl-star')) throw new Error('no star on Chief'); await wait('his card', () => q('.card.ask')); })()"
CALLING="(async () => { $JS await open('#/h/scout', 'Call Scout'); window.ctl.hold(); q('.ph-go').click(); await wait('the call', () => q('.call.listening') && q('.ph-go.on')?.getAttribute('aria-label') === 'End the call with Scout'); order(); if (q('.composer')) throw new Error('the box beside the call'); })()"
OFF="(async () => { $JS location.hash = '#/h/scout'; await wait('Scout', () => q('.ch-name')?.textContent === 'Scout'); await open('#/h/scout', \"This browser can't hear you or read replies aloud here, so calls are off. Type instead.\", '.off'); order(); q('.ph-go').click(); await wait('why', () => [...document.querySelectorAll('.toast')].some((t) => /calls are off/.test(t.textContent))); if (q('.call')) throw new Error('a call started'); })()"
LONGNAME="(async () => { $JS await open('#/h/$LONG', 'Call Bartholomew Longfellow-Smythe'); order(); const n = q('.ch-name'); if (n.scrollWidth <= n.clientWidth) throw new Error('the name was meant to run long here'); })()"
SENT="(async () => { $JS await open('#/h/scout', 'Call Scout'); q('.ph-go').click(); await wait('the ears', () => q('.call.listening') && window.ctl.heard); const said = () => [...document.querySelectorAll('.line.me')].filter((l) => /Check the returns too/.test(l.textContent)).length, was = said(); window.ctl.heard('Check the returns too', true); await wait('the words in the chat', () => said() === was + 1); q('.ph-go').click(); await wait('the box back', () => !q('.call') && q('.composer')); })()"

URL="$B/#person=$PERSON"
gate() { GATE_INIT="$REPO/scripts/verify/voice-device.js" node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$URL" "$@"; }
gate "$OUT" helper "$HELPER"
gate "$OUT" chief "$CHIEF"
# The gate reads the head here: the call panel in the box's place keeps its own smaller type.
GATE_SCOPE='.pill-head *' gate "$OUT" calling "$CALLING"
node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$URL" "$OUT" off "$OFF"
GATE_WIDTHS=360,390 gate "$OUT/long" long "$LONGNAME"
BEFORE=$(said)
GATE_SCOPE='.pill-head *' GATE_WIDTHS=390 gate "$OUT/sent" sent "$SENT"
[ "$(said)" = "$((BEFORE + 2))" ] || { echo "chat-head: two head calls sent $(($(said) - BEFORE)) lines" >&2; exit 1; }
echo "person's messages: $BEFORE before, +2 after one spoken line on each of two head calls (day and night)" > "$OUT/sent.txt"
GATE_PWA=1 gate "$OUT/installed" helper "$HELPER"
GATE_SCOPE='.pill-head *' GATE_PWA=1 gate "$OUT/installed" calling "$CALLING"
node "$REPO/scripts/verify/steps.mjs" "$OUT" chat-head
