#!/usr/bin/env bash
# done-done journey `screens` (hand/agent only: needs a browser session): boot one
# isolated stub-engine crewd, capture the fixed visual smoke set (Home and Chief's
# thread opened from it, day and night, 1440 and 390) into <out>/screens/, tear down.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/screens-smoke.sh "$DONE_DONE_EVIDENCE_ROOT"
#
# Needs chrome-devtools-axi on PATH with that session owning a Chrome. Exit 0 with
# eight PNGs, non-zero otherwise. Never the owner's install, never port 7711.
# crewd's process group is emptied before the lab goes (crewd-group.sh).
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: screens-smoke.sh <evidence-dir>" >&2; exit 2; }
OUT=$1; mkdir -p "$OUT/screens"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-screens.XXXXXX)
trap 'rc=$?; [ "$rc" = 0 ] || cp "$LAB/crewd.log" "$OUT/crewd-screens.log" 2>/dev/null; crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
node -v > /dev/null 2>&1 || { mkdir "$LAB/bin" && ln -s /usr/bin/node /usr/bin/npm /usr/bin/npx "$LAB/bin/" && export PATH=$LAB/bin:$PATH; } # done-done runs with a clean environment, where a version-manager shim fails: use the distro node and npm, alone, so every other shim keeps its place
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts"
PERSON=""
DEADLINE=$((SECONDS + 60))
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    if curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"'; then break; fi
  fi
  [ "$SECONDS" -ge "$DEADLINE" ] && break
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "screens-smoke: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
curl -fsS --max-time 10 "${H[@]}" -d '{"address":"Umer"}' "$B/api/onboard" > /dev/null
curl -fsS --max-time 10 "${H[@]}" -d '{"text":"smoke"}' "$B/api/bots/chief/messages" > /dev/null
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
URL="$B/#person=$PERSON"
bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" home "$URL"
# Chief's thread, opened the way a person does: a tap on Chief's card on Home.
THEN="(async () => { for (let i = 0; i < 50 && !document.querySelector('.sh-chief a'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('.sh-chief a')?.click(); for (let i = 0; i < 50 && !document.querySelector('.home-chat'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.home-chat'); })()" \
  bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" chief "$URL"
node "$REPO/scripts/verify/steps.mjs" "$OUT" screens-smoke
echo "screens-smoke: $(ls "$OUT"/screens/*.png | wc -l) captures in $OUT/screens"
