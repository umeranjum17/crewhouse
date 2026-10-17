#!/usr/bin/env bash
# Start the lane's Crewhouse: the real daemon on the stub engine, with Notion and Canva pointed at a stand-in provider.
set -euo pipefail
LAB=/tmp/ch-pm-21-lab
cd /home/umer/.treehouse/crewhouse-0ec48b/5/crewhouse
freeport() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
PORT=$(freeport); LINK=$(freeport); CALLBACK=$(freeport)
echo "$PORT" > "$LAB/port"; echo "$LINK" > "$LAB/linkport"; echo "$CALLBACK" > "$LAB/callbackport"
env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" CREWHOUSE_LINK_PORT="$LINK" CREWHOUSE_CALLBACK_PORT="$CALLBACK" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$LAB/daemon.ts" > "$LAB/crewd.log" 2>&1 &
echo $! > "$LAB/pid"
for _ in $(seq 1 120); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/state" 2>/dev/null && { echo "crewd up on http://127.0.0.1:$PORT (link $LINK, callback $CALLBACK)"; exit 0; }
  kill -0 "$(cat "$LAB/pid")" 2>/dev/null || { echo "crewd died:"; cat "$LAB/crewd.log"; exit 1; }
  sleep 0.5
done
echo "crewd did not answer"; cat "$LAB/crewd.log"; exit 1
