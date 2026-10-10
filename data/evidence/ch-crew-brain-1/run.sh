#!/usr/bin/env bash
# ch-crew-brain-1 real-engine proof: the shared "About me and my work" record reaches
# a Scribe job and a Reel job on the real model, and both first outputs use it.
# Runs worktree crewd on the REAL engine with throwaway HOME/state (precedent:
# data/evidence/ch-c2-real-model-proof). Must run under fm-cred-lock.sh (one engine
# run at a time on the shared Claude test credential).
# Usage: fm-cred-lock.sh fm-mem-gate.sh bash data/evidence/ch-crew-brain-1/run.sh [fresh|retained]
#   fresh: throwaway HOME/state (stub-style isolation). The fresh gateway holds no
#     account auth, so real-model jobs pause; kept for the record round-trip only.
#   retained (default): this worktree's crewd on the shared retained test home
#     (/home/umer/lab-tmp/crewhouse-retained). HOME stays the retained home because
#     sealed app-signins unseal against its host key; the engine reads the Claude
#     credential from a symlink placed there for the run and removed afterwards.
#     One lane at a time; the footprint (reel recruit, profile, two tasks, crew commits)
#     is noted in README.md and the profile is cleared afterwards.
set -euo pipefail
TASK=ch-crew-brain-1
REPO=/home/umer/.treehouse/crewhouse-0ec48b/13/crewhouse
MODE="${1:-retained}"
EV="$REPO/data/evidence/$TASK"
CRED=/home/umer/lab-tmp/claude-test-cred/home/.claude/.credentials.json
SCR="$HOME/.cache/fm-scratch/$TASK"
EHOME="$SCR/home"
rm -rf "$EHOME"; mkdir -p "$EHOME/.claude"
if [ "$MODE" = retained ]; then
  R=/home/umer/lab-tmp/crewhouse-retained
  EHOME="$R/home"
  mkdir -p "$EHOME/.claude"
  ln -sfn "$CRED" "$EHOME/.claude/.credentials.json"  # symlink, never a copy; removed at exit
  ESTATE="$R/run/state"; ECREW="$R/run/crew"; ETOOLS="$R/run/tools"
else
  ESTATE="$SCR/state"; ECREW="$SCR/crew"; ETOOLS="$SCR/tools"
  rm -rf "$ESTATE" "$ECREW" "$ETOOLS"; mkdir -p "$ESTATE" "$ECREW" "$ETOOLS"
  ln -s "$CRED" "$EHOME/.claude/.credentials.json"  # symlink, never a copy
  [ -e "$CRED" ] || { echo "test credential missing: $CRED" >&2; exit 1; }
fi
mkdir -p "$EV"
cleanup_home() { [ "$MODE" = retained ] && rm -f "$EHOME/.claude/.credentials.json" || true; }
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
H='-H content-type:application/json -H x-crewhouse:1'

cd "$REPO"
echo "== starting crewd (real engine, $MODE) on $PORT"
# PATH carries the one dir holding the `claude` CLI: the engine's Claude route drives that
# binary (src/openclaw/runtime.ts `enginePath`) and reads the symlinked test credential through it.
env -i PATH=/home/umer/.local/bin:/usr/bin:/bin LANG=C.UTF-8 HOME="$EHOME" TMPDIR="$EHOME" \
  XDG_STATE_HOME="$EHOME/.local/state" XDG_DATA_HOME="$EHOME/.local/share" \
  XDG_CONFIG_HOME="$EHOME/.config" XDG_CACHE_HOME="$EHOME/.cache" \
  XDG_RUNTIME_DIR="$EHOME/.run" DBUS_SESSION_BUS_ADDRESS="unix:path=$EHOME/no-bus" \
  CREWHOUSE_PORT="$PORT" CREWHOUSE_LINK_PORT=0 \
  CREWHOUSE_STATE_DIR="$ESTATE" CREWHOUSE_CREW_DIR="$ECREW" CREWHOUSE_TOOLS_DIR="$ETOOLS" \
  MISE_OFFLINE=1 node src/main.ts > "$EV/crewd.log" 2>&1 &
DPID=$!
stop_crewd() { /usr/bin/pkill -TERM -P "$DPID" 2>/dev/null || true; kill -TERM "$DPID" 2>/dev/null || true;
  for _ in $(seq 1 50); do kill -0 "$DPID" 2>/dev/null || break; sleep 2; done; cleanup_home; }
trap stop_crewd EXIT

echo "== waiting for /api/state (up to 10 min, engine installs on first boot)"
for _ in $(seq 1 120); do
  if curl -fsS "$B/api/state" 2>/dev/null | grep -q '"person"'; then break; fi
  kill -0 $DPID 2>/dev/null || { echo "crewd died; see $EV/crewd.log" >&2; exit 1; }
  sleep 5
done
curl -fsS "$B/api/state" | grep -q '"person"' || { echo "crewd did not answer" >&2; exit 1; }
echo "== crewd is up"

: > "$EV/transcript.log"

echo "== accounts (claude must be signed in via the test credential)"
curl -fsS "$B/api/accounts" | tee -a "$EV/transcript.log"

if [ "$MODE" = retained ]; then
  echo "== retained mode: person is already Umer; skipping onboard"
else
  echo "== onboard as Umer"
  curl -fsS -X POST $H -d '{"address":"Umer"}' "$B/api/onboard" | tee -a "$EV/transcript.log"; echo
fi

RECORD='I am a solo ops consultant. I write short, plain sentences for busy agency founders. I sell a weekly ops review that finds the one bottleneck. Past work: inbox-zero crews for two design studios.'
echo "== set the record"
curl -fsS -X PUT $H -d "$(node -e 'console.log(JSON.stringify({text:process.argv[1]}))' "$RECORD")" "$B/api/profile" | tee -a "$EV/transcript.log"; echo
echo "== read the record back"
curl -fsS "$B/api/profile" | tee "$EV/record.json"; echo; cat "$EV/record.json" >> "$EV/transcript.log"

echo "== recruit missing helpers (scribe exists retained; reel does not)"
BOTS=$(curl -fsS "$B/api/state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).bots.map(b=>b.id).join(",")))')
echo "bots: $BOTS" | tee -a "$EV/transcript.log"
case ",$BOTS," in *,scribe,*) echo "scribe present";; *) curl -fsS -X POST $H -d '{"template":"scribe","name":"Scribe"}' "$B/api/recruit" | tee -a "$EV/transcript.log";; esac
case ",$BOTS," in *,reel,*) echo "reel present";; *) curl -fsS -X POST $H -d '{"template":"reel","name":"Reel"}' "$B/api/recruit" | tee -a "$EV/transcript.log";; esac

post_job() { # <bot> <text>: prints task id
  curl -fsS -X POST $H -d "$(node -e 'console.log(JSON.stringify({text:process.argv[1]}))' "$2")" "$B/api/bots/$1/messages" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).task))'
}
wait_task() { # <bot> <task>: waits up to ~20 min for done/failed; survives a crewd restart
  for _ in $(seq 1 150); do
    st=$(curl -fsS "$B/api/bots/$1" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const t=JSON.parse(s).tasks.find(t=>t.id===$2);console.log(t?t.state:'missing')})" 2>/dev/null || echo DOWN)
    case "$st" in done|failed|unsure) echo "$st"; return 0;; esac
    sleep 8
  done
  echo TIMEOUT; return 1
}
first_output() { # <bot> <task> <outfile>: first bot message on the task + full thread
  curl -fsS "$B/api/bots/$1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);require('fs').writeFileSync('$3.thread.json',JSON.stringify(p.messages.filter(m=>m.task_id===$2),null,1));const f=p.messages.filter(m=>m.task_id===$2&&m.author==='bot');require('fs').writeFileSync('$3',f.length?f[0].text:'(no bot reply)')})"
}

resume_or_post() { # <bot> <text>: reuses the bot's latest paused task with my job words, else posts
  old=$(curl -fsS "$B/api/bots/$1" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).tasks.filter(t=>["paused","queued"].includes(t.state)&&(t.body||"").includes("weekly ops review")).sort((a,b)=>b.id-a.id)[0];console.log(t?t.id:"")})' 2>/dev/null)
  if [ -n "$old" ]; then echo "reusing $1 task $old" | tee -a "$EV/transcript.log"; echo "$old"; else post_job "$1" "$2"; fi
}

echo "== scribe job"
STASK=$(resume_or_post scribe 'Write a post announcing my weekly ops review. One variant, plain words.')
echo "scribe task $STASK"
wait_task scribe "$STASK"
first_output scribe "$STASK" "$EV/scribe-first.txt"

echo "== reel job"
RTASK=$(resume_or_post reel 'Write a 30-second demo script for my weekly ops review. Plain words, no jargon.')
echo "reel task $RTASK"
wait_task reel "$RTASK"
first_output reel "$RTASK" "$EV/reel-first.txt"

mv "$EV/scribe-first.txt.thread.json" "$EV/scribe-thread.json"
mv "$EV/reel-first.txt.thread.json" "$EV/reel-thread.json"
if [ "$MODE" = retained ]; then
  echo "== clear the record so other lanes' prompts are unaffected"
  curl -fsS -X PUT $H -d '{"text":""}' "$B/api/profile" | tee -a "$EV/transcript.log"; echo
fi
echo "== first outputs:"
echo "--- scribe:"; cat "$EV/scribe-first.txt"; echo; echo "--- reel:"; cat "$EV/reel-first.txt"
