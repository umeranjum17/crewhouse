#!/usr/bin/env bash
# The locked-PDF journey on a real crewd (stub engine), docs/verification/unlock-card.md: two locked statements sent to Penny, the
# card in Chief's chat typed into in a real browser (wrong, then right), the copies read back, and every store searched.
#   EVIDENCE_HOME=<your evidence folder> bash scripts/verify/unlock-card.sh <evidence-dir>
# Needs qpdf, ghostscript, bubblewrap, xvfb-run, chrome-devtools-axi, and the network once (the Documents tool's pip).
set -euo pipefail
EV=$(mkdir -p "$1" && cd "$1" && pwd); REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel); cd "$REPO"
SCRATCH=${SCRATCH:-$HOME/.cache/fm-scratch/ch-secret-card}; mkdir -p "$SCRATCH" "$EV/screens"
LAB=$(mktemp -d "$SCRATCH/l.XXXX"); mkdir -p "$LAB"/{home,state,crew,tools,run,pdf,profile}
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-ch-secret-card} CHROME_DEVTOOLS_AXI_USER_DATA_DIR="$LAB/profile"
NODE=$(node -p process.execPath)   # the real binary: a version-manager shim fails under the masked env
PW1='Northbank-7319!' PW2='CitySav 2026' PW3='CitySav 2027'   # the second has a space: the whole line is the password
log() { printf '%s\n' "$*" | tee -a "$EV/transcript.txt"; }

# Two real statements, each locked with its own password (AES-256, as banks send them).
for s in "northbank-march:Northbank statement, March:$PW1" "citysavings-april:City Savings statement, April:$PW2" "citysavings-may:City Savings statement, May:$PW3"; do
  IFS=: read -r name title pw <<<"$s"
  printf '/Helvetica findfont 14 scalefont setfont 72 720 moveto (%s) show 72 696 moveto (Tesco groceries 42.10) show 72 672 moveto (Rent 1200.00) show showpage\n' "$title" > "$LAB/pdf/$name.ps"
  gs -q -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -sOutputFile="$LAB/pdf/$name.plain.pdf" "$LAB/pdf/$name.ps"
  qpdf --encrypt --user-password="$pw" --owner-password="$pw-owner" --bits=256 -- "$LAB/pdf/$name.plain.pdf" "$LAB/pdf/$name.pdf"
  log "fixture $name.pdf: $(qpdf --show-encryption "$LAB/pdf/$name.pdf" --password='' 2>&1 | head -1)"
done

MASK=(env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" XDG_STATE_HOME="$LAB/home/.local/state"
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache"
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_ENGINE=stub
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools")
"${MASK[@]}" "$NODE" src/tools.ts install documents 2>&1 | tail -2 | tee -a "$EV/transcript.txt"
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
. scripts/verify/crewd-group.sh
trap 'chrome-devtools-axi stop >/dev/null 2>&1 || true; crewd_stop || exit 1; { chmod -R u+w "$LAB"; rm -rf "$LAB"; } >/dev/null 2>&1 || true' EXIT
crewd_start . "$EV/crewd.log" "${MASK[@]}" CREWHOUSE_PORT="$PORT" "$NODE" src/main.ts
B="http://127.0.0.1:$PORT"
for _ in $(seq 600); do [ -s "$LAB/state/person.key" ] && curl --max-time 10 -fsS -o /dev/null -H x-crewhouse:1 -H "Authorization: Bearer $(<"$LAB/state/person.key")" "$B/api/state" 2>/dev/null && break; sleep 0.2; done
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $(<"$LAB/state/person.key")")
api() { curl --max-time 10 -fsS "${H[@]}" "$@"; }
until_js() { for _ in $(seq 300); do api "$B/api/state" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const state=JSON.parse(s);process.exit(($1)?0:1)})" && return 0; sleep 0.2; done; log "timed out: $1"; return 1; }

api -X POST -d '{"address":"Umer"}' "$B/api/onboard" >/dev/null
api -X POST -d '{"text":"I need help with my money paperwork [tool crew_recruit {\"template\":\"helper\",\"name\":\"Penny\"}]"}' "$B/api/bots/chief/messages" >/dev/null
until_js "state.bots.some((b) => b.id === 'penny') && !state.bots.find((b) => b.id === 'chief').task"
# Both statements sent in Penny's thread land as files/inbox/<task>-<n>.pdf; her job is task 2 (1 was Chief's hire).
"$NODE" -e 'const [a, b] = process.argv.slice(1).map((f) => require("fs").readFileSync(f).toString("base64"));
console.log(JSON.stringify({ text: "Read my two statements [tool crew_unlock {\"files\":[\"files/inbox/2-1.pdf\",\"files/inbox/2-2.pdf\"]}]",
  files: [{ type: "application/pdf", name: "Northbank March.pdf", data: a }, { type: "application/pdf", name: "City Savings April.pdf", data: b }] }))' \
  "$LAB/pdf/northbank-march.pdf" "$LAB/pdf/citysavings-april.pdf" | api -X POST -d @- "$B/api/bots/penny/messages" >/dev/null
until_js "state.asks.some((a) => a.kind === 'unlock' && a.bot === 'chief')"
api "$B/api/state" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('ask', JSON.stringify(JSON.parse(s).asks.find((a)=>a.kind==='unlock'))))" | tee -a "$EV/transcript.txt"

chrome-devtools-axi pages >/dev/null; chrome-devtools-axi selectpage 1 >/dev/null   # a kept profile starts with no tab selected
chrome-devtools-axi open "$B/#person=$(<"$LAB/state/person.key")" >/dev/null
show() { printf '(async () => { for (let i = 0; i < 50 && !document.querySelector("%s"); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector("%s")?.scrollIntoView({ block: "center" }); return true; })()' "$1" "$1"; }
THEN=$(show .unlock-card) bash scripts/verify/screens.sh "$EV/screens" unlock-card "$B/#/chief" >/dev/null
# Refs without their snapshot generation: every action bumps it, so a gN: prefix is stale after the first fill.
fields() { chrome-devtools-axi snapshot --full | awk '/textbox "[^"]*\.pdf"/{sub(/uid=(g[0-9]+:)?/,"",$1); print $1}'; }
button() { chrome-devtools-axi snapshot --full | awk -v n="$1" '$0 ~ "button \"" n {sub(/uid=(g[0-9]+:)?/,"",$1); print $1; exit}'; }
# The look check at the hardest size (360 wide, text x1.3, day and night), each shot beside mock 3A (EVIDENCE_HOME holds it).
node scripts/verify/look-check.mjs web --out "$EV/look" --person "$LAB/state/person.key" --then "$(show .unlock-card)" unlock-card="$B/#/chief" | tee -a "$EV/transcript.txt"
# Two files: the pick reads Keep them, picked in each theme and width; the next fresh open resets the card to the default.
KEEP='(async () => { for (let i = 0; i < 50 && !document.querySelector(".unlock-keep"); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector(".unlock-keep .keep-opt:last-child input").click(); document.querySelector(".unlock-card").scrollIntoView({ block: "start" }); return true; })()'
THEN="$KEEP" bash scripts/verify/screens.sh "$EV/screens" keep-them "$B/#/chief" >/dev/null
chrome-devtools-axi eval "[...document.querySelectorAll('.unlock-keep .keep-opt')].map((e) => e.innerText.trim() + (e.querySelector('input').checked ? ' (picked)' : '')).join(' / ')" | tee -a "$EV/transcript.txt"
# At 390, a wrong password for April and the right one for March: March opens, the card keeps only April and says so plainly.
chrome-devtools-axi resize 390 844 >/dev/null; chrome-devtools-axi open "$B/?day#/chief" >/dev/null; chrome-devtools-axi wait "it's forgotten" >/dev/null
mapfile -t F < <(fields); chrome-devtools-axi fill "@${F[0]}" "$PW1" >/dev/null; chrome-devtools-axi fill "@${F[1]}" 'CitySav 2025' >/dev/null
chrome-devtools-axi click "@$(button 'Unlock 2 files')" >/dev/null
chrome-devtools-axi wait "didn't open" >/dev/null
chrome-devtools-axi eval "document.querySelector('.unlock-card [role=alert]')?.textContent" | tee -a "$EV/transcript.txt"
chrome-devtools-axi eval "$(show .unlock-card)" >/dev/null; chrome-devtools-axi screenshot "$EV/screens/unlock-wrong-day-390.png" >/dev/null
chrome-devtools-axi open "$B/?night#/chief" >/dev/null; chrome-devtools-axi wait "it's forgotten" >/dev/null; chrome-devtools-axi eval "$(show .unlock-card)" >/dev/null; chrome-devtools-axi screenshot "$EV/screens/unlock-retry-night-390.png" >/dev/null
# The installed app (headed, under Xvfb): Settings' own Install, Chromium's sheet, the card, then April's password typed on film.
node -e '
const [B, key, LAB, EV, SK, THEN, PW] = process.argv.slice(1), steps = [
  { name: "boot", w: 1400, h: 950, dpr: 1, mobile: false, url: `${B}/#person=${key}`, settle: 3000 },
  { name: "settings", url: `${B}/#/settings`, wait: "!!document.querySelector(\".install .btn\")", timeout: 20000 },
  { name: "install", click: ".install .btn", settle: 3000 }, { name: "sheet", xshot: `${EV}/pwa/install-sheet.png` },
  { name: "tab", key: "Tab" }, { name: "return", key: "Return", settle: 3000 }, { name: "window", xshot: `${EV}/pwa/installed-window.png` },
  { name: "attach", attachApp: B }];
for (const look of ["day", "night"]) for (const [w, h] of [[390, 844], [1440, 900]])
  steps.push({ name: `card-${look}-${w}`, w, h, dpr: w < 500 ? 2 : 1, mobile: w < 500, url: `${B}/?${look}#/chief`, wait: "!!document.querySelector(\".unlock-card\")", timeout: 20000,
    eval: `[matchMedia("(display-mode: standalone)").matches, ${THEN}][0]`, out: `${EV}/pwa/unlock-card-${look}-${w}.png` });
// The Keep pick (April alone now, so Keep it) in the installed window itself: full width, then the narrowest window
// Chromium allows an installed app (508), never a phone viewport inside a wide window.
steps.push({ name: "wide", win: [1440, 900], url: `${B}/?day#/chief`, wait: "!!document.querySelector(\".unlock-card input\")", timeout: 20000, eval: THEN },
  { name: "wide-keep", click: ".unlock-keep .keep-opt:last-child input", settle: 400, wshot: `${EV}/pwa/keep-it-1440.png` });
steps.push({ name: "film", win: [508, 880], url: `${B}/?day#/chief`, wait: "!!document.querySelector(\".unlock-card input\")", timeout: 20000, record: `${EV}/pwa/unlock-type.webm`, seconds: 10 },
  { name: "type", eval: `(() => { const t = document.querySelector(".unlock-card input"); t.closest("form").scrollIntoView({ block: "center" }); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(t, ${JSON.stringify(PW)}); t.dispatchEvent(new Event("input", { bubbles: true })); return t.value.length; })()` },
  { name: "keep", click: ".unlock-keep .keep-opt:last-child input", settle: 400, wshot: `${EV}/pwa/keep-it-narrow.png`,
    eval: `[document.querySelector(".unlock-keep .keep-opt:last-child input").checked, document.querySelector(".unlock-keep .keep-opt:first-child input").checked].join("/")` },
  { name: "unlock", click: ".unlock-card .btn.go", settle: 3000 }, { name: "filmed", recwait: true, wait: "!!document.querySelector(\".answered\")", out: `${EV}/pwa/unlocked-day-narrow.png` });
console.log(JSON.stringify({ profile: `${LAB}/pwa/profile`, home: `${LAB}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, recorder: `${SK}/record.mjs`, args: ["--window-size=1400,950", "--force-device-scale-factor=1", "about:blank"], steps }));
' "$B" "$(<"$LAB/state/person.key")" "$LAB" "$EV" "$REPO/scripts/verify" "$(show .unlock-card)" "$PW2" > "$LAB/pwa-plan.json"
mkdir -p "$EV/pwa" "$LAB/pwa/home/run"; xvfb-run -a -s "-screen 0 1920x1200x24" node scripts/verify/pwa-shell.mjs "$LAB/pwa-plan.json" > "$EV/pwa/run.json"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("pwa", JSON.stringify(r.filter((x) => "value" in x || x.error)))' "$EV/pwa/run.json" | tee -a "$EV/transcript.txt"
until_js "!state.asks.some((a) => a.kind === 'unlock')"
until_js "!state.bots.find((b) => b.id === 'penny').task"
THEN=$(show .answered) bash scripts/verify/screens.sh "$EV/screens" unlocked "$B/#/chief" >/dev/null
# Kept: both copies outlived the job, and each is a card in Penny's own chat with Forget this file on it.
for f in 2-1 2-2; do log "kept copy $f: $( [ -f "$LAB/crew/bots/penny/files/unlocked/files%2Finbox%2F$f.pdf" ] && echo present || echo MISSING )"; done
SHOW=$(show .file-with-forget); chrome-devtools-axi open "$B/#/h/penny" >/dev/null; chrome-devtools-axi wait "· unlocked" >/dev/null
chrome-devtools-axi eval "$(show .file-with-forget)" >/dev/null; chrome-devtools-axi screenshot "$EV/screens/kept-copy-day-390.png" >/dev/null
THEN="$SHOW" bash scripts/verify/screens.sh "$EV/screens" kept-copy "$B/#/h/penny" >/dev/null
node scripts/verify/look-check.mjs web --out "$EV/look" --person "$LAB/state/person.key" --then "$SHOW" kept-copy="$B/#/h/penny" | tee -a "$EV/transcript.txt"
chrome-devtools-axi eval "JSON.stringify([...document.querySelectorAll('.file-with-forget')].map((e) => e.innerText.replace(/\n/g, ' | ')))" | tee -a "$EV/transcript.txt"
# The kept copy's own card (the last one), not the file the person sent: Forget this file, then Forget it.
FORGET=$(chrome-devtools-axi snapshot --full | awk '/button "Forget this file"/{sub(/uid=(g[0-9]+:)?/,"",$1); print $1}' | tail -1)
chrome-devtools-axi click "@$FORGET" >/dev/null; chrome-devtools-axi wait "Forget it" >/dev/null
chrome-devtools-axi click "@$(chrome-devtools-axi snapshot --full | awk '/button "Forget it"/{sub(/uid=(g[0-9]+:)?/,"",$1); print $1; exit}')" >/dev/null
until_js "state.forgotten.some((f) => f.path === 'files/unlocked/files%2Finbox%2F2-2.pdf')"
log "forgotten 2-2: $( [ -f "$LAB/crew/bots/penny/files/unlocked/files%2Finbox%2F2-2.pdf" ] && echo present || echo MISSING )"
chrome-devtools-axi eval "JSON.stringify({ cards: document.querySelectorAll('.file-with-forget').length, note: [...document.querySelectorAll('.line.note')].map((e) => e.innerText).slice(-1) })" | tee -a "$EV/transcript.txt"
# The other rule: the card now starts on Penny's standing Keep, so the person picks Remove it when the job ends,
# and the job's own end takes the third statement's copy.
T3=$("$NODE" -e 'const a = require("fs").readFileSync(process.argv[1]).toString("base64");
console.log(JSON.stringify({ text: "Here is a file.", files: [{ type: "application/pdf", name: "City Savings May.pdf", data: a }] }))' "$LAB/pdf/citysavings-may.pdf" | api -X POST -d @- "$B/api/bots/penny/messages" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).task))")
log "May's statement is task $T3"
"$NODE" -e 'const a = require("fs").readFileSync(process.argv[1]).toString("base64"), at = process.argv[2];
console.log(JSON.stringify({ text: `Read my May statement [tool crew_unlock ${JSON.stringify({ files: [`files/inbox/${at}-1.pdf`] })}]`, files: [{ type: "application/pdf", name: "City Savings May.pdf", data: a }] }))' \
  "$LAB/pdf/citysavings-may.pdf" "$T3" | api -X POST -d @- "$B/api/bots/penny/messages" >/dev/null
until_js "state.asks.some((a) => a.kind === 'unlock' && a.bot === 'chief')"
# One file: the same rule on the card, said for one copy (day and night, 390 and 1440).
THEN=$(show .unlock-keep) bash scripts/verify/screens.sh "$EV/screens" keep-it "$B/#/chief" >/dev/null
chrome-devtools-axi open "$B/?day#/chief" >/dev/null; chrome-devtools-axi wait "it's forgotten" >/dev/null
chrome-devtools-axi eval "JSON.stringify([...document.querySelectorAll('.unlock-keep .keep-opt')].map((e) => e.innerText.trim()))" | tee -a "$EV/transcript.txt"
MAY=$(api "$B/api/state" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).asks.find((x)=>x.kind==='unlock');console.log(a.id)})")
api -X POST -d "{\"answer\":\"allow\",\"rule\":\"job\",\"passwords\":[\"$PW3\"]}" "$B/api/asks/$MAY/answer" >/dev/null
until_js "!state.bots.find((b) => b.id === 'penny').task"
log "remove-when-done rule, May's copy: $( [ -f "$LAB/crew/bots/penny/files/unlocked/files%2Finbox%2F$T3-1.pdf" ] && echo present || echo GONE ); recorded gone: $(api "$B/api/state" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const g=JSON.parse(s).forgotten.filter((f)=>f.path.endsWith('$T3-1.pdf'));console.log(g.length)})")";
chrome-devtools-axi eval "JSON.stringify({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), receipt: [...document.querySelectorAll('.answered')].map((e) => e.textContent) })" | tee -a "$EV/transcript.txt"

for f in 2-1; do
  c="$LAB/crew/bots/penny/files/unlocked/files%2Finbox%2F$f.pdf"
  log "kept $f: copy $( [ -f "$c" ] && echo present || echo MISSING ); encrypted: $(qpdf --is-encrypted "$c" && echo yes || echo no); reads: $("$LAB/tools/documents/venv/bin/markitdown" "$c" | head -1)"
done
api "$B/api/bots/penny" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);console.log('penny task', JSON.stringify(b.tasks[0] && { state: b.tasks[0].state, body: b.tasks[0].body }))})" | tee -a "$EV/transcript.txt"
crewd_stop; chrome-devtools-axi stop >/dev/null 2>&1 || true

# Everything kept: the database and its WAL, crewd's log, the crew and state folders, the browsers' own profiles.
for s in "March's:$PW1" "April's:$PW2" "the wrong one:CitySav 2025"; do
  who=${s%%:*} pw=${s#*:}
  hits=$({ grep -rlaF -- "$pw" "$LAB/state" "$LAB/crew" "$LAB/profile" "$LAB/pwa" "$EV/crewd.log" 2>/dev/null || true; } | wc -l)
  log "password search, $who: $hits files hold it"
done
cp "$LAB/pdf/northbank-march.pdf" "$LAB/pdf/citysavings-april.pdf" "$LAB/pdf/citysavings-may.pdf" "$EV/" && log "evidence: $EV"
