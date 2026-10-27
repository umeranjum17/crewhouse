#!/usr/bin/env bash
# done-done journey `jobs-apply`: from Umer's drafted application to the one approval card, on a real stub-engine crewd and
# the writer's real browser (the pinned playwright-axi). The model's turns are scripted; the gate, crewd's reading of the
# page and its press of Submit are real. Captures the draft card (Fill it in for me), the form card (what was filled from
# the CV and draft, the questions only Umer answers left blank, Submit), then, on the local posting only, the board after
# his Submit, and the reading pack the writer delivers beside the card. Each at 390 and 1280, day and night, through home-gate.mjs, plus the form card in the installed app (a real
# Chromium install from Settings, under xvfb-run) at 390.
#
#   BROWSER_TOOLS=<tools-dir> scripts/verify/jobs-apply.sh <out-dir>                          the local posting and its form
#   BROWSER_TOOLS=<tools-dir> scripts/verify/jobs-apply.sh <out-dir> <posting-url> <company> <title>   a real posting: stops at the card
# <tools-dir> holds an installed browser tool (CREWHOUSE_TOOLS_DIR=<tools-dir> ./crewhouse tools install browser). Needs /usr/bin/chromium.
# A real posting is only read and typed into: nothing is pressed after the first line, and Submit is never tapped.
set -euo pipefail
[ $# -eq 1 ] || [ $# -eq 4 ] || { echo "usage: jobs-apply.sh <out-dir> [<posting-url> <company> <title>]" >&2; exit 2; }
[ -n "${BROWSER_TOOLS:-}" ] && [ -e "$BROWSER_TOOLS/bin/playwright-axi" ] || { echo "jobs-apply: set BROWSER_TOOLS to a tools folder with the browser installed" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-apply.XXXXXX)
POSTING=""
trap '[ -z "$POSTING" ] || kill "$POSTING" 2>/dev/null; crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,run}
free_port() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
PORT=$(free_port); B="http://127.0.0.1:$PORT"
if [ $# -eq 1 ]; then
  PPORT=$(free_port)
  node "$REPO/scripts/verify/jobs-apply.mjs" serve "$PPORT" "$LAB/sent.json" &
  POSTING=$!
  set -- "$1" "http://127.0.0.1:$PPORT/job/1" Northwind 'Frontend Engineer'; PAY='£55,000 to £65,000 a year'; REAL=""
else PAY=""; REAL=1; fi
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$BROWSER_TOOLS" \
  "${NODE:-node}" "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "jobs-apply: crewd never became ready" >&2; exit 1; }
drive() { local s=$1; shift; node "$REPO/scripts/verify/jobs-apply.mjs" "$s" "$B" "$PERSON" "$@"; }
hash_gate() {
  local js="(async () => { location.hash = '#$2'; await new Promise((r) => setTimeout(r, 900)); ${3:-} })()"
  node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT" "$1" "$js"
}
IDS=$(drive board "$2" "$3" "$4" "$PAY"); DRAFT=$(node -p "JSON.parse(process.argv[1]).ask" "$IDS")
# The draft card scrolled to its choices: Fill it in for me first.
DOWN="for (let e = document.querySelector('.ev'); e; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) { e.scrollTop = e.scrollHeight; break; }"
hash_gate draft "/ask/$DRAFT" "$DOWN"
FORM=$(drive fill "$LAB/crew" "$LAB/state" "$BROWSER_TOOLS")
cp "$LAB/form-snapshot.txt" "$OUT/form-snapshot.txt"
# What the card holds, and every browser call the writer made with the gate's answer (refusals are the calls with no run.call).
get() { curl -fsS -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B$1"; }
get /api/state | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>console.log(JSON.stringify(JSON.parse(s).asks.find((a)=>a.detail?.form)?.detail.form,null,1)))' > "$OUT/form-card.json"
get /api/events | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>console.log(JSON.parse(s).filter((e)=>/^run\.(call|tool)$|^message$/.test(e.kind)).map((e)=>JSON.stringify(e)).join("\n")))' > "$OUT/writer-calls.jsonl"
hash_gate form "/ask/$FORM"
# The reading pack beside it, opened from the writer's thread: crewd's .docx of the checked facts, read back.
WILL=$(get /api/state | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>console.log(JSON.parse(s).goals[0].goal.will))')
hash_gate pack "/h/$WILL" "[...document.querySelectorAll('a.wb-card')].find((a) => /Reading pack/i.test(a.getAttribute('aria-label')))?.click(); await new Promise((r) => setTimeout(r, 1500));"
# The installed app: Chromium's own install from Settings, then the form card in its window at phone size.
mkdir -p "$LAB/pwa" "$OUT/pwa"
cat > "$LAB/pwa/plan.json" <<JSON
{ "profile": "$LAB/pwa/profile", "home": "$LAB/pwa/home", "headless": false, "xkey": "$REPO/scripts/verify/xkey.py",
  "args": ["--window-size=1400,950", "--force-device-scale-factor=1", "about:blank"],
  "steps": [
    { "name": "boot", "url": "$B/?day#person=$PERSON", "settle": 3000 },
    { "name": "settings", "url": "$B/?day#/settings", "settle": 2500 },
    { "name": "install", "click": ".install .btn" },
    { "name": "tab", "key": "Tab" }, { "name": "enter", "key": "Return" },
    { "name": "attach", "attachApp": "$B" },
    { "name": "standalone-day", "w": 390, "h": 844, "dpr": 3, "mobile": true, "url": "$B/?day#/ask/$FORM", "settle": 2500, "eval": "matchMedia('(display-mode: standalone)').matches", "out": "$OUT/pwa/pwa-form-390-day.png" },
    { "name": "standalone-night", "url": "$B/?night#/ask/$FORM", "settle": 2500, "eval": "matchMedia('(display-mode: standalone)').matches", "out": "$OUT/pwa/pwa-form-390-night.png" }
  ] }
JSON
xvfb-run -a -s "-screen 0 1920x1200x24" node "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/pwa/plan.json" | sed "s|$PERSON|<key>|g" > "$OUT/pwa/pwa-shell.json"
node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).filter((x)=>/^standalone/.test(x.step));if(s.length!==2||!s.every((x)=>x.value===true))process.exit(1)' "$OUT/pwa/pwa-shell.json" \
  || { echo "jobs-apply: the installed window was not standalone" >&2; exit 1; }
# The same card with his answers typed in (as his own taps would), scrolled down to its Submit.
ANSWER="const put = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  for (const q of document.querySelectorAll('.form-q')) { const i = q.querySelector('input, select'), t = q.textContent; if (!i) continue;
    if (i.type === 'checkbox') { if (/consent/i.test(t)) i.click(); } else if (i.tagName === 'SELECT') put(i, 'No'); else put(i, /salary/i.test(t) ? '£60,000' : /mail/i.test(t) ? 'umer@example.com' : ''); }
  await new Promise((r) => setTimeout(r, 300));
  for (let e = document.querySelector('.form-ev'); e; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) { e.scrollTop = e.scrollHeight; break; }"
hash_gate form-answered "/ask/$FORM" "$ANSWER"
if [ -z "$REAL" ]; then
  drive submit > "$OUT/stages.json"
  cp "$LAB/sent.json" "$OUT/sent.json"
  hash_gate applied /goal "[...document.querySelectorAll('.goal-chips button')].find((b) => /^Applied/.test(b.textContent))?.click()"
fi
node "$REPO/scripts/verify/steps.mjs" "$OUT" jobs-apply
echo "jobs-apply: ok ${REAL:+real }form=$FORM"
