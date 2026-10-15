#!/usr/bin/env bash
# A chart in a finished workbook (docs/verification/workbook-chart.md).
#   bash scripts/verify/workbook-chart.sh <repo> <out-dir> [--before]
# Real crewd on the stub engine, isolated per SKILL.md's Launch (web/dist built first). Quill makes one money answer with
# crew_workbook and two charts (a bar of the months, a pie of where it went). Then:
#   1. the file: its chart parts and the cells each series reads (chart-parts.txt), and LibreOffice's own render of it
#      (libreoffice-render.png), so the chart is real in a spreadsheet program, not only in our panel;
#   2. what the app reads (workbook.json, GET /api/workbook);
#   3. the panel at 1440 and 390, night and day, on each sheet (panel-check.txt counts what was drawn), then the look
#      check at 360 with the largest text (look/); with PWA=1, the same panel in the installed app (pwa/).
# --before runs the same request on an older build: no chart parts, and the panel as it was (step 3 only).
# Needs soffice and pdftoppm for step 1. Scratch goes under ~/.cache/fm-scratch, never /tmp.
set -euo pipefail
REPO=$(cd "$1" && pwd); OUT=$2; MODE=${3:-after}
mkdir -p "$OUT/screens" "$HOME/.cache/fm-scratch"
LAB=$(mktemp -d "$HOME/.cache/fm-scratch/workbook-chart.XXXXXX")
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run,lo}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
( cd "$REPO" && env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node src/main.ts > "$OUT/crewd.log" 2>&1 ) &
CREWD=$!
cleanup() { chrome-devtools-axi stop >/dev/null 2>&1 || true; kill -TERM "$CREWD" 2>/dev/null || true; wait "$CREWD" 2>/dev/null || true; rm -rf "$LAB"; }
trap cleanup EXIT
wait_for() { for _ in $(seq 1 300); do "$@" >/dev/null 2>&1 && return 0; kill -0 "$CREWD" 2>/dev/null || { echo "crewd exited"; tail "$OUT/crewd.log"; exit 1; }; sleep 0.2; done; echo "timed out: $*"; exit 1; }
ready() { curl --max-time 10 -fsS "$B/api/state" -H x-crewhouse:1 -H "Authorization: Bearer $(cat "$LAB/state/person.key")" | grep -q '"person"'; }
wait_for ready
PERSON=$(<"$LAB/state/person.key")
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl --max-time 10 -fsS -X "$1" "${H[@]}" --data "$3" "$B$2"; }
post PUT /api/people/1 '{"name":"Umer"}' >/dev/null
post POST /api/onboard '{"address":"Umer"}' >/dev/null
post POST /api/recruit '{"template":"scribe","name":"Quill"}' >/dev/null

SPEC='{"name":"Where the money went","sheets":[
 {"name":"By month","columns":[{"header":"Month"},{"header":"Groceries"},{"header":"Eating out"},{"header":"Total"}],
  "rows":[["May",402,88,"=B2+C2"],["Jun",371,132,"=B3+C3"],["Jul",412,96,"=B4+C4"],["Aug",380,140,"=B5+C5"],["Sep",455,72,"=B6+C6"],["Oct",398,88,"=B7+C7"]]},
 {"name":"Where it goes","columns":[{"header":"What"},{"header":"Per month"}],
  "rows":[["Rent",1450],["Food",490],["Bills",380],["Transport",160],["Savings",400]]}],
 "charts":[{"type":"bar","title":"Food each month","sheet":"By month","categories":"A2:A7","series":[{"values":"B2:B7"},{"values":"C2:C7"}]},
  {"type":"line","title":"All food, month by month","sheet":"By month","categories":"A2:A7","series":[{"values":"D2:D7"}],"at":"F19"},
  {"type":"pie","title":"Where a month goes","sheet":"Where it goes","categories":"A2:A6","series":[{"values":"B2:B6"}]}]}'
call=$(node -e 'process.stdout.write(`[tool crew_workbook ${JSON.stringify(JSON.parse(process.argv[1]))}]`)' "$SPEC")
msg=$(node -e 'process.stdout.write(JSON.stringify({text: process.argv[1]}))' "Show me where my money went since May, with charts. $call")
is_done() { curl --max-time 10 -fsS "${H[@]}" "$B/api/bots/quill" | node -e 'const t=JSON.parse(require("fs").readFileSync(0)).tasks.find((t)=>t.id===Number(process.argv[1]));process.exit(t&&t.state==="done"?0:1)' "$1"; }
task=$(curl --max-time 10 -fsS -X POST "${H[@]}" --data "$msg" "$B/api/bots/quill/messages" | node -pe 'JSON.parse(require("fs").readFileSync(0)).task')
wait_for is_done "$task"
XLSX=where-the-money-went.xlsx; FILE="$LAB/crew/bots/quill/files/$XLSX"
[ -f "$FILE" ] || { echo "no workbook delivered"; ls -la "$LAB/crew/bots/quill/files"; exit 1; }

if [ "$MODE" != --before ]; then
  # 1. The file itself: the chart parts, and the cells each one reads.
  ( cd "$REPO" && node -e '
    const JSZip = require("jszip"); JSZip.loadAsync(require("fs").readFileSync(process.argv[1])).then(async (z) => {
      for (const f of Object.keys(z.files).filter((f) => /chart|drawing/.test(f)).sort()) {
        const x = await z.file(f)?.async("string"); if (!x) continue;
        console.log(f, (/<c:(bar|line|pie)Chart>/.exec(x) ?? [, ""])[1], [...x.matchAll(/<c:f>([^<]*)<\/c:f>/g)].map((m) => m[1]).join(" "));
      } });' "$FILE" ) | tee "$OUT/chart-parts.txt"
  grep -q 'chart3.xml pie' "$OUT/chart-parts.txt" || { echo "no pie chart part"; exit 1; }
  cp "$FILE" "$OUT/$XLSX"
  HOME="$LAB/home" timeout 180 soffice --headless "-env:UserInstallation=file://$LAB/lo/profile" --convert-to pdf --outdir "$LAB/lo" "$FILE" >/dev/null 2>&1
  pdftoppm -r 60 -png "$LAB/lo/${XLSX%.xlsx}.pdf" "$LAB/lo/page"
  magick "$LAB"/lo/page-*.png -background white +append "$OUT/libreoffice-render.png"
  # 2. What the app reads.
  curl --max-time 10 -fsS "${H[@]}" "$B/api/workbook?bot=quill&path=files%2F$XLSX" | tee "$OUT/workbook.json" | node -pe 'JSON.parse(require("fs").readFileSync(0)).sheets.map((s) => `${s.name}: ${s.charts.map((c) => `${c.type} "${c.title}" ${c.labels.length} labels, ${c.series.map((x) => `${x.name} [${x.values}]`).join("; ")}`).join(" | ")}`).join("\n")' | tee "$OUT/workbook-charts.txt"
fi

# 3. The person's app: the panel on each sheet, both widths, both looks.
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-workbook-chart}
ax() { chrome-devtools-axi "$@"; }
ax stop >/dev/null 2>&1 || true; ax pages >/dev/null 2>&1 || true; ax selectpage 1 >/dev/null
ax open "$B/#person=$PERSON" >/dev/null
PANEL='(async () => { for (let i = 0; i < 100 && !document.querySelector(".wb-panel td"); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector(".wb-panel td"); })()'
COUNT='JSON.stringify({ tab: document.querySelector(".wb-tab.on")?.textContent, charts: [...document.querySelectorAll(".wb-chart")].map((f) => ({ title: f.querySelector("figcaption")?.textContent, bars: f.querySelectorAll("rect").length, lines: f.querySelectorAll("polyline").length, slices: f.querySelectorAll("path, circle").length, legend: [...f.querySelectorAll(".wb-legend li")].map((l) => l.textContent), width: Math.round(f.getBoundingClientRect().width) })), sideways: document.documentElement.scrollWidth > innerWidth, height: Math.round(document.querySelector(".wb-chart svg")?.getBoundingClientRect().height ?? 0) })'
# The tool prints the page's string quoted; decode it back to one line of JSON.
dec() { sed -n 's/^result: //p' | node -e 'let s = JSON.parse(require("fs").readFileSync(0, "utf8")); while (typeof s === "string") { try { s = JSON.parse(s); } catch { break; } } console.log(JSON.stringify(s))'; }
TAB() { echo "(() => { document.querySelectorAll('.wb-tab')[$1]?.click(); return document.querySelector('.wb-tab.on')?.textContent; })()"; }
for theme in night day; do
  for wh in 1440x900 390x844; do
    w=${wh%x*}; h=${wh#*x}
    ax resize "$w" "$h" >/dev/null
    ax open "$B/?$theme#/f/quill/files%2F$XLSX" >/dev/null; ax eval "$PANEL" >/dev/null; ax eval "$(TAB 0)" >/dev/null
    echo "$theme-$w: $(ax eval "$COUNT" | dec)" | tee -a "$OUT/panel-check.txt"
    ax screenshot "$OUT/screens/chart-panel-$theme-$w.png" >/dev/null
    ax eval "$(TAB 1)" >/dev/null; ax eval "$PANEL" >/dev/null
    echo "$theme-$w: $(ax eval "$COUNT" | dec)" | tee -a "$OUT/panel-check.txt"
    ax screenshot "$OUT/screens/chart-panel-pie-$theme-$w.png" >/dev/null
  done
done
ax stop >/dev/null 2>&1 || true
# The mandatory look check (SKILL.md): 360 wide, the largest text, light and dark, on each sheet's charts.
L="$REPO/scripts/verify/look-check.mjs" WAIT="for (let i = 0; i < 100 && !document.querySelector('.wb-chart'); i++) await new Promise((r) => setTimeout(r, 100));"
look=0
node "$L" web --out "$OUT/look" --person "$LAB/state/person.key" --then "(async () => { $WAIT })()" chart-panel="$B/#/f/quill/files%2F$XLSX" || look=$?
node "$L" web --out "$OUT/look" --person "$LAB/state/person.key" --then "(async () => { $WAIT document.querySelectorAll('.wb-tab')[1].click(); $WAIT })()" chart-panel-pie="$B/#/f/quill/files%2F$XLSX" || look=$?
echo "look check exit: $look" | tee "$OUT/look/exit.txt"
# PWA=1: the same panel in the installed home-screen app (docs/verification/pwa-shell.md's real install, headed under Xvfb):
# the app's own Install, the real sheet, then each look and width inside the standalone window (pwa/).
if [ "${PWA:-}" = 1 ]; then
  mkdir -p "$OUT/pwa"; S="$REPO/scripts/verify"; F="$B/?THEME#/f/quill/files%2F$XLSX"
  SEEN="(async () => { $WAIT return !!document.querySelector('.wb-chart'); })()"
  node -e '
    const [out, b, person, f, seen, xkey] = process.argv.slice(1), shots = [];
    for (const [theme, w, h] of [["night", 1440, 900], ["night", 390, 844], ["day", 1440, 900], ["day", 390, 844]])
      shots.push({ name: `${theme}-${w}`, w, h, url: f.replace("THEME", theme), wait: seen, eval: "({ standalone: matchMedia(`(display-mode: standalone)`).matches, charts: document.querySelectorAll(`.wb-chart`).length })", out: `${out}/pwa/chart-panel-installed-${theme}-${w}.png` });
    console.log(JSON.stringify({ profile: `${out}/../pwa-profile`, home: `${out}/../pwa-home`, headless: false, xkey,
      args: ["--window-size=1400,950", "--force-device-scale-factor=1", "about:blank"], steps: [
        { name: "boot", url: `${b}/#person=${person}`, settle: 3000 }, { name: "settings", url: `${b}/#/settings`, wait: "!!document.querySelector(`.install .btn`)" },
        { name: "install", click: ".install .btn" }, { name: "tab", key: "Tab" }, { name: "ok", key: "Return" },
        { name: "sheet", xshot: `${out}/pwa/installed-window.png` }, { name: "app", attachApp: b }, ...shots] }));' \
    "$OUT" "$B" "$PERSON" "$F" "$SEEN" "$S/xkey.py" > "$LAB/pwa-plan.json"
  sed -i "s#$OUT/../pwa-#$LAB/pwa-#g" "$LAB/pwa-plan.json"
  xvfb-run -a -s "-screen 0 1920x1200x24" node "$S/pwa-shell.mjs" "$LAB/pwa-plan.json" | tee "$OUT/pwa/run.json"
fi
ls "$OUT/screens"
