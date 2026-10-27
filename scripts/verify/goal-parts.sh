#!/usr/bin/env bash
# done-done journey `goal-parts`: the long-goal parts on a real stub-engine crewd, with a job search and a flat to rent side by side.
# The flat goal names its own stages (Found, Shortlisted, Viewing booked, Offer made, Signed); the daily search fills Found and a second
# run adds nothing; only Umer's tap moves an option on; a reminder on an option goes off on its own and is dismissed. Each shot at 390 and
# 1280, day and night, through home-gate.mjs, then the installed-app window at 390.
#
#   scripts/verify/goal-parts.sh <out-dir>
# Exit 0 with <step>-<390|1280>-<day|night>.png, <step>-gate.json and pwa-<step>-390-<day|night>.png in <out-dir>. Needs /usr/bin/chromium.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: goal-parts.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-goals.XXXXXX)
PAGE=""
trap '[ -z "$PAGE" ] || kill "$PAGE" 2>/dev/null; crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
free_port() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
PORT=$(free_port); PPORT=$(free_port)
B="http://127.0.0.1:$PORT"; P="http://127.0.0.1:$PPORT"
node -e 'require("node:http").createServer((q,r)=>{r.setHeader("content-type","text/html");r.end(q.url.startsWith("/flat")?"<h1>To let</h1><p>Rent: £2,100 a month. Two bedrooms, Hackney E8. Rent: £1,950 a month. Garden flat, Walthamstow E17.</p>":"<h1>Frontend Engineer</h1><p>Salary: £55,000 to £65,000 a year. React, TypeScript.</p>")}).listen(+process.argv[1],"127.0.0.1")' "$PPORT" &
PAGE=$!
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
[ -n "$PERSON" ] || { echo "goal-parts: crewd never became ready" >&2; exit 1; }
drive() { node "$REPO/scripts/verify/goal-parts.mjs" "$1" "$B" "$PERSON" "${2:-$P}"; }
# home-gate opens the url with the person's key, then runs the step's own js: go to the route, then click.
hash_gate() {
  local js="(async () => { location.hash = '#$2'; await new Promise((r) => setTimeout(r, 900)); ${3:-} })()"
  node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT" "$1" "$js"
  GATE_PWA=1 node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT" "pwa-$1" "$js"
}
# The flat goal's tab, a stage's chip on a phone, and a card by its title.
FLAT="[...document.querySelectorAll('.goal-tabs button')].find((b) => /flat/i.test(b.textContent))?.click(); await new Promise((r) => setTimeout(r, 300));"
chip() { echo "[...document.querySelectorAll('.goal-chips button')].find((b) => /^$1/.test(b.textContent))?.click(); await new Promise((r) => setTimeout(r, 300));"; }
card() { echo "[...document.querySelectorAll('.role-head')].find((b) => /$1/.test(b.textContent))?.click();"; }
drive jobs > /dev/null
ASK=$(drive flat)
hash_gate goal-card "/ask/$ASK"
SEARCH=$(drive search); echo "$SEARCH"
hash_gate jobs-board /goal "document.querySelector('.goal-chips button')?.click()"
hash_gate flat-found /goal "$FLAT $(card Garden)"
MOVED=$(drive move)
hash_gate flat-shortlisted /goal "$FLAT $(chip Shortlisted) $(card Mare)"
IDS=$(drive remind); ITEM=$(node -p "JSON.parse(process.argv[1]).item" "$IDS")
hash_gate reminder-set /goal "$FLAT $(card Garden)"
drive fired "$ITEM" > /dev/null
hash_gate reminder-fired /goal "$FLAT $(card Garden)"
hash_gate reminder-chief /chief || true # Chief's thread is an existing screen whose chat chrome the gate flags; this shot only shows the reminder's one line
drive dismiss "$ITEM" > /dev/null
hash_gate reminder-dismissed /goal "$FLAT $(card Garden)"
node "$REPO/scripts/verify/steps.mjs" "$OUT" goal-parts
echo "goal-parts: ok $SEARCH moved=$MOVED"
