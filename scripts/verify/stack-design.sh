#!/usr/bin/env bash
# done-done journey `stack-design` (needs Xvfb for the installed app): Chief's profile (J09c), How Chief works (J09d),
# Settings (J09a), the hire card's one-line names (A069), Home, and Your things (J07a) with a file open from it (J07b),
# on the real stub-engine crewd, at 390 and 1280, day and night; each beside its approved mock when EVIDENCE_HOME holds
# the final renders; the face motion (face-motion.mjs, both themes); and the installed app (a real Chromium install
# under Xvfb). Pages are driven by pwa-shell.mjs plans. Docs: docs/verification/settings-hub.md, chief-profile.md,
# home-stack.md, things.md.
#
#   [EVIDENCE_HOME=<dir>] scripts/verify/stack-design.sh "$DONE_DONE_EVIDENCE_ROOT"
#
# Seed: home-states.sh's busy Home, a Morning digest routine, and a second hire card with a long name (Translator
# Tess); after the hire cards are read, yes to Invoice Ivy and a spreadsheet of invoices from her. Exit 0 with the
# captures, non-zero otherwise. crewd's process group is emptied before the lab goes.
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

# One headless browser per plan (pwa-shell.mjs): `<name> <hash> <theme> <width> [js run before the shot]` per line.
# Every page waits for its own thing to be on screen before the shot; a missing one fails the run.
PLAN=$(cat <<'JS'
const [plan, profile, home, b, k, out] = process.argv.slice(1), steps = [{ name: 'boot', w: 390, h: 844, url: `${b}/?day#person=${k}`, settle: 1500, wait: "!location.hash.startsWith('#person')", timeout: 20000 }];
for (const line of require('fs').readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
  const [name, hash, theme, w, wait, js] = line.split('\t'), phone = Number(w) <= 500;
  steps.push({ name: `${name}-${theme}-${w}`, w: Number(w), h: phone ? 844 : 832, dpr: phone ? 3 : 1, mobile: phone, url: `${b}/?${theme}&r=${Math.random().toString(36).slice(2)}#${hash}`, settle: 1200,
    wait, timeout: 20000, ...(js ? { eval: `(async()=>{${js}})()` } : {}), out: `${out}/${name}-${theme}-${w}.png` });
}
require('fs').writeFileSync(plan, JSON.stringify({ profile, home, steps }));
JS
)
shots() { # <plan name>, the lines on stdin
  node -e "$PLAN" "$LAB/$1.json" "$LAB/$1-profile" "$LAB/$1-home" "$B" "$K" "$OUT/shots"
  node "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/$1.json" | sed "s|$K|<key>|g" > "$OUT/shots/$1.json" || { echo "stack-design: the $1 pages did not all show (shots/$1.json)" >&2; exit 1; }
  grep -o '"shot": "[^"]*"' "$OUT/shots/$1.json" | sed 's|.*/|stack-design: |; s|"$||'
}
T=$'\t'
LAST="const c=[...document.querySelectorAll('.stack-ask')];c[c.length-1]?.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,600));"
# Every hire card's name on one line inside its column, and its yes in the helper's first name.
NAMES="return JSON.stringify({names:[...document.querySelectorAll('.hire-name')].map(b=>({name:b.textContent,font:getComputedStyle(b).fontSize,oneLine:b.getBoundingClientRect().height<1.6*parseFloat(getComputedStyle(b).fontSize),fits:b.scrollWidth<=b.parentElement.clientWidth})),yes:[...document.querySelectorAll('.stack-ask .btn.go')].map(b=>b.textContent)})"
for t in day night; do
  for w in 390 1280; do
    echo "chief-profile$T/h/chief/details$T$t$T$w$T!!document.querySelector('.st-profile-hero')"
    echo "settings$T/settings$T$t$T$w$T!!document.querySelector('.settings')"
    echo "home$T/$T$t$T$w$T!!document.querySelector('.stack-home')"
  done
  echo "hire-card$T/chief$T$t${T}390$T!!document.querySelector('.hire-name')$T$LAST$NAMES"
done | shots design
for t in day night; do
  node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).find((x)=>x.step===process.argv[2])?.value;if(!v)process.exit(1);console.log(v)' "$OUT/shots/design.json" "hire-card-$t-390" | tee "$OUT/shots/hire-$t.txt"
  ! grep -q 'false' "$OUT/shots/hire-$t.txt" || { echo "stack-design: a hire name broke its line ($t)" >&2; exit 1; }
  grep -q 'Yes, bring Ivy on' "$OUT/shots/hire-$t.txt" || { echo "stack-design: the yes does not say Ivy's first name ($t)" >&2; exit 1; }
done

# Yes to Invoice Ivy, then her spreadsheet: the newest thing in Your things.
IVY=$(curl -fsS --max-time 10 "${H[@]}" "$B/api/state" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const a=JSON.parse(s).asks.find((x)=>x.state!=="answered"&&JSON.stringify(x).includes("Invoice Ivy"));if(!a)process.exit(1);console.log(a.id)})') \
  || { echo "stack-design: no open hire card for Invoice Ivy" >&2; exit 1; }
post "/api/asks/$IVY/answer" '{"answer":"allow"}'
post /api/bots/invoice-ivy/messages '{"text": "Put my invoices in one sheet [tool crew_workbook {\"name\": \"Your invoices\", \"sheets\": [{\"name\": \"Invoices\", \"columns\": [{\"header\": \"From\"}, {\"header\": \"Amount\"}, {\"header\": \"Due\"}, {\"header\": \"Paid?\", \"options\": [\"Yes\", \"No\"]}], \"rows\": [[\"Water board\", 42.5, \"Oct 8\", \"No\"], [\"Dentist\", 120, \"Oct 10\", \"No\"], [\"Phone\", 35, \"Oct 21\", \"Yes\"], [\"Northwind\", 42.5, \"Oct 24\", \"No\"]]}, {\"name\": \"Paid\", \"columns\": [{\"header\": \"From\"}, {\"header\": \"Amount\"}, {\"header\": \"Paid on\"}], \"rows\": [[\"Phone\", 35, \"Oct 2\"]]}]}]"}'
until_state '\.xlsx'
WIDE="!!document.querySelector('.st-things .wb-card')"
CARD="document.querySelector('.st-made .wb-card').click();await new Promise(r=>setTimeout(r,2500));return location.hash"
SEARCH="const i=document.querySelector('.st-search input'),set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'letter');i.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,600));return document.querySelectorAll('.st-made .wb-card').length"
for t in day night; do
  for w in 390 1280; do
    echo "things$T/things$T$t$T$w$T$WIDE"
    echo "chief-instructions$T/h/chief/instructions$T$t$T$w$T!!document.querySelector('.cw-card p')"
  done
  echo "things-file$T/things$T$t${T}390$T$WIDE$T$CARD"
  echo "things-file$T/things$T$t${T}1280$T$WIDE$T$CARD"
done | shots things
# The file opened from Your things is the read-only page, over Your things on a computer (About this file beside it).
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const t of ["day","night"])for(const w of [390,1280]){const v=r.find((x)=>x.step===`things-file-${t}-${w}`)?.value;if(!/^#\/f\/invoice-ivy\//.test(v??"")){console.error(`stack-design: things-file-${t}-${w} opened ${v}`);process.exit(1)}}' "$OUT/shots/things.json"
# The search: one word leaves only the thing that holds it.
printf 'things-search\t/things\tday\t1280\t%s\t%s\n' "$WIDE" "$SEARCH" | shots search
node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).find((x)=>x.step==="things-search-day-1280")?.value;if(v!==1){console.error(`stack-design: the search for letter left ${v} cards`);process.exit(1)}' "$OUT/shots/search.json"

if [ -n "$MOCK" ] && [ -d "$MOCK" ]; then
  pair() { magick "$MOCK/$2" -resize "$4x" "$OUT/shots/$3" -resize "$4x" -background '#888' -gravity north +append "$OUT/pairs/$1"; }
  for t in day night; do
    pair chief-profile-$t-390.png J09c-390-$t.png chief-profile-$t-390.png 780; pair chief-profile-$t-1280.png J09c-1280-$t.png chief-profile-$t-1280.png 1280
    pair settings-$t-390.png J09a-390-$t.png settings-$t-390.png 780; pair settings-$t-1280.png J09a-1280-$t.png settings-$t-1280.png 1280
    pair chief-instructions-$t-390.png J09d-390-$t.png chief-instructions-$t-390.png 780; pair chief-instructions-$t-1280.png J09d-1280-$t.png chief-instructions-$t-1280.png 1280
    pair hire-card-$t-390.png J04a-390-$t.png hire-card-$t-390.png 780
    pair home-$t-390.png J02c-390-$t.png home-$t-390.png 780; pair home-$t-1280.png J02c-1280-$t.png home-$t-1280.png 1280
    pair things-$t-390.png J07a-390-$t.png things-$t-390.png 780; pair things-$t-1280.png J07a-1280-$t.png things-$t-1280.png 1280
    pair things-file-$t-390.png J07b-390-$t.png things-file-$t-390.png 780; pair things-file-$t-1280.png J07b-1280-$t.png things-file-$t-1280.png 1280
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
    { "name": "things", "url": "$B/?day#/things", "settle": 2500, "eval": "document.querySelectorAll('.st-things .wb-card').length", "wshot": "$OUT/pwa/pwa-things-day-1400.png" },
    { "name": "cw-night", "url": "$B/?night#/h/chief/instructions", "settle": 2500, "wshot": "$OUT/pwa/pwa-chief-instructions-night-1400.png" },
    { "name": "cp-day-390", "w": 390, "h": 844, "dpr": 3, "mobile": true, "url": "$B/?day#/h/chief/details", "settle": 2500, "out": "$OUT/pwa/pwa-chief-profile-day-390.png" },
    { "name": "cp-night-390", "url": "$B/?night#/h/chief/details", "settle": 2500, "out": "$OUT/pwa/pwa-chief-profile-night-390.png" },
    { "name": "set-day-390", "url": "$B/?day#/settings", "settle": 2500, "out": "$OUT/pwa/pwa-settings-day-390.png" },
    { "name": "things-390", "url": "$B/?night#/things", "settle": 2500, "out": "$OUT/pwa/pwa-things-night-390.png" },
    { "name": "cw-day-390", "url": "$B/?day#/h/chief/instructions", "settle": 2500, "out": "$OUT/pwa/pwa-chief-instructions-day-390.png" },
    { "name": "standalone-390", "url": "$B/?night#/settings", "settle": 2500, "eval": "matchMedia('(display-mode: standalone)').matches", "out": "$OUT/pwa/pwa-settings-night-390.png" }
  ] }
JSON
xvfb-run -a -s "-screen 0 1920x1200x24" node "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/pwa/plan.json" | sed "s|$K|<key>|g" > "$OUT/pwa/pwa-shell.json"
node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).filter((x)=>x.step==="standalone"||x.step==="no-install-row"||x.step==="standalone-390");if(s.length!==3||!s.every((x)=>x.value===true))process.exit(1)' "$OUT/pwa/pwa-shell.json" \
  || { echo "stack-design: the installed window was not standalone or still offered Install" >&2; exit 1; }
node "$REPO/scripts/verify/steps.mjs" "$OUT" stack-design
echo "stack-design: $(find "$OUT" -name '*.png' | wc -l) captures in $OUT"
