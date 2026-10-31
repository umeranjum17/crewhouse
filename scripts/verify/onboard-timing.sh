#!/usr/bin/env bash
# One onboarding recipe, timed from install start to Chief's first useful answer (docs/verification/onboard-timing.md).
#   SERIAL=<emulator> bash scripts/verify/onboard-timing.sh phone|computer|cloud <out-dir> <release APK>
# phone: the emulator alone. computer: also brings up a real crewd (the real engine, MiniMax key signed in, its own relay) in a
# scratch HOME, times that start, and the phone pairs to it by the relay code. cloud: see onboard-timing.mjs (--boat-sock).
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: SERIAL=<emulator> onboard-timing.sh phone|computer|cloud <out-dir> <apk>" >&2; exit 2; }
RECIPE=$1; OUT=$(mkdir -p "$2" && cd "$2" && pwd -P); APK=$3; : "${SERIAL:?set SERIAL to the emulator}"
REPO=$(git rev-parse --show-toplevel); . "$REPO/scripts/verify/crewd-group.sh"
KEY_FILE=${CHAT_KEY_FILE:-$HOME/firstmate/config/minimax-api-key}; MODEL=${CHAT_MODEL:-MiniMax-M3.1-Flash}
NODE_BIN=${NODE_BIN:-$(dirname "$(readlink -f "$(command -v node)")")}; export PATH="$NODE_BIN:/usr/bin:/bin:$HOME/Android/Sdk/platform-tools"
EXTRA=()
if [ "$RECIPE" = computer ]; then
  LAB=$(mktemp -d -p "${LAB_ROOT:-$HOME/lab-tmp}" crewhouse-onboard-timing.XXXXXX); RELAY_PID=""
  cleanup() {
    crewd_stop || true
    [ -z "$RELAY_PID" ] || kill -TERM "$RELAY_PID" 2>/dev/null || true
    adb -s "$SERIAL" reverse --remove tcp:"${RPORT:-0}" >/dev/null 2>&1 || true
    crewhouse_remove_lab "$LAB"
  }
  trap cleanup EXIT
  mkdir -p "$LAB"/{home,state,crew,tools,run,relay,tmp,engine}
  free() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
  PORT=$(free); LINK_PORT=$(free); RPORT=$(free); RELAY="http://127.0.0.1:$RPORT"
  mask() { exec env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB/tmp" XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
    XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_RUN_MODE=test "$@"; }
  (cd "$REPO" && mask PORT="$RPORT" HOST=127.0.0.1 RELAY_DATA="$LAB/relay" RELAY_SIGNUP=open node relay/main.ts > "$LAB/relay.log" 2>&1) & RELAY_PID=$!
  for _ in $(seq 300); do curl -fsS --max-time 5 "$RELAY/health" >/dev/null 2>&1 && break; sleep 0.2; done
  adb -s "$SERIAL" reverse tcp:"$RPORT" tcp:"$RPORT" >/dev/null
  START=$SECONDS
  crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB/tmp" XDG_STATE_HOME="$LAB/home/.local/state" \
    XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" XDG_RUNTIME_DIR="$LAB/run" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_RUN_MODE=test CREWHOUSE_PORT="$PORT" CREWHOUSE_LINK_PORT="$LINK_PORT" CREWHOUSE_LINK_HOST=127.0.0.1 \
    CREWHOUSE_RELAY="$RELAY" CREWHOUSE_RELAY_PUBLIC="$RELAY" CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
    CREWHOUSE_ENGINE_DIR="$LAB/engine" node "$REPO/src/main.ts"
  PERSON=""
  for _ in $(seq 6000); do
    if [ -f "$LAB/state/person.key" ]; then PERSON=$(cat "$LAB/state/person.key")
      curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "http://127.0.0.1:$PORT/api/state" 2>/dev/null | grep -q '"phase":"ready"' && break; fi
    sleep 0.25
  done
  [ -n "$PERSON" ] || { echo "onboard-timing: the computer never became ready" >&2; tail -20 "$OUT/crewd.log" >&2; exit 1; }
  READY=$((SECONDS - START))
  H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON"); B="http://127.0.0.1:$PORT"
  curl -fsS "${H[@]}" -X POST "$B/api/accounts/1/minimax/login" -d '{"via":"key"}' >/dev/null
  node -e 'process.stdout.write(JSON.stringify({ text: require("node:fs").readFileSync(process.argv[1], "utf8").trim() }))' "$KEY_FILE" |
    curl -fsS "${H[@]}" -X POST --data-binary @- "$B/api/accounts/1/minimax/paste" >/dev/null
  for _ in $(seq 240); do curl -fsS "${H[@]}" "$B/api/accounts" | grep -Eq '"account":"minimax",[^}]*"signedIn":true' && break; sleep 0.5; done
  SIGNED=$((SECONDS - START))
  node -e 'const f=process.argv[1],c=JSON.parse(require("node:fs").readFileSync(f,"utf8"));c.models=["minimax:"+process.argv[2]];require("node:fs").writeFileSync(f,JSON.stringify(c,null,2))' "$LAB/crew/bots/chief/bot.json" "$MODEL"
  printf '{"computerReadySeconds":%s,"computerSignedInSeconds":%s,"engine":"installed fresh into an empty engine dir by this start"}\n' "$READY" "$SIGNED" > "$OUT/host-computer.json"
  EXTRA=(--base "$B" --state "$LAB/state")
fi
node "$REPO/scripts/verify/onboard-timing.mjs" --recipe "$RECIPE" --serial "$SERIAL" --apk "$APK" --out "$OUT" "${EXTRA[@]}" "${@:4}"
