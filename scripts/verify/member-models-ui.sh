#!/usr/bin/env bash
# done-done journey `member-models-ui` (needs a browser session and `npm run build:web`): one isolated stub-engine
# crewd with Scout, Quill and Reel hired, every account signed in but Grok. The crew is put on ChatGPT from Settings,
# Chief takes "Use ChatGPT for Scout on the quick model." in chat, and then, on the screen, Quill's row in Settings ›
# AI accounts › Who uses which is changed in place to GitHub Copilot (Quick 1) by real clicks. The script checks the crew
# folder's models.json holds that pick and Quill's next job runs on that account (run.started; the model is pinned by
# test/member-models.test.ts), gives Scout a job that hits a limit, hand-
# deletes Reel's line (a member nobody chose for), then captures Settings › AI accounts, the open picker and Scout's
# page, dark and light at 360, 390, 445, 1280 and 1440, into <out>/screens/, and both again in the installed app
# (<out>/pwa/).
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/member-models-ui.sh "$DONE_DONE_EVIDENCE_ROOT"
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: member-models-ui.sh <evidence-dir>" >&2; exit 2; }
OUT=$1; mkdir -p "$OUT/screens"
REPO=$(git rev-parse --show-toplevel)
[ -f "$REPO/web/dist/index.html" ] || { echo "member-models-ui: run npm run build:web first" >&2; exit 1; }
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-mm-ui.XXXXXX)
trap 'rc=$?; [ "$rc" = 0 ] || cp "$LAB/crewd.log" "$OUT/crewd-ui.log" 2>/dev/null; crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
case "$(command -v node)" in */mise/shims/*) mkdir "$LAB/bin" && ln -s /usr/bin/node /usr/bin/npm /usr/bin/npx "$LAB/bin/" && export PATH=$LAB/bin:$PATH;; esac # as member-models-screens.sh: the distro node under done-done's clean environment
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_STUB_GOLDEN=1 CREWHOUSE_PORT="$PORT" \
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
[ -n "$PERSON" ] || { echo "member-models-ui: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl -fsS --max-time 10 "${H[@]}" -X "${3:-POST}" -d "$2" "$B$1" > /dev/null; }
models() { node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]] ?? null))' "$LAB/crew/models.json" "$1"; }
wait_for() { for _ in $(seq 120); do eval "$2" && return 0; sleep 0.25; done; echo "member-models-ui: timed out: $1" >&2; exit 1; }
last_run() { node -e 'const db = new (require("node:sqlite").DatabaseSync)(process.argv[1], { readOnly: true }); const r = db.prepare("SELECT data FROM events WHERE kind = ? AND bot = ? ORDER BY seq DESC LIMIT 1").get("run.started", process.argv[2]); db.close(); process.stdout.write(r ? r.data : "")' "$LAB/state/crew.db" "$1"; }
post /api/onboard '{"address":"Umer"}'
post /api/recruit '{"template":"scout","name":"Scout"}'
post /api/recruit '{"template":"scribe","name":"Quill"}'
post /api/recruit '{"template":"reel","name":"Reel"}'
post /api/accounts/1/chatgpt/model '{"model":"strong-1"}' PUT
post /api/bots/chief/messages '{"text":"Use ChatGPT for Scout on the quick model."}'
wait_for 'Chief takes the order' '[ "$(models scout)" = "[\"chatgpt:quick-1\"]" ]'

export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
axi() { timeout -k 10 120 chrome-devtools-axi "$@"; }
pages_out=$(axi pages); first=$(printf '%s\n' "$pages_out" | awk -F, 'NR>1 { gsub(/ /, "", $1); if ($1 ~ /^[0-9]+$/) { print $1; exit } }')
if [ -n "$first" ]; then axi selectpage "$first" > /dev/null; else axi newpage about:blank > /dev/null; fi
axi emulate --viewport 390x844x3,mobile,touch > /dev/null
# The person's key rides the first open; a fresh browser can drop it, so open again until Settings answers.
row() { printf "[...document.querySelectorAll('.member-ai')].find((r) => r.querySelector('b')?.textContent === '%s')" "$1"; }
for _ in 1 2 3; do axi open "$B/?r=$RANDOM#person=$PERSON" > /dev/null; axi open "$B/?r=$RANDOM#/settings/accounts" > /dev/null
  axi eval "(async () => { for (let i = 0; i < 50 && !($(row Quill)); i++) await new Promise((r) => setTimeout(r, 100)); return !!($(row Quill)); })()" | grep -q true && break; done
# On the screen: Quill's Change, the Copilot account, its Quick 1 model — real clicks on the rendered row.
CLICK="(async () => { const wait = async (f) => { for (let i = 0; i < 50 && !f(); i++) await new Promise((r) => setTimeout(r, 100)); return f(); };
  const q = () => $(row Quill); (await wait(() => q()?.querySelector('.link'))).click();
  (await wait(() => [...q().querySelectorAll('.seg button')].find((b) => b.textContent === 'GitHub Copilot'))).click();
  (await wait(() => [...q().querySelectorAll('.pick')].find((b) => b.textContent === 'Quick 1')))?.click();
  return !!(await wait(() => q()?.querySelector('.small')?.textContent === 'GitHub Copilot · Quick 1')); })()"
R=$(axi eval "$CLICK" 2>&1) || true; printf "%s" "$R" | grep -q true || { echo "member-models-ui: Quill's row never read GitHub Copilot · Quick 1: $R $(axi eval "() => ($(row Quill))?.innerHTML" 2>&1)" >&2; exit 1; }
wait_for 'the screen pick reaches models.json' '[ "$(models quill)" = "[\"copilot:quick-1\",\"chatgpt:strong-1\"]" ]'
post /api/bots/quill/messages '{"text":"hi"}'
wait_for "Quill's next job runs on GitHub Copilot" 'last_run quill | grep -q "\"account\":\"copilot\""'
post /api/bots/scout/messages '{"text":"hit the limit"}'
wait_for 'Scout waits on the limit' 'curl -fsS --max-time 10 "${H[@]}" "$B/api/state" | grep -q "\"pausedUntil\":[0-9]"'
node -e 'const f = process.argv[1], m = JSON.parse(require("fs").readFileSync(f, "utf8")); delete m.reel; require("fs").writeFileSync(f, JSON.stringify(m, null, 2) + "\n")' "$LAB/crew/models.json"
cp "$LAB/crew/models.json" "$OUT/models-ui.json"
{ echo "Quill's next run: $(last_run quill)"; echo "Scout's run that hit the limit: $(last_run scout)"; } > "$OUT/runs-ui.txt"

URL="$B/#/settings/accounts"
SEE="(async () => { for (let i = 0; i < 50 && document.querySelectorAll('.member-ai').length < 4; i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 400)); [...document.querySelectorAll('.label')].find((l) => l.textContent === 'Who uses which')?.scrollIntoView({ block: 'center' }); return document.querySelectorAll('.member-ai').length; })()"
W="360x800 390x844 445x900 1280x800 1440x900"
THEN="$SEE" WIDTHS="$W" bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" settings-who-uses-which "$URL"
OPEN="(async () => { await ($SEE); const q = () => $(row Quill); q()?.querySelector('.link')?.click(); for (let i = 0; i < 50 && !q()?.querySelector('.pick'); i++) await new Promise((r) => setTimeout(r, 100)); q()?.scrollIntoView({ block: 'center' }); return !!q()?.querySelector('.pick.on'); })()"
THEN="$OPEN" WIDTHS="$W" bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" settings-change-in-place "$URL"
PAGE="(async () => { const h = () => [...document.querySelectorAll('h2')].find((l) => l.textContent === 'Which AI Scout uses'); for (let i = 0; i < 50 && !(h() && document.querySelector('.member-ai .small')?.textContent.includes('·')); i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 400)); h()?.scrollIntoView({ block: 'center' }); return document.querySelector('.member-ai')?.textContent; })()"
THEN="$PAGE" WIDTHS="$W" bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" member-page-scout "$B/#/h/scout/details"
# The installed app (headed, under Xvfb): Chromium's own install from Settings, then both screens in its window.
mkdir -p "$LAB/pwa" "$OUT/pwa"
WHO="(async()=>{await ($SEE);return matchMedia('(display-mode: standalone)').matches})()"
MINE="(async()=>{await ($PAGE);return matchMedia('(display-mode: standalone)').matches})()"
cat > "$LAB/pwa/plan.json" <<JSON
{ "profile": "$LAB/pwa/profile", "home": "$LAB/pwa/home", "headless": false, "xkey": "$REPO/scripts/verify/xkey.py",
  "args": ["--window-size=1440,950", "--force-device-scale-factor=1", "about:blank"],
  "steps": [
    { "name": "boot", "url": "$B/?day#person=$PERSON", "settle": 3000 },
    { "name": "settings", "url": "$B/?day#/settings", "settle": 2500 },
    { "name": "install", "click": ".install .btn" },
    { "name": "tab", "key": "Tab" }, { "name": "enter", "key": "Return" },
    { "name": "attach", "attachApp": "$B" },
    { "name": "standalone", "win": [1440, 950], "url": "$B/?day#/settings/accounts", "settle": 2500, "eval": $(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$WHO"), "wshot": "$OUT/pwa/pwa-settings-who-uses-which-day-1440.png" },
    { "name": "night", "url": "$B/?night#/settings/accounts", "settle": 2500, "eval": $(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$WHO"), "wshot": "$OUT/pwa/pwa-settings-who-uses-which-night-1440.png" },
    { "name": "phone", "w": 390, "h": 844, "dpr": 3, "mobile": true, "url": "$B/?day#/h/scout/details", "settle": 2500, "eval": $(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$MINE"), "out": "$OUT/pwa/pwa-member-page-scout-day-390.png" }
  ] }
JSON
xvfb-run -a -s "-screen 0 1920x1200x24" node "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/pwa/plan.json" | sed "s|$PERSON|<key>|g" > "$OUT/pwa/pwa-shell.json"
node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).filter((x)=>["standalone","night","phone"].includes(x.step));if(s.length!==3||!s.every((x)=>x.value===true))process.exit(1)' "$OUT/pwa/pwa-shell.json" \
  || { echo "member-models-ui: the installed window was not standalone" >&2; exit 1; }
node "$REPO/scripts/verify/steps.mjs" "$OUT" member-models-ui
echo "member-models-ui: $(find "$OUT" -name '*.png' | wc -l) captures in $OUT"
