#!/usr/bin/env bash
# Does a bot's desktop refuse to start, at start, when the engine cannot load a system library?
#
#   run.sh <out-dir> <label>
#
# Two scenarios against the real product (crewd on the stub engine, throwaway HOME/XDG/TMPDIR):
#   broken   DESKLINK_ENGINE is a task-private command that prints the native loader's
#            "error while loading shared libraries: libevdev.so.2" line and exits 127 — the
#            desktop must refuse with that library named and the install hint.
#   healthy  the real prebuilt engine — the same journey must open the screen.
# Each writes <label>-<scenario>.txt (the reply crewd sent to the app's own desktop socket)
# and <label>-<scenario>.log (the crewd log).
#
# Nothing here touches the host: no library is removed, no owner state is read, no engine changed.
set -uo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
OUT=${1:?usage: run.sh <out-dir> <label>}; LABEL=${2:?usage: run.sh <out-dir> <label>}
mkdir -p "$OUT"
LIB=libevdev.so.2
LAB=$(mktemp -d "${TMPDIR:-/tmp}/crewhouse-deskstart.XXXXXX")
cleanup() { [ -n "${PID:-}" ] && kill -TERM "$PID" 2>/dev/null; [ -n "${PID:-}" ] && wait "$PID" 2>/dev/null; rm -rf "$LAB"; }
trap cleanup EXIT

# The native loader's own words, from a one-line command: no engine and no library is touched.
BROKEN="$LAB/engine-broken"
cat > "$BROKEN" <<EOF
#!/bin/sh
echo 'error while loading shared libraries: $LIB: cannot open shared object file: No such file or directory' >&2
exit 127
EOF
chmod +x "$BROKEN"

run() { # run <scenario> <engine|-> ; '-' means let crewd resolve the real prebuilt engine
  local what=$1 engine=$2 log="$OUT/$LABEL-$1.log" step="$LAB/step-$1" port
  rm -rf "$step"; mkdir -p "$step/home" "$step/state" "$step/crew" "$step/tools"
  port=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
  env -i PATH="$PATH" LANG=C.UTF-8 HOME="$step/home" TMPDIR="$step" \
    XDG_STATE_HOME="$step/home/.local/state" XDG_DATA_HOME="$step/home/.local/share" \
    XDG_CONFIG_HOME="$step/home/.config" XDG_CACHE_HOME="$step/home/.cache" \
    XDG_RUNTIME_DIR="$step/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$step/no-bus" \
    CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$port" CREWHOUSE_LINK_PORT=0 \
    CREWHOUSE_STATE_DIR="$step/state" CREWHOUSE_CREW_DIR="$step/crew" CREWHOUSE_TOOLS_DIR="$step/tools" \
    ${engine:+DESKLINK_ENGINE="$engine"} \
    node "$REPO/src/main.ts" > "$log" 2>&1 &
  PID=$!
  local B="http://127.0.0.1:$port" i key="$step/state/person.key"
  for i in $(seq 1 120); do [ -f "$key" ] && curl -fsS -H x-crewhouse:1 -H "Authorization: Bearer $(<"$key")" "$B/api/state" >/dev/null 2>&1 && break; sleep 0.25; done
  local PERSON; PERSON=$(<"$key")
  local H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
  curl -fsS -X POST "${H[@]}" -d '{"address":"Umer"}' "$B/api/onboard" >/dev/null
  # A helper that has the Computer tool: the person asks Chief, the stub crew runs the tool call.
  curl -fsS -X POST "${H[@]}" -d '{"text":"[tool crew_recruit {\"template\":\"scout\",\"name\":\"Scout\"}]"}' "$B/api/bots/chief/messages" >/dev/null
  for i in $(seq 1 80); do curl -fsS "${H[@]}" "$B/api/state" | grep -q '"id":"scout"' && break; sleep 0.25; done
  {
    echo "--- engine: ${engine:-resolved by crewd}; startup readiness: $(curl -fsS "${H[@]}" "$B/api/state" | grep -o '"desktops":{"ready":[a-z]*}')"
    echo "--- opening Scout's desktop through the app's own socket (session.open)"
    node "$REPO/data/evidence/ch-desktop-start-readiness/desk-open.mjs" "$B" "$PERSON" scout 2>&1
    echo "(exit $?: crewd's reply to the app is above)"
  } > "$OUT/$LABEL-$1.txt"
  kill -TERM "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; unset PID
}

run broken "$BROKEN"
run healthy ""
