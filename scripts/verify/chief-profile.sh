#!/usr/bin/env bash
# done-done journey `chief-profile` (needs Xvfb and Chromium): Chief's profile (mock profile-b on the final Stack J09c)
# opened from his hero, on the real stub-engine crewd, at 390 and 1440, day and night. First with no computer in the
# crew (its honest empty state), then with Chief's own: Routines with Add a routine, the Computer live with Take
# control, Take control landing on "You have control" with Hand it back, and Hand it back returning the controls;
# then the same profile in the installed app. Docs: docs/verification/chief-profile.md.
#
#   scripts/verify/chief-profile.sh "$DONE_DONE_EVIDENCE_ROOT"
#
# Exit 0 with the captures, non-zero otherwise. crewd's process group is emptied before the lab goes.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: chief-profile.sh <evidence-dir>" >&2; exit 2; }
OUT=$1; mkdir -p "$OUT"/{shots,pwa}
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-profile.XXXXXX)
trap 'crewhouse_remove_lab "$LAB"' EXIT
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
for _ in $(seq 600); do
  if [ -f "$LAB/state/person.key" ]; then
    K=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $K" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  sleep 0.25
done
[ -n "$K" ] || { echo "chief-profile: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $K")
call() { curl -fsS --max-time 10 "${H[@]}" -X "$1" ${3:+-d "$3"} "$B$2" > /dev/null || { echo "chief-profile: $1 $2 failed" >&2; return 1; }; }
controls() { curl -fsS --max-time 10 "${H[@]}" "$B/api/state" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>console.log(JSON.parse(s).bots.find((b)=>b.id==="chief").controls))'; }
call POST /api/onboard '{"address":"Umer"}'
# Chief's tools as granted, and the same without his computer: the crew then has none (the empty state).
TOOLS=$(curl -fsS --max-time 10 "${H[@]}" "$B/api/bots/chief" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).tools.filter((t)=>t.granted).map((t)=>t.id))))')
case $TOOLS in *'"computer"'*) ;; *) echo "chief-profile: Chief has no computer granted ($TOOLS)" >&2; exit 1 ;; esac
call PUT /api/bots/chief/tools "{\"tools\":$(node -e 'console.log(JSON.stringify(JSON.parse(process.argv[1]).filter((t)=>t!=="computer")))' "$TOOLS")}"

# One headless browser per plan (pwa-shell.mjs): `<name> <hash> <theme> <width> <wait> [js run before the shot]` per line.
PLAN=$(cat <<'JS'
const [plan, profile, home, b, k, out] = process.argv.slice(1), steps = [{ name: 'boot', w: 390, h: 844, url: `${b}/?day#person=${k}`, settle: 1500, wait: "!location.hash.startsWith('#person')", timeout: 20000 }];
for (const line of require('fs').readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
  const [name, hash, theme, w, wait, js] = line.split('\t'), phone = Number(w) <= 500;
  steps.push({ name: `${name}-${theme}-${w}`, w: Number(w), h: phone ? 844 : 900, dpr: phone ? 3 : 1, mobile: phone, url: `${b}/?${theme}&r=${Math.random().toString(36).slice(2)}#${hash}`, settle: 1200,
    wait, timeout: 30000, ...(js ? { eval: `(async()=>{${js}})()` } : {}), out: `${out}/${name}-${theme}-${w}.png` });
}
require('fs').writeFileSync(plan, JSON.stringify({ profile, home, steps }));
JS
)
shots() { # <plan name>, the lines on stdin
  node -e "$PLAN" "$LAB/$1.json" "$LAB/$1-profile" "$LAB/$1-home" "$B" "$K" "$OUT/shots"
  node "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/$1.json" | sed "s|$K|<key>|g" > "$OUT/shots/$1.json" || { echo "chief-profile: the $1 pages did not all show (shots/$1.json)" >&2; exit 1; }
}
value() { node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).find((x)=>x.step===process.argv[2])?.value;if(v===undefined)process.exit(1);console.log(typeof v==="string"?v:JSON.stringify(v))' "$OUT/shots/$1.json" "$2"; }
T=$'\t'
# Bring a section into view below the sticky top and report what a person reads there.
AT() { echo "const e=document.querySelector('$1');e.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,700));return JSON.stringify({text:e.closest('.card')?.innerText??e.innerText,fits:document.scrollingElement.scrollWidth<=innerWidth});"; }
for t in day night; do for w in 390 1440; do
  echo "empty$T/h/chief/details$T$t$T$w$T!!document.querySelector('.cp-none')$T$(AT .cp-none)"
done; done | shots empty
for t in day night; do for w in 390 1440; do
  v=$(value empty "empty-$t-$w"); echo "$v" | grep -q 'No computer yet' && echo "$v" | grep -q '"fits":true' || { echo "chief-profile: empty-$t-$w: $v" >&2; exit 1; }
done; done

# Chief's computer back, and a helper's routine on the profile.
call PUT /api/bots/chief/tools "{\"tools\":$TOOLS}"
call POST /api/recruit '{"template":"scribe","name":"Writer Will"}'
call POST /api/routines '{"bot":"writer-will","schedule":"every day at 8:00","task":"Tell me what is on today","name":"Morning digest"}'
# Chief's hero opens the profile.
HERO="document.querySelector('.ch-name a').click();await new Promise(r=>setTimeout(r,1500));return location.hash"
LIVE="!!document.querySelector('.peek-live.on')"
{
  echo "hero$T/chief${T}day${T}390$T!!document.querySelector('.ch-name a')$T$HERO"
  for t in day night; do
    echo "top$T/h/chief/details$T$t${T}390$T!!document.querySelector('.st-profile-hero')"
    for w in 390 1440; do echo "profile$T/h/chief/details$T$t$T$w$T$LIVE$T$(AT .cp-take)"; done
  done
} | shots live
[ "$(value live hero-day-390)" = '#/h/chief/details' ] || { echo "chief-profile: Chief's hero opened $(value live hero-day-390)" >&2; exit 1; }
for t in day night; do for w in 390 1440; do
  v=$(value live "profile-$t-$w"); for want in 'Live' "Chief's computer" 'Take control' '"fits":true'; do
    echo "$v" | grep -qF "$want" || { echo "chief-profile: profile-$t-$w lacks $want: $v" >&2; exit 1; }; done
done; done

# Take control on the profile: the controls are the person's, and Chief's screen says so with Hand it back.
TAKE="const b=document.querySelector('.cp-take');b.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,500));b.click();"
TAKE+="for(let i=0;i<150&&!(document.querySelector('.hand-back')&&document.querySelector('.card.screen .pill.ok')&&document.body.innerText.includes('You have control'));i++)await new Promise(r=>setTimeout(r,200));"
TAKE+="await new Promise(r=>setTimeout(r,1500));return location.hash"
# The stream's first frames after a reload are still painting: a short look before the shot.
PAINT="await new Promise(r=>setTimeout(r,2500));return document.querySelector('.card.screen .pill').innerText"
HELD="!!document.querySelector('.screen-held') && !!document.querySelector('.card.screen .pill.ok') && document.body.innerText.includes('You have control')"
{
  echo "take-control$T/h/chief/details${T}day${T}390$T$LIVE$T$TAKE"
  echo "you-have-control$T/h/chief/screen${T}night${T}390$T$HELD$T$PAINT"
  for t in day night; do echo "you-have-control$T/h/chief/screen$T$t${T}1440$T$HELD$T$PAINT"; done
} | shots take
[ "$(value take take-control-day-390)" = '#/h/chief/screen' ] || { echo "chief-profile: Take control opened $(value take take-control-day-390)" >&2; exit 1; }
[ "$(controls)" = person ] || { echo "chief-profile: Take control left the controls with Chief" >&2; exit 1; }

# Hand it back on Chief's screen: the controls go back to Chief.
BACK="document.querySelector('.hand-back .btn').click();for(let i=0;i<100&&document.querySelector('.hand-back');i++)await new Promise(r=>setTimeout(r,200));await new Promise(r=>setTimeout(r,1000));return document.body.innerText.includes('Take control')"
printf 'handed-back\t/h/chief/screen\tday\t390\t%s\t%s\n' "!!document.querySelector('.hand-back')" "$BACK" | shots back
for _ in $(seq 40); do [ "$(controls)" = bot ] && break; sleep 0.25; done
[ "$(controls)" = bot ] || { echo "chief-profile: Hand it back left the controls with the person" >&2; exit 1; }

# The installed app: Chromium's own install from Settings, then Chief's profile with his computer in its window.
cat > "$LAB/pwa/plan.json" <<JSON
{ "profile": "$LAB/pwa/profile", "home": "$LAB/pwa/home", "headless": false, "xkey": "$REPO/scripts/verify/xkey.py",
  "args": ["--window-size=1440,950", "--force-device-scale-factor=1", "about:blank"],
  "steps": [
    { "name": "boot", "url": "$B/?day#person=$K", "settle": 3000 },
    { "name": "settings", "url": "$B/?day#/settings", "settle": 2500 },
    { "name": "install", "click": ".install .btn" },
    { "name": "tab", "key": "Tab" }, { "name": "enter", "key": "Return" },
    { "name": "attach", "attachApp": "$B" },
    { "name": "standalone", "win": [1440, 950], "url": "$B/?day#/h/chief/details", "settle": 2500, "wait": "$LIVE", "eval": "matchMedia('(display-mode: standalone)').matches", "wshot": "$OUT/pwa/pwa-chief-profile-day-1440.png" },
    { "name": "night", "url": "$B/?night#/h/chief/details", "settle": 2500, "wait": "$LIVE", "wshot": "$OUT/pwa/pwa-chief-profile-night-1440.png" },
    { "name": "phone", "w": 390, "h": 844, "dpr": 3, "mobile": true, "url": "$B/?day#/h/chief/details", "settle": 2500, "wait": "$LIVE", "eval": "(async()=>{document.querySelector('.cp-take').scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,700));return matchMedia('(display-mode: standalone)').matches})()", "out": "$OUT/pwa/pwa-chief-profile-day-390.png" }
  ] }
JSON
xvfb-run -a -s "-screen 0 1920x1200x24" node "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/pwa/plan.json" | sed "s|$K|<key>|g" > "$OUT/pwa/pwa-shell.json"
node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).filter((x)=>x.step==="standalone"||x.step==="phone");if(s.length!==2||!s.every((x)=>x.value===true))process.exit(1)' "$OUT/pwa/pwa-shell.json" \
  || { echo "chief-profile: the installed window was not standalone" >&2; exit 1; }
node "$REPO/scripts/verify/steps.mjs" "$OUT" chief-profile
echo "chief-profile: $(find "$OUT" -name '*.png' | wc -l) captures in $OUT"
