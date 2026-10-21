#!/usr/bin/env bash
# Chief's chat opens on the ask that needs the person (docs/verification/thread-hygiene.md): an open unlock ask in Chief's
# thread (Add your phone sits above it, under Chief's first answer), driven so the card's own top is measured against the thread box at
# 390 and 1440, day and night, and recorded as the ask arrives while the chat is open.
#   EVIDENCE_HOME=<your evidence folder> bash scripts/verify/ask-in-view.sh <evidence-dir>
# Needs qpdf, ghostscript, chrome-devtools-axi, ffmpeg (for the recording) and a Chromium.
set -euo pipefail
EV=$(mkdir -p "$1" && cd "$1" && pwd); REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel); cd "$REPO"
SCRATCH=${SCRATCH:-$HOME/.cache/fm-scratch/ch-ask-card-in-view}; mkdir -p "$SCRATCH" "$EV/motion"
LAB=$(mktemp -d "$SCRATCH/l.XXXX"); mkdir -p "$LAB"/{home,state,crew,tools,run,pdf,profile}
CDP_PORT=${CDP_PORT:-9924}
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-ch-ask-card-in-view} CHROME_DEVTOOLS_AXI_USER_DATA_DIR="$LAB/profile"
export CHROME_DEVTOOLS_AXI_CHROME_ARGS="--remote-debugging-port=$CDP_PORT"
NODE=$(node -p process.execPath)   # the real binary: a version-manager shim fails under the masked env
PW1='Northbank-7319!' PW2='CitySav 2026'
log() { printf '%s\n' "$*" | tee -a "$EV/transcript.txt"; }

for s in "northbank-march:Northbank statement, March:$PW1" "citysavings-april:City Savings statement, April:$PW2"; do
  IFS=: read -r name title pw <<<"$s"
  printf '/Helvetica findfont 14 scalefont setfont 72 720 moveto (%s) show showpage\n' "$title" > "$LAB/pdf/$name.ps"
  gs -q -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -sOutputFile="$LAB/pdf/$name.plain.pdf" "$LAB/pdf/$name.ps"
  qpdf --encrypt --user-password="$pw" --owner-password="$pw-owner" --bits=256 -- "$LAB/pdf/$name.plain.pdf" "$LAB/pdf/$name.pdf"
done

MASK=(env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" XDG_STATE_HOME="$LAB/home/.local/state"
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache"
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_ENGINE=stub
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools")
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
. scripts/verify/crewd-group.sh
trap '{ if [ -n "${REC:-}" ]; then kill -TERM "$REC"; wait "$REC"; fi; timeout -k 5 15 chrome-devtools-axi stop; } >/dev/null 2>&1 || true; crewd_stop || exit 1; { chmod -R u+w "$LAB"; rm -rf "$LAB"; } >/dev/null 2>&1 || true' EXIT
crewd_start . "$EV/crewd.log" "${MASK[@]}" CREWHOUSE_PORT="$PORT" "$NODE" src/main.ts
B="http://127.0.0.1:$PORT"
for _ in $(seq 600); do [ -s "$LAB/state/person.key" ] && curl --max-time 10 -fsS -o /dev/null -H x-crewhouse:1 -H "Authorization: Bearer $(<"$LAB/state/person.key")" "$B/api/state" 2>/dev/null && break; sleep 0.2; done
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $(<"$LAB/state/person.key")")
api() { curl --max-time 10 -fsS "${H[@]}" "$@"; }
until_js() { for _ in $(seq 300); do api "$B/api/state" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const state=JSON.parse(s);process.exit(($1)?0:1)})" && return 0; sleep 0.2; done; log "timed out: $1"; return 1; }

api -X POST -d '{"address":"Umer"}' "$B/api/onboard" >/dev/null
api -X POST -d '{"text":"I need help with my money paperwork [tool crew_recruit {\"template\":\"helper\",\"name\":\"Penny\"}]"}' "$B/api/bots/chief/messages" >/dev/null
until_js "state.bots.some((b) => b.id === 'penny') && !state.bots.find((b) => b.id === 'chief').task"
# The Documents tool is not installed into this lab, so every password-locked file is offered on the card (askUnlock).
page() { printf '(async () => { for (let i = 0; i < 50 && !document.querySelector("%s"); i++) await new Promise((r) => setTimeout(r, 100)); return true; })()' "$1"; }
probe() { chrome-devtools-axi eval "JSON.stringify((() => { const el = document.querySelector('.chat .lines'); const box = el.getBoundingClientRect(); const r = document.querySelector('.unlock-card')?.getBoundingClientRect(); return { label: '$1', width: innerWidth, card: !!r, cardTop: r ? Math.round(r.top - box.top) : null, below: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) }; })())"; }
shot() { chrome-devtools-axi screenshot "$EV/$1" >/dev/null; }
open_at() { chrome-devtools-axi resize "$1" "$2" >/dev/null; chrome-devtools-axi open "$B/?$3#/chief" >/dev/null; chrome-devtools-axi wait "$4" >/dev/null; }

chrome-devtools-axi pages >/dev/null; chrome-devtools-axi selectpage 1 >/dev/null   # a kept profile starts with no tab selected
chrome-devtools-axi open "$B/#person=$(<"$LAB/state/person.key")" >/dev/null

# 1. Plain chat, no ask yet: it must still land at the bottom of its own lines column.
open_at 390 844 day "I need help with my money paperwork"
probe plain-390 | tee -a "$EV/measure.txt"; shot plain-day-390.png

# 2. The ask arrives while that chat is open: the thread lands on the card (recorded), never on the footer below it.
node scripts/verify/record.mjs "http://127.0.0.1:$CDP_PORT" "$B/" "$EV/motion/ask-arrives.webm" > "$EV/motion/record.log" 2>&1 &
REC=$!
for _ in $(seq 100); do grep -q 'RECORDING:' "$EV/motion/record.log" && break; kill -0 "$REC" 2>/dev/null || { cat "$EV/motion/record.log" >&2; exit 1; }; sleep 0.1; done
grep -q 'RECORDING:' "$EV/motion/record.log"
"$NODE" -e 'const [a, b] = process.argv.slice(1).map((f) => require("fs").readFileSync(f).toString("base64"));
console.log(JSON.stringify({ text: "Read my two statements [tool crew_unlock {\"files\":[\"files/inbox/2-1.pdf\",\"files/inbox/2-2.pdf\"]}]",
  files: [{ type: "application/pdf", name: "Northbank March.pdf", data: a }, { type: "application/pdf", name: "City Savings April.pdf", data: b }] }))' \
  "$LAB/pdf/northbank-march.pdf" "$LAB/pdf/citysavings-april.pdf" | api -X POST -d @- "$B/api/bots/penny/messages" >/dev/null
until_js "state.asks.some((a) => a.kind === 'unlock' && a.bot === 'chief')"
api "$B/api/state" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('ask', JSON.stringify(JSON.parse(s).asks.find((a)=>a.kind==='unlock'))))" | tee -a "$EV/transcript.txt"
chrome-devtools-axi eval "$(page .unlock-card)" >/dev/null; sleep 1
probe arrived-390 | tee -a "$EV/measure.txt"
kill -TERM "$REC"
wait "$REC"
REC=

# 3. Chief's thread opens with the ask already there: the card is in view, in both themes and both widths.
for look in day night; do for w in 390 1440; do
  h=844; [ "$w" = 1440 ] && h=900
  open_at "$w" "$h" "$look" "it's forgotten"
  probe "$look-$w" | tee -a "$EV/measure.txt"
  shot "$look-$w.png"
done; done

# The mandatory look check at the hardest size (360 wide, text x1.3, day and night), beside mock 3A (EVIDENCE_HOME holds it).
THEN='(async () => { for (let i = 0; i < 50 && !document.querySelector(".unlock-card"); i++) await new Promise((r) => setTimeout(r, 100)); return true; })()'
node scripts/verify/look-check.mjs web --out "$EV/look" --person "$LAB/state/person.key" --then "$THEN" unlock-card="$B/#/chief" | tee -a "$EV/transcript.txt"

# The installed app (headed, under Xvfb): installed from Settings for real, then Chief's thread opens on the ask.
mkdir -p "$EV/pwa" "$LAB/pwa/home/run"
node -e '
const [B, key, LAB, EV, SK] = process.argv.slice(1), steps = [
  { name: "boot", w: 1400, h: 950, dpr: 1, mobile: false, url: `${B}/#person=${key}`, settle: 3000 },
  { name: "settings", url: `${B}/#/settings`, wait: "!!document.querySelector(\".install .btn\")", timeout: 20000 },
  { name: "install", click: ".install .btn", settle: 3000 },
  { name: "tab", key: "Tab" }, { name: "return", key: "Return", settle: 3000 },
  { name: "window", xshot: `${EV}/pwa/installed-window.png` },
  { name: "attach", attachApp: B }];
for (const look of ["day", "night"]) for (const [w, h] of [[390, 844], [1440, 900]])
  steps.push({ name: `card-${look}-${w}`, w, h, dpr: w < 500 ? 2 : 1, mobile: w < 500, url: `${B}/?${look}#/chief`,
    wait: "!!document.querySelector(\".unlock-card\")", timeout: 20000,
    eval: "[matchMedia(\"(display-mode: standalone)\").matches, (() => { const el = document.querySelector(\".chat .lines\"), b = el.getBoundingClientRect(), r = document.querySelector(\".unlock-card\").getBoundingClientRect(); return { cardTop: Math.round(r.top - b.top), below: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) }; })()]",
    out: `${EV}/pwa/unlock-card-${look}-${w}.png` });
console.log(JSON.stringify({ profile: `${LAB}/pwa/profile`, home: `${LAB}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, recorder: `${SK}/record.mjs`, args: ["--window-size=1400,950", "--force-device-scale-factor=1", "about:blank"], steps }));
' "$B" "$(<"$LAB/state/person.key")" "$LAB" "$EV" "$REPO/scripts/verify" > "$LAB/pwa-plan.json"
xvfb-run -a -s "-screen 0 1920x1200x24" node scripts/verify/pwa-shell.mjs "$LAB/pwa-plan.json" > "$EV/pwa/run.json"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("pwa", JSON.stringify(r.filter((x) => "value" in x || "error" in x)))' "$EV/pwa/run.json" | tee -a "$EV/transcript.txt"

log "evidence: $EV"
node "$REPO/scripts/verify/steps.mjs" "$EV" ask-in-view
