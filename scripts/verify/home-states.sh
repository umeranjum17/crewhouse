#!/usr/bin/env bash
# done-done journey `screens`, Home's states (the calm chat list): boot one isolated stub-engine crewd onboarded as Umer,
# seed one state, capture Home at 390 and 1280, day and night, through home-gate.mjs (which fails on text under
# 16px outside caps, pills and tab labels, on clipped text and on sideways scroll), tear down.
#
#   scripts/verify/home-states.sh <out-dir> <first|busy|resting>
#
#   first    onboarded, no helpers: Chief alone in the list, and Hand me a job
#   busy     Rae at work on the phone plan, Will done with the heating letter (Kept), Chief asking to bring Ivy on
#   resting  the same, but Rae's account hit its limit and rests
# Exit 0 with four PNGs and <state>-gate.json in <out-dir>; non-zero otherwise. Needs /usr/bin/chromium.
set -euo pipefail
[ $# -ge 2 ] || { echo "usage: home-states.sh <out-dir> <first|busy|resting>" >&2; exit 2; }
OUT=$1; STATE=$2; mkdir -p "$OUT"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-home.XXXXXX)
trap 'crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$OUT/crewd-$STATE.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "home-states: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl -fsS --max-time 10 "${H[@]}" -d "$2" "$B$1" > /dev/null; }
until_state() { for _ in $(seq 120); do curl -fsS --max-time 10 "${H[@]}" "$B/api/state" | grep -q "$1" && return 0; sleep 0.25; done; echo "home-states: never saw $1" >&2; return 1; }
post /api/onboard '{"address":"Umer"}'
if [ "$STATE" != first ]; then
  post /api/recruit '{"template":"scout","name":"Research Rae"}'
  post /api/recruit '{"template":"scribe","name":"Writer Will"}'
  # Will gets the heating letter, which the stub writes as a document at once, and Rae the phone plan: her run holds
  # on "ask permission" (at work), or her account hits its limit (resting). Each is posted in the helper's own thread.
  post /api/bots/writer-will/messages '{"text": "Write to the landlord about the heating [tool crew_document {\"name\": \"Heating letter\", \"blocks\": [{\"heading\": \"Dear landlord\"}, {\"text\": \"The heating has been off since Monday. Please send someone this week.\"}]}]"}'
  # Chief asks to bring Invoice Ivy on: the one card that needs Umer.
  post /api/bots/chief/messages '{"text":"I need someone to sort out my invoices [tool crew_create {\"name\": \"Invoice Ivy\", \"role\": \"Keeps your invoices in order\", \"job\": {\"does\": \"Sorts your invoices.\", \"aim\": \"Nothing you owe slips past its due date.\", \"gets\": \"Invoices you share.\", \"how\": \"One sheet by due date.\", \"great\": \"Two due this week, flagged first.\"}, \"personality\": \"Tidy and calm.\", \"first\": \"Sort out my invoices\"}]"}'
  until_state '"kind":"propose"'
  # Rae last: a resting account would hold Chief's next turn too.
  if [ "$STATE" = resting ]; then post /api/bots/research-rae/messages '{"text":"Compare phone plans; you hit the limit"}'
  else post /api/bots/research-rae/messages '{"text":"Compare six phone plans that keep my number, and ask permission before you pick"}'; fi
  until_state '"state":"done"'
fi
node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT" "$STATE"
