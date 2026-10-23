#!/usr/bin/env bash
# The pinned tool that failed: a real pinned yt-dlp (the copy the person has), a link that never resolves, and the app's
# own record of what happened. Real crewd on the stub engine, in a lab of its own; no account, no model, no quota.
#
#   scripts/verify/pinned-tool.sh <evidence-dir>
#
# Recipe: docs/verification/pinned-tool-failure.md
set -euo pipefail
EV=${1:?evidence dir}
REPO=$(git rev-parse --show-toplevel)
LAB=$(mktemp -d /tmp/crewhouse-verify.XXXXXX)
. "$(dirname "${BASH_SOURCE[0]}")/crewd-group.sh"
mkdir -p "$EV/screens" "$LAB/home" "$LAB"/{state,crew,tools} "$LAB/run"
PORT=$(/usr/bin/node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')

# The copy this person has: the pinned release the kit used before this change, with its own pin beside it.
OLD_URL=https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp
OLD_SHA=1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6
mkdir -p "$LAB/tools/video-download" "$LAB/tools/bin"
curl -fsSL --max-time 120 -o "$LAB/tools/video-download/yt-dlp" "$OLD_URL"
echo "$OLD_SHA  $LAB/tools/video-download/yt-dlp" | sha256sum -c - >/dev/null
chmod 0755 "$LAB/tools/video-download/yt-dlp"
ln -s "$LAB/tools/video-download/yt-dlp" "$LAB/tools/bin/yt-dlp"
printf '{"download":{"url":"%s","sha256":"%s"}}' "$OLD_URL" "$OLD_SHA" > "$LAB/tools/video-download/.pin"

# crewd leads a process group of its own (setsid; with no job control setsid never forks, so $! is crewd).
set +m
setsid setpriv --pdeathsig KILL -- env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  /usr/bin/node "$REPO/src/main.ts" > "$EV/crewd.log" 2>&1 &
CREWD=$!
for _ in $(seq 100); do kill -0 -- "-$CREWD" 2>/dev/null && break; sleep 0.05; done
gone() { ! kill -0 -- "-$CREWD" 2>/dev/null; }
drain() { kill "-$1" -- "-$CREWD" 2>/dev/null; for _ in $(seq 100); do gone && return; sleep 0.05; done; gone; }
cleanup() { trap '' HUP INT TERM; drain TERM || drain KILL || { echo "crewd's group outlived KILL; keeping $LAB" >&2; return 1; }; crewhouse_remove_lab "$LAB"; }
trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

B="http://127.0.0.1:$PORT"
for _ in $(seq 200); do grep -q "crewd listening on $B" "$EV/crewd.log" 2>/dev/null && break; sleep 0.1; done
grep -q "crewd listening on $B" "$EV/crewd.log" || { echo "crewd did not start" >&2; cat "$EV/crewd.log" >&2; exit 1; }
PERSON=$(<"$LAB/state/person.key")
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
for _ in $(seq 100); do curl -fsS --max-time 5 "${H[@]}" "$B/api/state" | grep -q '"person"' && break; sleep 0.1; done

# The journey: a helper with the video-download tool runs it on a link that is not there.
curl -fsS -X POST "${H[@]}" -d '{"address":"Umer"}' "$B/api/onboard" > "$EV/onboard.json"
curl -fsS -X POST "${H[@]}" -d '{"template":"reel","name":"Reel"}' "$B/api/recruit" > "$EV/recruit.json"
curl -fsS -X POST "${H[@]}" -d '{"text":"Reel, cut this into a clip [tool bash {\"command\": \"yt-dlp -f bestvideo+bestaudio https://example.invalid/watch -o clip.mp4\"}]"}' \
  "$B/api/bots/reel/messages" > "$EV/job.json"
TASK=$(/usr/bin/node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).task)' "$EV/job.json")
for _ in $(seq 300); do
  state=$(curl -fsS --max-time 5 "${H[@]}" "$B/api/bots/reel" | /usr/bin/node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);const t=(p.tasks??[]).find(t=>t.id===Number(process.argv[1]));console.log(t?t.state:"?")})' "$TASK")
  [ "$state" = queued ] || [ "$state" = working ] || break
  sleep 0.2
done
echo "task $TASK state $state" | tee "$EV/task-state.txt"
curl -fsS "${H[@]}" "$B/api/task/$TASK/trail" > "$EV/trail.json"
curl -fsS "${H[@]}" "$B/api/bots/reel" > "$EV/helper-page.json"

# The screen the person reads: the helper's "What I did".
# The app takes the person's capability from the launcher's own fragment, once, and keeps it in the tab.
axi() { timeout -k 10 120 chrome-devtools-axi "$@" 2>&1; }
export CHROME_DEVTOOLS_AXI_SESSION=${CHROME_DEVTOOLS_AXI_SESSION:-ch-fix-ytdlp-pin}
pages=$(axi pages || true)
first=$(printf '%s\n' "$pages" | awk -F, 'NR>1 { gsub(/ /, "", $1); if ($1 ~ /^[0-9]+$/) { print $1; exit } }')
if [ -n "$first" ]; then axi selectpage "$first" >/dev/null; else axi newpage about:blank >/dev/null; fi
axi open "$B/#person=$PERSON" >/dev/null
for _ in $(seq 100); do axi eval '!!document.querySelector(".chat-page, .home, .st-profile")' | grep -q true && break; sleep 0.2; done
scripts/verify/screens.sh "$EV/screens" pinned-tool "$B/#/h/reel/did" >/dev/null
ls -la "$EV/screens"

# The look check on the changed screen: 360 wide, the largest text, light and dark.
node scripts/verify/look-check.mjs web --out "$EV/look" --person "$LAB/state/person.key" "pinned-tool=$B/#/h/reel/did" || echo "look-check reported hits (see $EV/look)"
