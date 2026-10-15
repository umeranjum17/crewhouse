#!/usr/bin/env bash
# done-done journey `screens` (hand/agent only: needs a browser session): boot one
# isolated stub-engine crewd, capture the fixed visual smoke set (Chief's thread and
# the Office view, day and night, 1440 and 390) into <out>/screens/, tear down.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/screens-smoke.sh "$DONE_DONE_EVIDENCE_ROOT"
#
# Needs chrome-devtools-axi on PATH with that session owning a Chrome. Exit 0 with
# eight PNGs, non-zero otherwise. Never the owner's install, never port 7711.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: screens-smoke.sh <evidence-dir>" >&2; exit 2; }
OUT=$1; mkdir -p "$OUT/screens"
REPO=$(git rev-parse --show-toplevel)
LAB=$(mktemp -d /tmp/crewhouse-screens.XXXXXX)
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
cleanup() { [ -n "${PID:-}" ] && kill -TERM "$PID" 2>/dev/null || true; rm -rf "$LAB"; }
trap cleanup EXIT
env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts" > "$OUT/crewd-screens.log" 2>&1 &
PID=$!
PERSON=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    if curl -fsS -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"'; then break; fi
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "screens-smoke: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
curl -fsS "${H[@]}" -d '{"address":"Sir"}' "$B/api/onboard" > /dev/null
curl -fsS "${H[@]}" -d '{"text":"smoke"}' "$B/api/bots/chief/messages" > /dev/null
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
URL="$B/#person=$PERSON"
bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" chief "$URL"
THEN="(async () => { document.querySelector('[data-mode=office]')?.click(); for (let i = 0; i < 50 && !document.querySelector('.office'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.office'); })()" \
  bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" office "$URL"
echo "screens-smoke: $(ls "$OUT"/screens/*.png | wc -l) captures in $OUT/screens"
