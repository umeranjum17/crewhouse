#!/usr/bin/env bash
# done-done journey `bot-crew`: the bot list and the bot chat on real crewd, from the approved "Same room, our crew" frames.
# One isolated stub-engine crewd onboarded as Umer: Scout hands over five delivered pictures under its answer and has a
# line unread, Reel is at work, Scribe is done, and Chief asks to bring someone on. Captures the list (#/) and Scout's
# chat (#/h/scout) at 390 and 1280, day and night, through home-gate.mjs, the installed-app window of each at 390, and the
# pile laid out after a tap. Exits non-zero when a gate fails or the page's own marks are missing.
#
#   scripts/verify/bot-crew.sh <out-dir>
#
# Needs /usr/bin/chromium and ImageMagick. The stub engine hides its own `stub <bot>:` reply, so Scout's visible bubble is
# the stub's scripted "Challenge this answer" line; the pictures go through the real crew_deliver tool.
set -euo pipefail
OUT=${1:?usage: bot-crew.sh <out-dir>}; mkdir -p "$OUT"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-botcrew.XXXXXX)
trap 'crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
NODE=$(node -p process.execPath)
PORT=$("$NODE" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
[ -f "$REPO/web/dist/index.html" ] || (cd "$REPO" && npm run build:web > "$OUT/build-web.log" 2>&1)
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
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
[ -n "$PERSON" ] || { echo "bot-crew: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl -fsS --max-time 10 "${H[@]}" -d "$2" "$B$1" > /dev/null; }
until_state() { for _ in $(seq 240); do curl -fsS --max-time 10 "${H[@]}" "$B/api/state" | grep -q "$1" && return 0; sleep 0.25; done; echo "bot-crew: never saw $1" >&2; return 1; }
post /api/onboard '{"address":"Umer"}'
post /api/recruit '{"template":"scout","name":"Scout"}'
post /api/recruit '{"template":"scribe","name":"Scribe"}'
post /api/recruit '{"template":"reel","name":"Reel"}'
post /api/bots/scribe/messages '{"text": "Write to the landlord about the heating [tool crew_document {\"name\": \"Heating letter\", \"blocks\": [{\"heading\": \"Dear landlord\"}, {\"text\": \"The heating has been off since Monday. Please send someone this week.\"}]}]"}'
post /api/bots/chief/messages '{"text":"I need someone to sort out my invoices [tool crew_create {\"name\": \"Invoice Ivy\", \"role\": \"Keeps your invoices in order\", \"job\": {\"does\": \"Sorts your invoices.\", \"aim\": \"Nothing you owe slips past its due date.\", \"gets\": \"Invoices you share.\", \"how\": \"One sheet by due date.\", \"great\": \"Two due this week, flagged first.\"}, \"personality\": \"Tidy and calm.\", \"first\": \"Sort out my invoices\"}]"}'
until_state '"kind":"propose"'
# Scout's five pictures: made here into its own files/, handed over one delivery each, as a helper does.
SCOUT="$LAB/crew/bots/scout/files/lamps"; mkdir -p "$SCOUT"
i=0; CALLS=""
for c in '#5b7a8c:#c9d6dc' '#8a7f6e:#e7dcc8' '#3f5a50:#a9c4b4' '#7a5a6b:#e0c8d4' '#6b6a3f:#dcdcb0'; do
  i=$((i + 1)); magick -size 600x800 "gradient:${c%%:*}-${c##*:}" -fill '#2b2b2b' -draw 'rectangle 285,300 315,640' \
    -fill '#e8b04a' -draw 'polygon 190,310 410,310 350,170 250,170' -fill '#2b2b2b' -draw 'ellipse 300,650 110,22 0,360' "$SCOUT/lamp-$i.png"
  CALLS+=" [tool crew_deliver {\\\"path\\\": \\\"files/lamps/lamp-$i.png\\\"}]"
done
post /api/bots/scout/messages "{\"text\": \"Challenge this answer: the Pinewell lamp is the cheapest once delivery is in.$CALLS\"}"
until_state 'Holds: the sources'
post /api/bots/reel/messages '{"text":"Cut the shop video down to a minute, and ask permission before you pick the music"}'
until_state '"state":"working"'
# The list first, so Scout's line is still unread there; opening Scout's chat reads it.
LIST="$B/#person=$PERSON"
node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$LIST" "$OUT" list \
  "(() => { const q = (s) => document.querySelectorAll(s).length, got = { star: q('.cl-star'), count: q('.cl-count'), dot: q('.cl-dot'), crew: document.querySelector('.cl-crew')?.children.length }; if (!got.star || !got.count || !got.dot || got.crew !== 3) throw new Error('the list lost a mark: ' + JSON.stringify(got) + document.body.innerText.slice(0, 300)); })()"
GATE_PWA=1 node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$LIST" "$OUT/installed" list
CHAT="$B/#person=$PERSON"
STACK="(async () => { location.hash = '#/h/scout'; for (let i = 0; i < 100 && !document.querySelector('.img-stack'); i++) await new Promise((r) => setTimeout(r, 100)); const s = document.querySelector('.img-stack'); if (!s) throw new Error('no pile in Scout chat'); if (!/5 images/.test(s.textContent)) throw new Error('pile count: ' + s.textContent); if (document.querySelectorAll('.fan img').length !== 3) throw new Error('the pile fans three'); const l = document.querySelector('.chat-page .lines'); l.scrollTop = l.scrollHeight; for (let i = 0; i < 150 && !document.querySelector('.fan img').naturalWidth; i++) await new Promise((r) => setTimeout(r, 100)); if (!document.querySelector('.fan img').naturalWidth) throw new Error('a picture did not load'); })()"
node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$CHAT" "$OUT" chat "$STACK"
GATE_PWA=1 node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$CHAT" "$OUT/installed" chat "$STACK"
# A tap lays all five out: nothing hides behind the pile.
GATE_WIDTHS=390 node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$CHAT" "$OUT/laid-out" chat "(async () => { await $STACK; document.querySelector('.img-stack').click(); for (let i = 0; i < 100 && document.querySelectorAll('.stack-all img').length !== 5; i++) await new Promise((r) => setTimeout(r, 100)); const n = document.querySelectorAll('.stack-all img').length; if (n !== 5) throw new Error('laid out ' + n); })()"
node "$REPO/scripts/verify/steps.mjs" "$OUT" bot-crew
