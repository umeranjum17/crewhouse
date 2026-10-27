#!/usr/bin/env bash
# done-done journey `jobs-rank`: the roles a REAL search finds, ranked by Umer's strategy (remote first, gateway companies, fast
# hiring, sponsorship), each row with its one-line reason in the page's own words. A stub-engine crewd with its scripted finder
# reading live AI and machine-learning engineering postings from public Greenhouse boards (jobs-rank.mjs); crewd opens every cited
# page itself, checks each quote, ranks and words the reason. The board and one opened role at 390 and 1280, day and night,
# through home-gate.mjs; then the installed-app window (display-mode standalone) at 390. Needs the network and /usr/bin/chromium.
#
#   scripts/verify/jobs-rank.sh <out-dir>
# Exit 0 with search.json (the order, each row's reasons, the independent checks), <step>-<390|1280>-<day|night>.png,
# <step>-gate.json and pwa-<step>-390-<day|night>.png in <out-dir>; non-zero when the order or a quote fails its own check.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: jobs-rank.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-rank.XXXXXX)
trap 'crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
free_port() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
PORT=$(free_port)
B="http://127.0.0.1:$PORT"
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
[ -n "$PERSON" ] || { echo "jobs-rank: crewd never became ready" >&2; exit 1; }
drive() { node "$REPO/scripts/verify/jobs-rank.mjs" "$1" "$B" "$PERSON"; }
# home-gate opens the url with the person's key, then runs the step's own js: go to the route, then click.
hash_gate() {
  local js="(async () => { location.hash = '#$2'; await new Promise((r) => setTimeout(r, 900)); ${3:-} })()"
  node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT" "$1" "$js"
  GATE_PWA=1 node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT" "pwa-$1" "$js"
}
ASK=$(drive goal)
drive search > "$OUT/search.json" || { cat "$OUT/search.json" >&2; echo "jobs-rank: the order or a quote failed its own check" >&2; exit 1; }
hash_gate board /goal
hash_gate role /goal "document.querySelector('.role-head')?.click()"
# The thread's roles are the same card (a look's result in Chief's chat); its reference data lists them in the same order.
GATE_SCOPE=".chat .lines .role *" node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/?demo=thread#/chief" "$OUT" thread-demo
GATE_SCOPE=".chat .lines .role *" GATE_PWA=1 node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/?demo=thread#/chief" "$OUT" pwa-thread-demo
node "$REPO/scripts/verify/steps.mjs" "$OUT" jobs-rank
echo "jobs-rank: ok $(node -p "const r = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')); r.rank.length + ' roles, top: ' + r.rank[0].title" "$OUT/search.json")"
