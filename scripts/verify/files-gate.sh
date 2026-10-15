#!/usr/bin/env bash
# A delivered file opens only with the person's authority (features/delivered-files.md).
#   bash scripts/verify/files-gate.sh <repo> <out-dir> [--no-browser]
# Real crewd on the stub engine, isolated per SKILL.md's Launch (web/dist built first). Reel makes a PNG, a PDF and an
# mp4 in its own shell, registers them with crew_deliver, and writes an xlsx with crew_workbook. Then:
#   1. curl --max-time 10 matrix from the host (no header, public header, wrong key, wrong cookie, the person's browser cookie, the key alone);
#   2. the real attack: Tracer's own sandboxed shell curls Reel's delivered files over the shared loopback;
#   3. (unless --no-browser) the person's app: the picture, the video, the PDF tab and the spreadsheet download, plus
#      the thread at 1440 and 390, night and day, and the demo's sheet panel.
# Needs ImageMagick (`magick`) and ffmpeg for the three made files. Scratch goes under ~/.cache/fm-scratch, never /tmp.
set -euo pipefail
REPO=$(cd "$1" && pwd); OUT=$2; BROWSER=${3:-yes}
mkdir -p "$OUT" "$HOME/.cache/fm-scratch"
LAB=$(mktemp -d "$HOME/.cache/fm-scratch/files-gate.XXXXXX")
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run,made}
HERE=$LAB/made
magick -size 480x300 gradient:'#7cc6fe'-'#f7d488' -gravity center -pointsize 40 -fill '#2e2a40' -annotate 0 'Beach day, Saturday' -depth 8 PNG8:"$HERE/beach-day.png"
magick -size 595x842 xc:white -gravity north -pointsize 30 -fill '#2e2a40' -annotate +0+80 'Weekend trip plan' -pointsize 20 \
  -annotate +0+150 "Saturday: beach, 10am
Sunday: lunch with Umer's family" -compress zip "$HERE/trip-plan.pdf"
ffmpeg -loglevel error -y -f lavfi -i 'testsrc=size=320x180:rate=10' -t 1 -pix_fmt yuv420p -c:v libx264 -movflags +faststart "$HERE/beach-clip.mp4"
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
cleanup() { kill -TERM "$CREWD" 2>/dev/null || true; wait "$CREWD" 2>/dev/null || true; rm -rf "$LAB"; }
trap cleanup EXIT
wait_for() { for _ in $(seq 1 300); do "$@" >/dev/null 2>&1 && return 0; kill -0 "$CREWD" 2>/dev/null || { echo "crewd exited"; tail "$OUT/crewd.log"; exit 1; }; sleep 0.2; done; echo "timed out: $*"; exit 1; }
ready() { curl --max-time 10 -fsS "$B/api/state" -H x-crewhouse:1 -H "Authorization: Bearer $(cat "$LAB/state/person.key")" | grep -q '"person"'; }
wait_for ready
PERSON=$(<"$LAB/state/person.key")
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl --max-time 10 -fsS -X "$1" "${H[@]}" --data "$3" "$B$2"; }
post PUT /api/people/1 '{"name":"Umer"}' >/dev/null
post POST /api/onboard '{"address":"Umer"}' >/dev/null
post POST /api/recruit '{"template":"reel","name":"Reel"}' >/dev/null
post POST /api/recruit '{"template":"tracer","name":"Tracer"}' >/dev/null

tool() { node -e 'process.stdout.write(`[tool ${process.argv[1]} ${JSON.stringify(JSON.parse(process.argv[2]))}]`)' "$1" "$2"; }
msg() { node -e 'process.stdout.write(JSON.stringify({text: process.argv[1]}))' "$1"; }
is_done() { curl --max-time 10 -fsS "${H[@]}" "$B/api/bots/$1" | node -e 'const t=JSON.parse(require("fs").readFileSync(0)).tasks.find((t)=>t.id===Number(process.argv[1]));process.exit(t&&t.state==="done"?0:1)' "$2"; }
done_task() { wait_for is_done "$1" "$2"; }
make=$(tool bash "$(node -e 'console.log(JSON.stringify({command: `mkdir -p files && echo ${process.argv[1]} | base64 -d > files/beach-day.png && echo ${process.argv[2]} | base64 -d > files/trip-plan.pdf && echo ${process.argv[3]} | base64 -d > files/beach-clip.mp4`}))' "$(base64 -w0 "$HERE/beach-day.png")" "$(base64 -w0 "$HERE/trip-plan.pdf")" "$(base64 -w0 "$HERE/beach-clip.mp4")")")
deliver="$(tool crew_deliver '{"path":"files/beach-day.png","note":"The beach on Saturday"}') $(tool crew_deliver '{"path":"files/trip-plan.pdf","note":"The weekend plan"}') $(tool crew_deliver '{"path":"files/beach-clip.mp4","note":"A second of the sea"}') $(tool crew_workbook '{"name":"Trip costs","sheets":[{"name":"Costs","columns":[{"header":"What"},{"header":"Cost"}],"rows":[["Train",42],["Lunch",60]]}]}')"
task=$(curl --max-time 10 -fsS -X POST "${H[@]}" --data "$(msg "Here is the weekend. $make $deliver")" "$B/api/bots/reel/messages" | node -pe 'JSON.parse(require("fs").readFileSync(0)).task')
done_task reel "$task"
XLSX=$(cd "$LAB/crew/bots/reel/files" && ls *.xlsx | head -1)
ls -la "$LAB/crew/bots/reel/files" > "$OUT/reel-files.txt"

# 1. Host curl --max-time 10 matrix: the status per caller, and whether the body is the file's own bytes.
COOKIE=$(curl --max-time 10 -fsS -X POST -D - -o /dev/null "${H[@]}" "$B/api/files/session" | tr -d '\r' | sed -n 's/^[Ss]et-[Cc]ookie: \(crewhouse-files=[^;]*\).*/\1/p')
check() { local label=$1 f=$2 code leak=no; shift 2
  code=$(curl --max-time 10 -sS -o "$LAB/body" -w '%{http_code}' "$@" "$B/files/reel/$f" || true)
  cmp -s "$LAB/body" "$LAB/crew/bots/reel/files/$f" && leak=yes
  printf '%s\t%s\t%s\t%s\n' "$label" "$f" "$code" "$leak"; }
{ printf 'caller\tfile\tstatus\tfull bytes served\n'
  for f in beach-day.png trip-plan.pdf beach-clip.mp4 "$XLSX"; do
    check 'no headers' "$f"
    check 'public header only' "$f" -H x-crewhouse:1
    check 'wrong key' "$f" -H 'Authorization: Bearer nope'
    check 'range, no key' "$f" -H 'Range: bytes=0-15'
    check 'wrong cookie' "$f" -H 'Cookie: crewhouse-files=0000000000000000000000000000000000000000000000000000000000000000'
    check "person browser cookie" "$f" -H "Cookie: $COOKIE"
    check "range, person browser cookie" "$f" -H "Cookie: $COOKIE" -H 'Range: bytes=0-15'
    check "person key alone" "$f" "${H[@]}"
  done; } > "$OUT/curl-matrix.tsv"
cat "$OUT/curl-matrix.tsv"
awk -F'\t' 'NR>1 { ok = $1 == "person browser cookie" ? 200 : $1 == "range, person browser cookie" ? 206 : 403; if ($3 != ok) bad = 1 } END { exit bad }' "$OUT/curl-matrix.tsv" || { echo "curl --max-time 10 matrix: a helper caller got bytes, or the person's cookie was refused"; exit 1; }

# 2. The real attack: Tracer's own sandboxed shell reads Reel's delivered files over the shared loopback.
steal=""
for f in beach-day.png trip-plan.pdf beach-clip.mp4 "$XLSX"; do
  steal+="curl --max-time 10 -sS -o files/stolen-$f -w '%{http_code}\n' '$B/files/reel/$f' >> files/stolen-codes.txt; "
done
task=$(curl --max-time 10 -fsS -X POST "${H[@]}" --data "$(msg "$(tool bash "$(node -e 'console.log(JSON.stringify({command: process.argv[1]}))' "$steal")")")" "$B/api/bots/tracer/messages" | node -pe 'JSON.parse(require("fs").readFileSync(0)).task')
done_task tracer "$task"
{
  echo "Tracer's shell, curl --max-time 10 of Reel's delivered files (status per file):"
  cat "$LAB/crew/bots/tracer/files/stolen-codes.txt"
  for f in beach-day.png trip-plan.pdf beach-clip.mp4 "$XLSX"; do
    cmp -s "$LAB/crew/bots/tracer/files/stolen-$f" "$LAB/crew/bots/reel/files/$f" && echo "$f: LEAKED" || echo "$f: not leaked ($(head -c 80 "$LAB/crew/bots/tracer/files/stolen-$f"))"
  done
} > "$OUT/helper-shell-attack.txt"
cat "$OUT/helper-shell-attack.txt"
[ "$BROWSER" = --no-browser ] && exit 0

# 3. The person's app.
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-files-gate}
SH="$OUT/screens"; mkdir -p "$SH"
ax() { chrome-devtools-axi "$@"; }
# A panel has drawn its sheet: the wait the screenshots below need (bounded, never a fixed sleep).
PANEL='(async () => { for (let i = 0; i < 100 && !document.querySelector(".wb-panel td"); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector(".wb-panel td"); })()'

# The launcher URL must be a fresh load (not a hash change on an open app page): the app reads the fragment once at start.
ax stop >/dev/null 2>&1 || true; ax pages >/dev/null 2>&1 || true; ax selectpage 1 >/dev/null  # a fresh browser has its first tab, unselected
ax open "$B/#person=$PERSON" >/dev/null
# The person's key never stays in the address: the app moves it to the tab's sessionStorage.
ax eval 'location.href.includes("person=") ? "KEY IN URL" : "address clean"' | tee "$OUT/address-check.txt"
IMG_CHECK='(async () => { for (let i = 0; i < 100; i++) { const im = [...document.querySelectorAll("img")].find((x) => x.alt === "Beach day"); if (im && im.complete && im.naturalWidth) return { src: new URL(im.src).pathname.slice(0, 7), width: im.naturalWidth }; await new Promise((r) => setTimeout(r, 100)); } return "picture never loaded"; })()'
for theme in night day; do
  for wh in 1440x900 390x844; do
    w=${wh%x*}; h=${wh#*x}
    ax resize "$w" "$h" >/dev/null
    ax open "$B/?$theme#/h/reel" >/dev/null
    echo "reel-$theme-$w: $(ax eval "$IMG_CHECK" | tr '\n' ' ')" | tee -a "$OUT/picture-check.txt"
    ax eval '(() => { [...document.querySelectorAll("img")].find((x) => x.alt === "Beach day").scrollIntoView({ block: "center" }); return true; })()' >/dev/null
    ax screenshot "$SH/reel-thread-$theme-$w.png" >/dev/null
  done
done
ax resize 1440 900 >/dev/null; ax open "$B/?night#/h/reel" >/dev/null
# The video plays from its /files address (Range, with the cookie) once the person taps Play.
ax eval '(async () => { for (let i = 0; i < 100 && !document.querySelector("button[aria-label=\"Play Beach clip\"]"); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector("button[aria-label=\"Play Beach clip\"]").click();
  for (let i = 0; i < 100; i++) { const v = document.querySelector("video"); if (v && v.readyState >= 2) return { src: new URL(v.src).pathname.slice(0, 7), seconds: v.duration, width: v.videoWidth }; await new Promise((r) => setTimeout(r, 100)); } return "video never loaded"; })()' | tee "$OUT/video-check.txt"
ax screenshot "$SH/video-night-1440.png" >/dev/null
# The PDF opens in its own tab at its /files address; the spreadsheet's Download link fetches the file with the cookie.
ax eval '(async () => { for (let i = 0; i < 100 && ![...document.querySelectorAll("a[href^=\"/files/\"]")].some((a) => /trip-plan/.test(a.getAttribute("href"))); i++) await new Promise((r) => setTimeout(r, 100)); [...document.querySelectorAll("a[href^=\"/files/\"]")].find((a) => /trip-plan/.test(a.getAttribute("href"))).click(); return "clicked"; })()' >/dev/null
app=$(ax pages | awk -F, '$NF=="true"{gsub(/ /,"",$1); print $1}')
for _ in $(seq 1 50); do ax pages | grep -q '/files/' && break; sleep 0.2; done
ax pages | tee "$OUT/pdf-tab.txt"
pdf=$(ax pages | awk -F, '$2 ~ /\/files\//{gsub(/ /,"",$1); print $1; exit}')
[ -n "$pdf" ] && { ax selectpage "$pdf" >/dev/null; ax screenshot "$SH/pdf-tab-1440.png" >/dev/null; ax closepage "$pdf" >/dev/null; }; ax selectpage "$app" >/dev/null
ax open "$B/?night#/f/reel/files%2F$XLSX" >/dev/null
ax eval '(async () => { for (let i = 0; i < 100 && ![...document.querySelectorAll("a")].some((a) => a.textContent === "Download"); i++) await new Promise((r) => setTimeout(r, 100));
  const a = [...document.querySelectorAll("a")].find((x) => x.textContent === "Download"); if (!a) return "no download link";
  const b = new Uint8Array(await (await fetch(a.href)).arrayBuffer());
  return { href: new URL(a.href).pathname.slice(0, 7), name: decodeURIComponent(a.href.split("/").pop()), bytes: b.length, zip: String.fromCharCode(b[0], b[1]) }; })()' | tee "$OUT/download-check.txt"
ax eval "$PANEL" >/dev/null; ax screenshot "$SH/sheet-panel-night-1440.png" >/dev/null
ax resize 390 844 >/dev/null; ax open "$B/?day#/f/reel/files%2F$XLSX" >/dev/null; ax eval "$PANEL" >/dev/null
ax screenshot "$SH/sheet-panel-day-390.png" >/dev/null
# The demo web app (`?demo`, demo.ts data): its sheet preview opens as before.
ax open "$B/?demo&night#/f/scout/files%2Fflights-to-larkspur.xlsx" >/dev/null; ax eval "$PANEL" >/dev/null
ax screenshot "$SH/demo-sheet-night-390.png" >/dev/null
ax resize 1440 900 >/dev/null; ax open "$B/?demo&day#/f/scout/files%2Fflights-to-larkspur.xlsx" >/dev/null; ax eval "$PANEL" >/dev/null
ax screenshot "$SH/demo-sheet-day-1440.png" >/dev/null
ax stop >/dev/null 2>&1 || true
ls "$SH"
