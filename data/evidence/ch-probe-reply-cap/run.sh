#!/usr/bin/env bash
# ch-probe-reply-cap proof: stub-engine chat-probe run with a >400-char thread line.
# Repro: bash data/evidence/ch-probe-reply-cap/run.sh  (from the repo root)
# Writes: screen.jsonl, message.txt, lengths.txt into this same evidence folder.
set -u
REPO="$(git rev-parse --show-toplevel)"
EV="$REPO/data/evidence/ch-probe-reply-cap"
SCRATCH="$HOME/.cache/fm-scratch/ch-probe-reply-cap"
LAB="$SCRATCH/lab"
OUT="$SCRATCH/probe-out"
rm -rf "$LAB" "$OUT"
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools} "$OUT" "$EV"
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts" > "$OUT/crewd.log" 2>&1 &
CREWD_PID=$!
B="http://127.0.0.1:$PORT"; H='-H content-type:application/json -H x-crewhouse:1'
ready=0
for i in $(seq 1 100); do
  if curl -fsS "$B/api/state" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(!j.person)process.exit(1)})' 2>/dev/null; then ready=1; break; fi
  sleep 0.5
done
if [ "$ready" != 1 ]; then echo "crewd never became ready"; tail -20 "$OUT/crewd.log"; kill -TERM "$CREWD_PID" 2>/dev/null; exit 1; fi
curl -fsS -X POST $H -d '{"address":"Umer"}' "$B/api/onboard" > /dev/null
MSG="$(node -e 'const base="Please acknowledge this long probe line without calling any tools: ";console.log(base+"0123456789 ".repeat(38))')"
node -e 'const m=process.argv[1];console.log("message chars: "+m.length);if(m.length<=400){console.error("message too short");process.exit(1)}' "$MSG"
printf '%s' "$MSG" > "$EV/message.txt"
node "$REPO/.agents/skills/verify-crewhouse/scripts/chat-probe.mjs" "$B" "$OUT" "$MSG" 1440 900 '/?day#/' 120
cp "$OUT/screen.jsonl" "$EV/screen.jsonl"
node -e '
const fs=require("node:fs");
const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>JSON.parse(l));
let maxFull=0,maxPrev=0,fullSample="";
for(const r of rows){
  for(const t of (r.linesFull??[])){if(t.length>maxFull){maxFull=t.length;fullSample=t;}}
  for(const t of (r.lines??[])){if(t.length>maxPrev)maxPrev=t.length;}
}
console.log("rows: "+rows.length);
console.log("max lines[] (preview, capped 160): "+maxPrev);
console.log("max linesFull[] (whole text): "+maxFull);
console.log("longest linesFull sample: "+fullSample.slice(0,120)+"...");
if(maxFull<=400){console.error("FAIL: no reply line over 400 chars recorded whole");process.exit(1);}
console.log("PASS: a reply line over 400 chars is recorded whole in screen.jsonl");
' "$EV/screen.jsonl" | tee "$EV/lengths.txt"
kill -TERM "$CREWD_PID"
wait "$CREWD_PID" 2>/dev/null || true
rm -rf "$LAB" "$OUT"
echo "evidence: $EV/screen.jsonl $EV/lengths.txt $EV/message.txt"
