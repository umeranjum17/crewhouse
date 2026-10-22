#!/usr/bin/env bash
# done-done journey `home-list-preview`: Chief's last line is a markdown list; Home's Chief card must show it without a
# raw dash. A web_search that cannot run must end on the trail as "The web search did not go through".
#   scripts/verify/home-list-preview.sh <out-dir>     writes home-390-day.png and its step record
set -euo pipefail
OUT=${1:?usage: home-list-preview.sh <out-dir>}; mkdir -p "$OUT"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-list.XXXXXX)
trap 'crewd_stop || exit 1; rm -rf "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" node "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break; fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "home-list-preview: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl -fsS --max-time 10 "${H[@]}" -d "$2" "$B$1" > /dev/null; }
trail() { curl -fsS --max-time 10 "${H[@]}" "$B/api/bots/chief" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).trail.filter(e=>e.kind==="run.tool").map(e=>e.data.words),null,1)))'; }
post /api/onboard '{"address":"Umer"}'
post /api/bots/chief/messages '{"text":"Search the web: current Node LTS? [tool web_search {\"query\": \"current Node.js LTS release\"}]"}'
for _ in $(seq 80); do trail | grep -q 'did not go through' && break; sleep 0.25; done
trail > "$LAB/trail-web-search.json"
grep -q 'did not go through' "$LAB/trail-web-search.json" || { echo "home-list-preview: the failed search is not on the trail" >&2; exit 1; }
! grep -q 'Searched the web' "$LAB/trail-web-search.json" || { echo "home-list-preview: a failed search reads as a search" >&2; exit 1; }
# The stub's own echo is hidden in chats, so seed the list line a real Chief answer leaves.
DB=$(find "$LAB/state" -name '*.db' | head -1)
node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec("PRAGMA busy_timeout = 10000");d.prepare("INSERT INTO messages (bot, author, text, task_id, at) VALUES (?,?,?,?,?)").run("chief","bot","Node.js LTS is v24.22.1 (patched 20 October 2026).\n- Active LTS: v24.22.1\n- Maintenance: v22.23.4",null,Date.now()+1000)' "$DB"
# The one capture the journey keeps is Home at 390, day; the gate's other shots and files stay in the lab.
node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$LAB/shots" home
cp "$LAB/shots/home-390-day.png" "$OUT/"
node "$REPO/scripts/verify/steps.mjs" "$OUT" home-list-preview
