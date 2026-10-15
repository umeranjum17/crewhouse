#!/usr/bin/env bash
# A finished slide deck the person can open and present (docs/verification/slides-deck.md).
#   bash scripts/verify/slides-deck.sh <repo> <out-dir>
# Real crewd on the stub engine, isolated per docs/verification/runbook.md's Launch (web/dist built first). Quill is asked for a deck and
# crewd writes the .pptx itself, then delivers it. Proves: the file's own OOXML parts; LibreOffice opens it and every
# slide renders; /api/document reads it back as slides and parts, and 403s a path nobody delivered; the chat card and
# the panel at 1440/390, day and night; the look check at 360 with the largest text; the same panel in the installed app.
# Needs unzip, LibreOffice, ImageMagick, chrome-devtools-axi, xvfb-run. Scratch under ~/.cache/fm-scratch, never /tmp.
set -euo pipefail
REPO=$(cd "$1" && pwd); OUT=$(mkdir -p "$2" && cd "$2" && pwd)
SCRATCH=${SCRATCH:-$HOME/.cache/fm-scratch/ch-cap-slides}; mkdir -p "$SCRATCH" "$OUT/screens"
LAB=$(mktemp -d "$SCRATCH/l.XXXX"); mkdir -p "$LAB"/{home,state,crew,tools,run,render,pwa/home/run}
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-ch-cap-slides}
NODE=$(node -p process.execPath)   # the real binary: a version-manager shim fails under the masked env
log() { printf '%s\n' "$*" | tee -a "$OUT/transcript.txt"; }
MASK=(env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" XDG_STATE_HOME="$LAB/home/.local/state"
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache"
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_ENGINE=stub
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools")
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
( cd "$REPO" && "${MASK[@]}" CREWHOUSE_PORT="$PORT" "$NODE" src/main.ts > "$OUT/crewd.log" 2>&1 ) &
CREWD=$!
cleanup() { kill -TERM "$CREWD" 2>/dev/null || true; wait "$CREWD" 2>/dev/null || true; chrome-devtools-axi stop >/dev/null 2>&1 || true; chmod -R u+w "$LAB" 2>/dev/null || true; rm -rf "$LAB"; }
trap cleanup EXIT
wait_for() { for _ in $(seq 1 400); do "$@" >/dev/null 2>&1 && return 0; kill -0 "$CREWD" 2>/dev/null || { echo "crewd exited"; tail "$OUT/crewd.log"; exit 1; }; sleep 0.2; done; echo "timed out: $*"; exit 1; }
ready() { curl --max-time 10 -fsS "$B/api/state" -H x-crewhouse:1 -H "Authorization: Bearer $(cat "$LAB/state/person.key")" | grep -q '"person"'; }
wait_for ready
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $(<"$LAB/state/person.key")")
api() { curl --max-time 10 -fsS "${H[@]}" "$@"; }
post() { api -X "$1" -d "$3" "$B$2" >/dev/null; }
post PUT /api/people/1 '{"name":"Umer"}'
post POST /api/onboard '{"address":"Umer"}'
post POST /api/recruit '{"template":"scribe","name":"Quill"}'
tool() { "$NODE" -e 'process.stdout.write(`[tool ${process.argv[1]} ${JSON.stringify(JSON.parse(process.argv[2]))}]`)' "$1" "$2"; }
msg() { "$NODE" -e 'process.stdout.write(JSON.stringify({text: process.argv[1]}))' "$1"; }
is_done() { api "$B/api/bots/$1" | "$NODE" -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const t=JSON.parse(s).tasks.find((t)=>t.id===Number(process.argv[1]));process.exit(t&&t.state==="done"?0:1)})' "$2"; }

# The deck the reference bar asks for: a kick-off somebody stands up with.
SPEC='{"name":"New shop kick-off","slides":[{"title":"Opening the new shop","bullets":["Doors open Saturday 4 October","Amina manages the floor"]},{"title":"Why now","bullets":["The old unit\u2019s lease ends in November","Weekend footfall is three times the weekday"]},{"title":"The first week","bullets":["Wednesday: stock arrives","Thursday: staff run-through","Saturday: opening day"]},{"title":"What it costs","bullets":["Fit-out \u00a38,400","First stock \u00a35,200","Staff \u00a31,900 a week"]},{"title":"What we need from you","bullets":["Approve the fit-out quote","Name the weekend team"]}]}'
task=$(api -X POST -d "$(msg "make the kick-off a slide deck $(tool crew_slides "$SPEC")")" "$B/api/bots/quill/messages" | "$NODE" -pe 'JSON.parse(require("fs").readFileSync(0)).task')
wait_for is_done quill "$task"

DECK=new-shop-kick-off.pptx; REL="files/$DECK"; FULL="$LAB/crew/bots/quill/$REL"
[ -f "$FULL" ] || { log "no deck at $REL"; ls -la "$LAB/crew/bots/quill/files"; exit 1; }
{ echo "crew_slides delivered $REL as $(stat -c%s "$FULL") bytes, $(file -b "$FULL")"
  echo "parts:"; unzip -Z1 "$FULL" | sort
  echo "slide 5 says:"; unzip -p "$FULL" ppt/slides/slide5.xml | grep -o '<a:t>[^<]*</a:t>'
} | tee "$OUT/deck-file.txt"
unzip -Z1 "$FULL" | grep -qx 'ppt/theme/theme1.xml' || { log 'the deck has no theme: PowerPoint would refuse it'; exit 1; }
[ "$(unzip -Z1 "$FULL" | grep -c '^ppt/slides/slide[0-9]*\.xml$')" = 5 ] || { log 'not five slide parts'; exit 1; }

# LibreOffice is a real second implementation of the format: if it opens and draws, the file is a deck, not bytes.
"${MASK[@]}" soffice --headless --convert-to pdf --outdir "$LAB/render" "$FULL" > "$OUT/libreoffice.txt" 2>&1
[ -f "$LAB/render/${DECK%.pptx}.pdf" ] || { log "LibreOffice did not open the deck"; cat "$OUT/libreoffice.txt"; exit 1; }
magick -density 80 "$LAB/render/${DECK%.pptx}.pdf" "$OUT/screens/slides-render-%d.png"
pdfinfo "$LAB/render/${DECK%.pptx}.pdf" | grep -E '^Pages' | tee -a "$OUT/libreoffice.txt"

# What the app reads: the same delivered file through /api/document — slides for the panel, parts for a plain reader.
api "$B/api/document?bot=quill&path=$REL" | "$NODE" -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const j=JSON.parse(s);
  console.log("slides:", j.slides.map((x)=>x.title).join(" | "));
  console.log("slide 2 lines:", JSON.stringify(j.slides[1].lines));
  console.log("parts:", j.parts.length, "first:", JSON.stringify(j.parts[0]));
  process.exit(j.slides.length===5 && j.parts[0].kind==="heading" ? 0 : 1)})' | tee -a "$OUT/api-document.txt"
code=$(curl --max-time 10 -sS -o /dev/null -w '%{http_code}' "${H[@]}" "$B/api/document?bot=quill&path=files/not-delivered.pptx")
echo "undelivered path: $code" | tee -a "$OUT/api-document.txt"
[ "$code" = 403 ] || { log 'an undelivered path answered'; exit 1; }

# The person's app: the card in the chat, the panel over it, and the file's own Download bytes.
PANEL='(async () => { for (let i = 0; i < 100 && !document.querySelector(".slide-frame"); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector(".slide-frame"); })()'
ax() { chrome-devtools-axi "$@"; }
ax stop >/dev/null 2>&1 || true; ax pages >/dev/null 2>&1 || true; ax selectpage 1 >/dev/null
ax open "$B/#person=$(<"$LAB/state/person.key")" >/dev/null
ax eval 'location.href.includes("person=") ? "KEY IN URL" : "address clean"' > "$OUT/address-check.txt"
ax resize 1440 900 >/dev/null; ax open "$B/?night#/h/quill" >/dev/null
ax eval '(() => { const c = document.querySelector(".wb-card"); if (c) c.scrollIntoView({ block: "center" }); return c ? c.textContent : "no card"; })()' | tee "$OUT/card-words.txt"
CARD='(async () => { for (let i = 0; i < 100 && !document.querySelector(".wb-card"); i++) await new Promise((r) => setTimeout(r, 100)); const c = document.querySelector(".wb-card"); if (c) c.scrollIntoView({ block: "center" }); return !!c; })()'
ax eval "$CARD" >/dev/null; ax screenshot "$OUT/screens/deck-card-night-1440.png" >/dev/null
ax resize 390 844 >/dev/null; ax open "$B/?day#/h/quill" >/dev/null; ax eval "$CARD" >/dev/null
ax screenshot "$OUT/screens/deck-card-day-390.png" >/dev/null
URL="$B/#/f/quill/files%2F$DECK"
THEN="$PANEL" bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" deck-panel "$URL" | tee "$OUT/screens.txt"
ax resize 1440 900 >/dev/null; ax open "$B/?night#/f/quill/files%2F$DECK" >/dev/null; ax eval "$PANEL" >/dev/null
ax eval '(() => { const s = document.querySelectorAll(".slide-frame"); return { frames: s.length, first: s[0]?.textContent, about: document.querySelector(".wb-what .small")?.textContent, download: document.querySelector(".wb-head a")?.getAttribute("href") }; })()' | tee "$OUT/panel-check.txt"
ax eval '(async () => { const a = [...document.querySelectorAll("a")].find((x) => x.textContent === "Download"); const b = new Uint8Array(await (await fetch(a.href)).arrayBuffer()); return { href: new URL(a.href).pathname.slice(0, 7), name: a.href.split("/").pop(), bytes: b.length, zip: String.fromCharCode(b[0], b[1]) }; })()' | tee -a "$OUT/panel-check.txt"

# The look check at the hardest size (360 wide, text ×1.3, day and night). The workbook panel is the control: it is a
# screen this change does not touch, and it wears the same modal, so a hit on both is the panel's, not the deck's.
LOOK='(async () => { for (let i = 0; i < 100 && !document.querySelector(".slide-frame, .wb-panel td"); i++) await new Promise((r) => setTimeout(r, 100)); return true; })()'
FM_HOME=${FM_HOME:-/home/umer/.treehouse/firstmate-8bf1b0/3/firstmate} node "$REPO/scripts/verify/look-check.mjs" web --out "$OUT/look" --person "$LAB/state/person.key" --then "$LOOK" \
  "deck-panel=$B/#/f/quill/files%2F$DECK" "workbook-panel=$B/?demo#/f/scout/files%2Fflights-to-larkspur.xlsx" | tee "$OUT/look-check.txt" || log "look-check: exit $? (see look-check.txt)"
ax stop >/dev/null 2>&1 || true

# The installed app, for real: Settings' own Install, then the same panel at 390 and 1440, day and night.
"$NODE" -e '
const [B, key, LAB, OUT, SK, THEN, DECK] = process.argv.slice(1), url = (q) => `${B}/?${q}#/f/quill/files%2F${DECK}`, steps = [
  { name: "boot", w: 1400, h: 950, dpr: 1, mobile: false, url: `${B}/#person=${key}`, wait: "sessionStorage.getItem(\"crewhouse.person\")?.length === 64", timeout: 30000,
    eval: "({authority: sessionStorage.getItem(\"crewhouse.person\")?.length, launcherConsumed: !location.hash.startsWith(\"#person=\")})" },
  { name: "settings", url: `${B}/#/settings`, wait: "!!document.querySelector(\".install .btn\")", timeout: 20000 },
  { name: "install", click: ".install .btn", settle: 3000 }, { name: "sheet", xshot: `${OUT}/pwa/install-sheet.png` },
  { name: "tab", key: "Tab" }, { name: "return", key: "Return", settle: 3000 },
  { name: "attach", attachApp: B },
  { name: "app-authority", url: `${B}/#person=${key}`, reload: true, wait: "sessionStorage.getItem(\"crewhouse.person\")?.length === 64", timeout: 30000 }];
for (const look of ["day", "night"]) for (const [w, h] of [[390, 844], [1440, 900]])
  steps.push({ name: `deck-${look}-${w}`, w, h, dpr: w < 500 ? 2 : 1, mobile: w < 500, url: url(look), wait: "!!document.querySelector(\".slide-frame\")", timeout: 20000,
    eval: `[matchMedia("(display-mode: standalone)").matches, ${THEN}][0]`, out: `${OUT}/pwa/deck-panel-installed-${look}-${w}.png` });
console.log(JSON.stringify({ profile: `${LAB}/pwa/profile`, home: `${LAB}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, args: ["--window-size=1400,950", "--force-device-scale-factor=1", "about:blank"], steps }));
' "$B" "$(<"$LAB/state/person.key")" "$LAB" "$OUT" "$REPO/scripts/verify" "$PANEL" "$DECK" > "$LAB/pwa-plan.json"
mkdir -p "$OUT/pwa"; xvfb-run -a -s "-screen 0 1920x1200x24" "$NODE" "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/pwa-plan.json" > "$OUT/pwa/run.json"
"$NODE" -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const rows = r.filter((x) => "value" in x || x.error); console.log("pwa", JSON.stringify(rows)); process.exit(r.some((x) => x.error) ? 1 : 0)' "$OUT/pwa/run.json" | tee -a "$OUT/transcript.txt"
ls "$OUT/screens" "$OUT/pwa"
