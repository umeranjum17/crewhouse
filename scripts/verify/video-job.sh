#!/usr/bin/env bash
# The video job (docs/verification/video-job.md): the person pastes a video link in Chief's chat, Chief hands it to Video
# Vic, the person picks the quality on a card before anything downloads, and the saved video comes back with its link.
#   bash scripts/verify/video-job.sh <repo> <out-dir>
# Real crewd on the stub engine (CREWHOUSE_STUB_GOLDEN scripts Chief's hand-off and Vic's call; no account, no model),
# isolated per docs/verification/runbook.md's Launch, web/dist built first. The pinned yt-dlp is a stand-in in the lab's
# own tool folder, at the manifest's own pin: `-J` answers with a YouTube upload's formats, a download copies a real
# 6-second mp4 made here with ffmpeg; no site is reached. The download runs on the crew host, in Vic's sandbox.
# Proves: the card is Chief's and nothing is in Vic's files before the pick; the card's qualities and sizes; the pick made
# with a tap in the installed app at phone width; only the picked file lands, with its link; the card and the result at
# 390 and 1440, day and night, in a browser tab and in the installed app; the look check at 360 with the largest text.
# Needs ffmpeg, chrome-devtools-axi, chromium, xvfb-run, ImageMagick. Scratch under ~/.cache/fm-scratch, never /tmp.
set -euo pipefail
REPO=$(cd "$1" && pwd); OUT=$(mkdir -p "$2" && cd "$2" && pwd)
SCRATCH=${SCRATCH:-$HOME/.cache/fm-scratch/ch-video-job}; mkdir -p "$SCRATCH" "$OUT/screens" "$OUT/pwa"
LAB=$(mktemp -d "$SCRATCH/l.XXXX"); mkdir -p "$LAB"/{home,state,crew,tools/video-download,tools/bin,run,pwa/home/run}
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-ch-video-job}
NODE=$(node -p process.execPath)   # the real binary: a version-manager shim fails under the masked env
LINK='https://www.youtube.com/watch?v=aqz-KE-bpKQ'
log() { printf '%s\n' "$*" | tee -a "$OUT/transcript.txt"; }

# The pinned tool as an install leaves it, at the manifest's own pin, with the stand-in in place of the real binary.
T="$LAB/tools/video-download"
"$NODE" -e 'const m = require(process.argv[1]); process.stdout.write(JSON.stringify({ download: m.install.download }))' "$REPO/tools/video-download/tool.json" > "$T/.pin"
"$NODE" --input-type=module -e 'const { SAVER, INFO } = await import(process.argv[1]); const fs = await import("node:fs");
  fs.writeFileSync(process.argv[2] + "/yt-dlp", SAVER, { mode: 0o755 }); fs.writeFileSync(process.argv[2] + "/info.json", JSON.stringify(INFO));' "$REPO/test/video-saver.ts" "$T"
ln -s "$T/yt-dlp" "$LAB/tools/bin/yt-dlp"
ffmpeg -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 -t 6 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -movflags +faststart "$T/sample.mp4"

MASK=(env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" XDG_STATE_HOME="$LAB/home/.local/state"
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache"
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_ENGINE=stub CREWHOUSE_STUB_GOLDEN=1
  CREWHOUSE_HOLD_MS=900000 CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools")
PORT=$("$NODE" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
. "$REPO/scripts/verify/crewd-group.sh"
cleanup() { chrome-devtools-axi stop >/dev/null 2>&1 || true; crewhouse_remove_lab "$LAB"; }
trap cleanup EXIT
crewd_start "$REPO" "$OUT/crewd.log" "${MASK[@]}" CREWHOUSE_PORT="$PORT" "$NODE" src/main.ts
wait_for() { for _ in $(seq 1 600); do "$@" >/dev/null 2>&1 && return 0; kill -0 "$CREWD" 2>/dev/null || { log "crewd exited"; tail "$OUT/crewd.log"; exit 1; }; sleep 0.2; done; log "timed out: $*"; exit 1; }
KEY=$(<"$LAB/state/person.key" 2>/dev/null || true)
ready() { [ -s "$LAB/state/person.key" ] && curl --max-time 10 -fsS "$B/api/state" -H x-crewhouse:1 -H "Authorization: Bearer $(cat "$LAB/state/person.key")" | grep -q '"person"'; }
wait_for ready
KEY=$(<"$LAB/state/person.key")
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $KEY")
api() { curl --max-time 10 -fsS "${H[@]}" "$@"; }
post() { api -X "$1" -d "$3" "$B$2" >/dev/null; }
post PUT /api/people/1 '{"name":"Umer"}'
post POST /api/onboard '{"address":"Umer"}'
post POST /api/recruit '{"template":"reel"}'
VIC="$LAB/crew/bots/video-vic"
state_of() { api "$B/api/state" | "$NODE" -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

# The person pastes the link in Chief's chat. Chief hands it to Vic; Vic's call reads the link and files the card.
api -X POST -d "{\"text\":\"Save this video for me: $LINK\"}" "$B/api/bots/chief/messages" > "$OUT/sent.json"
has_card() { [ "$(state_of 'j.asks.filter((a)=>a.kind==="video").length')" = 1 ]; }
wait_for has_card
state_of 'JSON.stringify(j.asks.find((a)=>a.kind==="video"),null,1)' > "$OUT/card.json"
{ echo "card: $(state_of 'j.asks.find((a)=>a.kind==="video").title') | owner: $(state_of 'j.asks.find((a)=>a.kind==="video").bot')"
  echo "choices: $(state_of 'j.asks.find((a)=>a.kind==="video").detail.pick.choices.map((c)=>c.label+" "+c.size).join(" | ")')"
  echo "Vic's job: $(state_of 'JSON.stringify(j.tasks.filter((t)=>t.bot==="video-vic").map((t)=>({id:t.id,state:t.state,origin:t.origin,parent:t.parent})))')"
  echo "Vic's files before the pick: $(find "$VIC/files" -type f 2>/dev/null | wc -l)"
} | tee "$OUT/before-pick.txt"
[ "$(state_of 'j.asks.find((a)=>a.kind==="video").bot')" = chief ] || { log "the card is not Chief's"; exit 1; }
[ "$(find "$VIC/files" -type f 2>/dev/null | wc -l)" = 0 ] || { log "something downloaded before the pick"; exit 1; }

# The card in a browser tab: 390 and 1440, day and night.
CARD='(async () => { for (let i = 0; i < 100 && !document.querySelector(".video-ask"); i++) await new Promise((r) => setTimeout(r, 100)); const c = document.querySelector(".video-ask"); if (c) c.scrollIntoView({ block: "center" }); return !!c; })()'
ax() { chrome-devtools-axi "$@"; }
ax stop >/dev/null 2>&1 || true; ax pages >/dev/null 2>&1 || true; ax selectpage 1 >/dev/null
ax open "$B/#person=$KEY" >/dev/null
THEN="$CARD" bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" video-card "$B/#/chief" | tee "$OUT/screens.txt"
ax resize 390 844 >/dev/null; ax open "$B/?day#/chief" >/dev/null; ax eval "$CARD" >/dev/null
ax eval '(() => { const c = document.querySelector(".video-ask"), r = c.getBoundingClientRect(); return { words: c.innerText, width: Math.round(r.width), clipped: [...c.querySelectorAll("*")].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible").length, rows: [...c.querySelectorAll("[role=radio]")].map((b) => b.innerText.replace(/\s+/g, " ")) }; })()' | tee "$OUT/card-geometry.txt"

# The installed app, for real (Settings' own Install), at phone width: the card, a tap on 720p, Save; then the result
# in Chief's thread at both widths, day and night.
CHAT='(async () => { for (let i = 0; i < 100 && !document.querySelector(".lines, .chat"); i++) await new Promise((r) => setTimeout(r, 100)); const l = document.querySelector(".lines"); if (l) l.scrollTop = l.scrollHeight; window.scrollTo(0, document.body.scrollHeight); return true; })()'
"$NODE" -e '
const [B, key, LAB, OUT, SK, CARD, CHAT] = process.argv.slice(1), url = (q) => `${B}/?${q}#/chief`, steps = [
  { name: "boot", w: 1400, h: 950, dpr: 1, mobile: false, url: `${B}/#person=${key}`, wait: "sessionStorage.getItem(\"crewhouse.person\")?.length === 64", timeout: 30000 },
  { name: "settings", url: `${B}/#/settings`, wait: "!!document.querySelector(\".install .btn\")", timeout: 20000 },
  { name: "install", click: ".install .btn", settle: 3000 }, { name: "sheet", xshot: `${OUT}/pwa/install-sheet.png` },
  { name: "tab", key: "Tab" }, { name: "return", key: "Return", settle: 3000 },
  { name: "attach", attachApp: B },
  { name: "app-authority", url: `${B}/#person=${key}`, reload: true, wait: "sessionStorage.getItem(\"crewhouse.person\")?.length === 64", timeout: 30000 }];
for (const [look, w, h] of [["night", 390, 844], ["day", 1440, 900], ["night", 1440, 900], ["day", 390, 844]])
  steps.push({ name: `card-${look}-${w}`, w, h, dpr: w < 500 ? 2 : 1, mobile: w < 500, url: url(look), wait: "!!document.querySelector(\".video-ask\")", timeout: 20000,
    eval: `[matchMedia("(display-mode: standalone)").matches, ${CARD}][0]`, out: `${OUT}/pwa/video-card-installed-${look}-${w}.png` });
steps.push({ name: "tap-720p", click: ".video-ask [role=radio]:nth-child(2)", settle: 800, eval: CARD, out: `${OUT}/pwa/video-card-picked-day-390.png` },
  { name: "save", click: ".video-ask .btn.go", settle: 1500, wait: "!document.querySelector(\".video-ask\")", timeout: 20000 },
  { name: "result", wait: "[...document.querySelectorAll(\"video, .media\")].length > 0 || /came from/i.test(document.body.innerText)", timeout: 60000 });
for (const [look, w, h] of [["day", 390, 844], ["night", 390, 844], ["day", 1440, 900], ["night", 1440, 900]])
  steps.push({ name: `result-${look}-${w}`, w, h, dpr: w < 500 ? 2 : 1, mobile: w < 500, url: url(look), settle: 3000, wait: "/came from/i.test(document.body.innerText)", timeout: 20000,
    eval: `[matchMedia("(display-mode: standalone)").matches, ${CHAT}][0]`, out: `${OUT}/pwa/video-result-installed-${look}-${w}.png` });
console.log(JSON.stringify({ profile: `${LAB}/pwa/profile`, home: `${LAB}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, args: ["--window-size=1400,950", "--force-device-scale-factor=1", "about:blank"], steps }));
' "$B" "$KEY" "$LAB" "$OUT" "$REPO/scripts/verify" "$CARD" "$CHAT" > "$LAB/pwa-plan.json"
xvfb-run -a -s "-screen 0 1920x1200x24" "$NODE" "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/pwa-plan.json" > "$OUT/pwa/run.json" || true
"$NODE" -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("pwa", JSON.stringify(r.filter((x) => "value" in x || x.error))); process.exit(r.some((x) => x.error) ? 1 : 0)' "$OUT/pwa/run.json" | tee -a "$OUT/transcript.txt"

# What landed: the one picked file, a real video, delivered with its link; the card answered with the pick.
vic_done() { [ "$(state_of 'j.tasks.find((t)=>t.bot==="video-vic")?.state')" = done ]; }
wait_for vic_done
{ echo "Vic's files: $(cd "$VIC/files" && find . -type f | sort | tr '\n' ' ')"
  F=$(find "$VIC/files" -type f -name '*.mp4' | head -1)
  echo "ffprobe: $(ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of compact=p=0 "$F" | tr '\n' ' ')"
  echo "delivered: $(state_of 'j.events.filter((e)=>e.kind==="file.delivered").map((e)=>e.data.path+" — "+e.data.note).join(" | ")')"
  echo "card answer: $(state_of 'j.answered.filter((a)=>a.kind==="video").map((a)=>a.title+" -> "+a.answer).join(" | ")')"
  echo "Chief: $(api "$B/api/bots/chief" | "$NODE" -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const t=JSON.parse(s).tasks[0];console.log(t.state+" | "+t.result)})')"
} | tee "$OUT/after-pick.txt"
[ "$(find "$VIC/files" -type f | wc -l)" = 1 ] || { log "not exactly the one picked file"; exit 1; }
grep -q "in 720p, from $LINK" "$OUT/after-pick.txt" || { log "the delivery does not name the pick and its link"; exit 1; }
grep -q 'card answer: .* -> 720p' "$OUT/after-pick.txt" || { log "the card was not answered with 720p"; exit 1; }

# The result in a browser tab, and the look check at the hardest size (360 wide, text x1.3, day and night).
THEN="$CHAT" bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" video-result "$B/#/chief" | tee -a "$OUT/screens.txt"
ax stop >/dev/null 2>&1 || true
EVIDENCE_HOME=${EVIDENCE_HOME:-$OUT} "$NODE" "$REPO/scripts/verify/look-check.mjs" web --out "$OUT/look" --person "$LAB/state/person.key" --then "$CHAT" "video-result=$B/#/chief" | tee "$OUT/look-check.txt" || log "look-check reported hits (see look/)"
"$NODE" "$REPO/scripts/verify/steps.mjs" "$OUT" video-job
ls "$OUT/screens" "$OUT/pwa"
