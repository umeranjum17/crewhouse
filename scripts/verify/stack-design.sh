#!/usr/bin/env bash
# done-done journey `stack-design` (hand/agent only: needs a browser session and Xvfb): Chief's profile (J09c), its
# Instructions page (J09d), Settings (J09a), the hire card's one-line names (A069) and Home on the real stub-engine
# crewd, at 390 and 1280, day and night; each beside its approved mock when EVIDENCE_HOME holds the final renders;
# the face motion (face-motion.mjs, both themes); and the installed app (a real Chromium install under Xvfb) on
# Chief's profile and Settings. Docs: docs/verification/settings-hub.md, chief-profile.md, home-stack.md.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> [EVIDENCE_HOME=<dir>] scripts/verify/stack-design.sh "$DONE_DONE_EVIDENCE_ROOT"
#
# Seed: home-states.sh's busy Home, a Morning digest routine, and a second hire card with a long name (Translator
# Tess). Exit 0 with the captures, non-zero otherwise. crewd's process group is emptied before the lab goes.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: stack-design.sh <evidence-dir>" >&2; exit 2; }
OUT=$1; mkdir -p "$OUT"/{shots,pairs,motion,pwa}
REPO=$(git rev-parse --show-toplevel)
MOCK=${EVIDENCE_HOME:+$EVIDENCE_HOME/data/evidence/ch-canvas-overlap-start/final}
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-stack.XXXXXX)
trap 'crewd_stop || exit 1; chmod -R u+w "$LAB" 2>/dev/null; rm -rf -- "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run,pwa}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
(cd "$REPO" && npm run -s build:web)
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts"
K=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    K=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $K" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  sleep 0.25
done
[ -n "$K" ] || { echo "stack-design: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $K")
post() { curl -fsS --max-time 10 "${H[@]}" -d "$2" "$B$1" > /dev/null || { echo "stack-design: POST $1 failed" >&2; return 1; }; }
until_state() { for _ in $(seq 120); do curl -fsS --max-time 10 "${H[@]}" "$B/api/state" | grep -q "$1" && return 0; sleep 0.25; done; echo "stack-design: never saw $1" >&2; return 1; }
hire() { printf '{"text":"%s [tool crew_create {\\"name\\": \\"%s\\", \\"role\\": \\"%s\\", \\"job\\": {\\"does\\": \\"%s\\", \\"aim\\": \\"%s\\", \\"gets\\": \\"%s\\", \\"how\\": \\"%s\\", \\"great\\": \\"%s\\"}, \\"personality\\": \\"Calm.\\", \\"first\\": \\"%s\\"}]"}' "$@"; }
post /api/onboard '{"address":"Umer"}'
post /api/recruit '{"template":"scout","name":"Research Rae"}'
post /api/recruit '{"template":"scribe","name":"Writer Will"}'
post /api/bots/writer-will/messages '{"text": "Write to the landlord about the heating [tool crew_document {\"name\": \"Heating letter\", \"blocks\": [{\"heading\": \"Dear landlord\"}, {\"text\": \"The heating has been off since Monday. Please send someone this week.\"}]}]"}'
post /api/bots/chief/messages "$(hire 'I need someone to sort out my invoices' 'Invoice Ivy' 'Keeps your invoices in order' 'Sorts your invoices.' 'Nothing you owe slips past its due date.' 'Invoices you share.' 'One sheet by due date.' 'Two due this week, flagged first.' 'Sort out my invoices')"
until_state 'Invoice Ivy onto'
post /api/routines '{"bot":"writer-will","schedule":"every day at 8:00","task":"Tell me what is on today","name":"Morning digest"}'
post /api/bots/research-rae/messages '{"text":"Compare six phone plans that keep my number, and ask permission before you pick"}'
until_state '"state":"done"'
post /api/bots/chief/messages "$(hire 'I need someone to translate my letters' 'Translator Tess' 'Turns your letters into plain English' 'Translates letters.' 'You understand every letter.' 'Letters you share.' 'One page each.' 'Same day.' 'Translate my tax letter')"
until_state 'Translator Tess onto'

export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
a() { timeout -k 5 90 chrome-devtools-axi "$@"; }
first=$( (a pages 2>/dev/null || true) | awk -F, 'NR>1 { gsub(/ /, "", $1); if ($1 ~ /^[0-9]+$/) { print $1; exit } }')
if [ -n "$first" ]; then a selectpage "$first" > /dev/null; else a newpage about:blank > /dev/null; fi
shot() { # <name> <hash> <theme> <width> [js run before the shot]
  if [ "$4" -le 500 ]; then a emulate --viewport "${4}x844x3,mobile,touch" > /dev/null; else a emulate --viewport "${4}x832x1" > /dev/null; fi
  a open "$B/?$3&r=$RANDOM#person=$K" > /dev/null
  a eval "(async()=>{for(let i=0;i<50&&location.hash.startsWith('#person');i++)await new Promise(r=>setTimeout(r,100));location.hash='$2';await new Promise(r=>setTimeout(r,1800));${5:-}return location.hash})()" > /dev/null
  a screenshot "$OUT/shots/$1-$3-$4.png" > /dev/null; echo "stack-design: $1-$3-$4"
}
LAST="const c=[...document.querySelectorAll('.stack-ask')];c[c.length-1]?.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,600));"
for t in day night; do
  for w in 390 1280; do shot chief-profile '#/h/chief/details' $t $w; shot settings '#/settings' $t $w; shot home '#/' $t $w; done
  shot chief-instructions '#/h/chief/instructions' $t 390
  shot hire-card '#/chief' $t 390 "$LAST"
  # Every hire card's name on one line inside its column, and its yes in the helper's first name.
  a eval "JSON.stringify({names:[...document.querySelectorAll('.hire-name')].map(b=>({name:b.textContent,font:getComputedStyle(b).fontSize,oneLine:b.getBoundingClientRect().height<1.6*parseFloat(getComputedStyle(b).fontSize),fits:b.scrollWidth<=b.parentElement.clientWidth})),yes:[...document.querySelectorAll('.stack-ask .btn.go')].map(b=>b.textContent)})" | head -1 | tee "$OUT/shots/hire-$t.txt"
  ! grep -q 'false' "$OUT/shots/hire-$t.txt" || { echo "stack-design: a hire name broke its line ($t)" >&2; exit 1; }
  grep -q 'Yes, bring Ivy on' "$OUT/shots/hire-$t.txt" || { echo "stack-design: the yes does not say Ivy's first name ($t)" >&2; exit 1; }
done
if [ -n "$MOCK" ] && [ -d "$MOCK" ]; then
  pair() { magick "$MOCK/$2" -resize "$4x" "$OUT/shots/$3" -resize "$4x" -background '#888' -gravity north +append "$OUT/pairs/$1"; }
  for t in day night; do
    pair chief-profile-$t-390.png J09c-390-$t.png chief-profile-$t-390.png 780; pair chief-profile-$t-1280.png J09c-1280-$t.png chief-profile-$t-1280.png 1280
    pair settings-$t-390.png J09a-390-$t.png settings-$t-390.png 780; pair settings-$t-1280.png J09a-1280-$t.png settings-$t-1280.png 1280
    pair chief-instructions-$t-390.png J09d-390-$t.png chief-instructions-$t-390.png 780; pair hire-card-$t-390.png J04a-390-$t.png hire-card-$t-390.png 780
    pair home-$t-390.png J02c-390-$t.png home-$t-390.png 780; pair home-$t-1280.png J02c-1280-$t.png home-$t-1280.png 1280
  done
else echo "stack-design: no EVIDENCE_HOME mocks; captures only" >&2; fi
for t in day night; do node "$REPO/scripts/verify/face-motion.mjs" "$B/#person=$K" "$OUT/motion" $t; done

# The installed app: Chromium's own install from Settings, then Chief's profile and Settings in its window.
cat > "$LAB/pwa/plan.json" <<JSON
{ "profile": "$LAB/pwa/profile", "home": "$LAB/pwa/home", "headless": false, "xkey": "$REPO/scripts/verify/xkey.py",
  "args": ["--window-size=1400,950", "--force-device-scale-factor=1", "about:blank"],
  "steps": [
    { "name": "boot", "url": "$B/?day#person=$K", "settle": 3000 },
    { "name": "settings", "url": "$B/?day#/settings", "settle": 2500 },
    { "name": "install", "click": ".install .btn" },
    { "name": "tab", "key": "Tab" }, { "name": "enter", "key": "Return" },
    { "name": "screen", "xshot": "$OUT/pwa/installed-screen.png" },
    { "name": "attach", "attachApp": "$B" },
    { "name": "standalone", "win": [1400, 950], "url": "$B/?day#/h/chief/details", "settle": 2500, "eval": "matchMedia('(display-mode: standalone)').matches", "wshot": "$OUT/pwa/pwa-chief-profile-day-1400.png" },
    { "name": "cp-night", "url": "$B/?night#/h/chief/details", "settle": 2500, "wshot": "$OUT/pwa/pwa-chief-profile-night-1400.png" },
    { "name": "no-install-row", "url": "$B/?day#/settings", "settle": 2500, "eval": "!document.querySelector('.install')", "wshot": "$OUT/pwa/pwa-settings-day-1400.png" },
    { "name": "set-night", "url": "$B/?night#/settings", "settle": 2500, "wshot": "$OUT/pwa/pwa-settings-night-1400.png" },
    { "name": "cp-day-390", "w": 390, "h": 844, "dpr": 3, "mobile": true, "url": "$B/?day#/h/chief/details", "settle": 2500, "out": "$OUT/pwa/pwa-chief-profile-day-390.png" },
    { "name": "cp-night-390", "url": "$B/?night#/h/chief/details", "settle": 2500, "out": "$OUT/pwa/pwa-chief-profile-night-390.png" },
    { "name": "set-day-390", "url": "$B/?day#/settings", "settle": 2500, "out": "$OUT/pwa/pwa-settings-day-390.png" },
    { "name": "standalone-390", "url": "$B/?night#/settings", "settle": 2500, "eval": "matchMedia('(display-mode: standalone)').matches", "out": "$OUT/pwa/pwa-settings-night-390.png" }
  ] }
JSON
xvfb-run -a -s "-screen 0 1920x1200x24" node "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/pwa/plan.json" | sed "s|$K|<key>|g" > "$OUT/pwa/pwa-shell.json"
node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).filter((x)=>x.step==="standalone"||x.step==="no-install-row"||x.step==="standalone-390");if(s.length!==3||!s.every((x)=>x.value===true))process.exit(1)' "$OUT/pwa/pwa-shell.json" \
  || { echo "stack-design: the installed window was not standalone or still offered Install" >&2; exit 1; }
node "$REPO/scripts/verify/steps.mjs" "$OUT" stack-design
echo "stack-design: $(find "$OUT" -name '*.png' | wc -l) captures in $OUT"
