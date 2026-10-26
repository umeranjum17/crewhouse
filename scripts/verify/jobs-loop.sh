#!/usr/bin/env bash
# done-done journey `jobs-loop`: Umer's job search from goal card to applied, on a real stub-engine crewd and a local posting
# page. Chief's goal card (nothing starts before yes), the board with a Found and a Drafted role, a role card opened, the
# writer's draft with the fields only Umer answers left empty, and the applied state after his own tap. Each at 390 and 1280,
# day and night, through home-gate.mjs; then the installed-app window (display-mode standalone) at 390.
#
#   scripts/verify/jobs-loop.sh <out-dir>
# Exit 0 with <step>-<390|1280>-<day|night>.png, <step>-gate.json and pwa-<step>-390-<day|night>.png in <out-dir>. Needs /usr/bin/chromium.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: jobs-loop.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-jobs.XXXXXX)
POSTING=""
trap '[ -z "$POSTING" ] || kill "$POSTING" 2>/dev/null; crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
free_port() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
PORT=$(free_port); PPORT=$(free_port)
B="http://127.0.0.1:$PORT"; P="http://127.0.0.1:$PPORT"
node -e 'require("node:http").createServer((q,r)=>{r.setHeader("content-type","text/html");r.end(q.url.endsWith("/2")?"<h1>UI Engineer</h1><p>Remote, UK. Design systems.</p>":"<h1>Frontend Engineer</h1><p>Salary: £55,000 to £65,000 a year. React, TypeScript, GraphQL.</p>")}).listen(+process.argv[1],"127.0.0.1")' "$PPORT" &
POSTING=$!
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  "${NODE:-node}" "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "jobs-loop: crewd never became ready" >&2; exit 1; }
drive() { node "$REPO/scripts/verify/jobs-loop.mjs" "$1" "$B" "$PERSON" "$P"; }
# home-gate opens the url with the person's key, then runs the step's own js: go to the route, then click.
hash_gate() {
  local js="(async () => { location.hash = '#$2'; await new Promise((r) => setTimeout(r, 900)); ${3:-} })()"
  node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT" "$1" "$js"
  GATE_PWA=1 node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT" "pwa-$1" "$js"
}
ASK=$(drive goal)
hash_gate goal-card "/ask/$ASK"
IDS=$(drive board); ROLE=$(node -p "JSON.parse(process.argv[1]).role" "$IDS"); DRAFT=$(node -p "JSON.parse(process.argv[1]).ask" "$IDS")
hash_gate board /goal
hash_gate role /goal "document.querySelector('.goal-chips button')?.click(); document.querySelector('.role-head')?.click()"
hash_gate draft "/ask/$DRAFT"
drive apply > /dev/null
hash_gate applied /goal "[...document.querySelectorAll('.goal-chips button')].find((b) => /^Applied/.test(b.textContent))?.click()"
node "$REPO/scripts/verify/steps.mjs" "$OUT" jobs-loop
echo "jobs-loop: ok role=$ROLE"
