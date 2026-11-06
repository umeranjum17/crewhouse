#!/usr/bin/env bash
# done-done journey `pi-engine`: the Pi flag, off and on, in the real app.
# Off: the bot list and a bot's chat as they stand, by bot-crew.sh, into <out>/flag-off. On: an isolated crewd with
# CREWHOUSE_ENGINE=pi, where pi-crew.mjs asks two helpers at once through the API the app uses, each on its own real pinned Pi
# through @byokit/pi, on a real model (the free MiniMax M3.1 Flash, the key read from the file into crewd's environment and
# nowhere else). Each saves a code in its own notes, and Chief is never asked; pi-tap.mjs records each model request and its reply.
# crewd then restarts over the same folders with both Pi sessions gone: each recalls its own code from the notes its prompt showed, and
# nothing sent to the model for one holds the other's. Both chats are captured at 390 and 1280, day and night, and in the installed window. A stand-in person's Pi folder in the lab's HOME, the HOME crewd and Pi both start from, is hashed whole before
# and after. The owner's real folder is never read here, so this says nothing about it: that rests on the kit's own isolation test.
#
#   scripts/verify/pi-engine.sh <out-dir> <minimax-key-file>
#
# Needs node scripts/prepare-pi.mjs, /usr/bin/chromium and ImageMagick. Spends six model calls on that key if each helper takes one
# call per step, and never more than PI_CALL_LIMIT (20 unless set): past it the tap answers an error itself and the journey fails.
# PI_ORIGIN points the journey at another OpenAI-compatible provider.
# Writes crew.txt (what was asked, the replies, the processes, the tools), offered.jsonl (the tap's record), pi-folder.txt (the
# hashes), same-shots.txt and the step record.
set -euo pipefail
OUT=${1:?usage: pi-engine.sh <out-dir> <minimax-key-file>}; KEYFILE=${2:?usage: pi-engine.sh <out-dir> <minimax-key-file>}; mkdir -p "$OUT"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
[ -f "$REPO/runtime/byokit/packages/pi/dist/index.js" ] || { echo "pi-engine: run node scripts/prepare-pi.mjs first" >&2; exit 1; }
[ -f "$REPO/web/dist/index.html" ] || (cd "$REPO" && npm run build:web > "$OUT/build-web.log" 2>&1)
LAB=$(mktemp -d -t crewhouse-pi.XXXXXX)
TAP=""
trap '[ -z "$TAP" ] || kill "$TAP"; crewhouse_remove_lab "$LAB"' EXIT
STANDIN="$LAB/home/.pi/agent"
mkdir -p "$STANDIN/extensions" "$LAB"/{state,crew,tools,run}
hashes() { (cd "$LAB/home/.pi" && find . -type f | sort | xargs -r sha256sum); }
printf '{"canary":{"type":"api_key","key":"CANARY"}}' > "$STANDIN/auth.json"
printf '{"defaultModel":"canary-model"}' > "$STANDIN/settings.json"
printf 'throw new Error("CANARY extension loaded");' > "$STANDIN/extensions/canary.ts"
BEFORE=$(hashes)

bash "$REPO/scripts/verify/bot-crew.sh" "$OUT/flag-off"

NODE=$(node -p process.execPath)
PORT=$("$NODE" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
MODEL=${PI_MODEL:-MiniMax-M3.1-Flash}
TAPPORT=$("$NODE" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
: > "$OUT/offered.jsonl"
"$NODE" "$REPO/scripts/verify/pi-tap.mjs" "${PI_ORIGIN:-https://api.minimax.io}" "$TAPPORT" "$OUT/offered.jsonl" "${PI_CALL_LIMIT:-20}" &
TAP=$!
# crewd on Pi, up and answering, its log in $1. The second boot is the restart: same folders, same key, a new process.
PERSON=""
boot() {
  crewd_start "$REPO" "$1" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" KEYFILE="$KEYFILE" \
    XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
    XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
    XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
    CREWHOUSE_ENGINE=pi CREWHOUSE_ENGINE_BASE_URL="http://127.0.0.1:$TAPPORT/v1" CREWHOUSE_ENGINE_MODEL="$MODEL" CREWHOUSE_PORT="$PORT" CREWHOUSE_PI_IDLE_MS=8000 \
    CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
    bash -c 'CREWHOUSE_ENGINE_API_KEY=$(cat "$KEYFILE") exec "$@"' pi-engine "$NODE" "$REPO/src/main.ts"
  local up=""
  for _ in $(seq 240); do
    if [ -f "$LAB/state/person.key" ]; then
      PERSON=$(cat "$LAB/state/person.key")
      curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && { up=1; break; }
    fi
    sleep 0.25
  done
  [ -n "$up" ] || { echo "pi-engine: crewd never became ready" >&2; exit 1; }
}
boot "$OUT/crewd.log"
grep -q '(engine: pi,' "$OUT/crewd.log" || { echo "pi-engine: crewd did not start on Pi" >&2; exit 1; }
api() { curl -fsS --max-time 60 -H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "${@:2}" "$B$1"; }
api /api/onboard -d '{"address":"Umer"}' > /dev/null
# A chat at 390 and 1280, day and night, and in the installed window, once its last words and the head's call button are on the page.
shots() { local THREAD="(async () => { location.hash = '$2'; for (let i = 0; i < 100 && !(document.querySelector('.ph-go') && document.body.innerText.includes($(node -p 'JSON.stringify(process.argv[1].trim().slice(0, 24))' "$3"))); i++) await new Promise((r) => setTimeout(r, 100)); })()"
  node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT/flag-on" "$1" "$THREAD"
  GATE_PWA=1 node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT/flag-on/installed" "$1" "$THREAD"; }
"$NODE" "$REPO/scripts/verify/pi-crew.mjs" "$B" "$LAB" "$CREWD" "$OUT" > /dev/null
crewd_stop
boot "$OUT/crewd-restarted.log"
LAST=$("$NODE" "$REPO/scripts/verify/pi-crew.mjs" "$B" "$LAB" "$CREWD" "$OUT" recall)
SCOUT=$(node -p 'JSON.parse(process.argv[1]).scout' "$LAST"); SCRIBE=$(node -p 'JSON.parse(process.argv[1]).scribe' "$LAST")
shots scout '#/h/scout' "$SCOUT"
shots scribe '#/h/scribe' "$SCRIBE"
crewd_stop
[ "$(hashes)" = "$BEFORE" ] || { echo "pi-engine: the stand-in person's Pi folder changed" >&2; exit 1; }
{ echo "The person's real Pi folder was not checked: the read guard refused it, so this run says nothing about it. That it stays untouched rests on the kit's isolation test."
  echo "A stand-in Pi folder, in the HOME crewd and Pi started from, hashed whole before and after the flag-on run: unchanged, byte for byte."
  printf '%s\n' "$BEFORE"; } > "$OUT/pi-folder.txt"
# The installed window can draw exactly what the browser drew; done-done refuses a byte-identical pair as reuse, so keep one and say which.
find "$OUT" -name '*.png' -type f | sort | xargs sha256sum | awk 'seen[$1] { print $2, seen[$1]; next } { seen[$1] = $2 }' | while read -r twin kept; do
  rm -- "$twin"; echo "${twin#"$OUT/"} was byte for byte ${kept#"$OUT/"}"; done > "$OUT/same-shots.txt"
node "$REPO/scripts/verify/steps.mjs" "$OUT" pi-engine "scout=$SCOUT" "scribe=$SCRIBE" "model=$MODEL" "calls=$(wc -l < "$OUT/offered.jsonl")"
echo "pi-engine: two helpers replied on Pi, each with its own tools, and kept their own notes across a restart; captures in $OUT"
