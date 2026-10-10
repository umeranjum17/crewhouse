#!/usr/bin/env bash
# The pairing lab (features/pwa-pair.md): an isolated crewd on the stub engine (its own HOME, every XDG dir, TMPDIR),
# the repo's own relay (relay/main.ts, open signup) that crewd dials, and the built web shell served from a public-style
# origin (http://crewhouse.localhost:<port>/, scripts/serve-web.mjs). Never the owner's HOME.
#   pair-lab.sh up <repo>    start all three; writes $LAB/env (PORT, LINK_PORT, RELAY, WEB, B)
#   pair-lab.sh cli <args>   the computer's own ./crewhouse against the lab crewd (e.g. `phones code`, `phones approve …`)
#   pair-lab.sh down         stop what this script started
set -euo pipefail
LAB=${LAB:?set LAB to a scratch folder}
free() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
mask() { env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB/tmp" XDG_STATE_HOME="$LAB/home/.local/state" \
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" "$@"; }
wait_for() { for _ in $(seq 300); do if eval "$1" >/dev/null 2>&1; then return 0; fi; sleep 0.2; done; echo "timed out: $1" >&2; return 1; }
case "${1:-}" in
  up)
    REPO=$(cd "${2:?repo}" && pwd)
    rm -rf "$LAB"; mkdir -p "$LAB"/{home,tmp,run,state,crew,tools,relay}
    PORT=$(free); LINK_PORT=$(free); RPORT=$(free)
    (cd "$REPO" && mask PORT="$RPORT" HOST=127.0.0.1 RELAY_DATA="$LAB/relay" RELAY_SIGNUP=open node relay/main.ts >"$LAB/relay.log" 2>&1 & echo $! >"$LAB/relay.pid")
    wait_for "curl -fsS http://127.0.0.1:$RPORT/health"
    (cd "$REPO" && mask CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" CREWHOUSE_LINK_PORT="$LINK_PORT" CREWHOUSE_LINK_HOST=127.0.0.1 \
      CREWHOUSE_RELAY="http://127.0.0.1:$RPORT" CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
      node src/main.ts >"$LAB/crewd.log" 2>&1 & echo $! >"$LAB/crewd.pid")
    wait_for "curl -fsS http://127.0.0.1:$PORT/api/state | grep -q person"
    (cd "$REPO" && node .agents/skills/verify-crewhouse/scripts/serve-web.mjs web/dist >"$LAB/web.log" 2>&1 & echo $! >"$LAB/web.pid")
    wait_for "grep -q serving $LAB/web.log"
    WEB=$(grep -o 'http://[^ ]*' "$LAB/web.log")
    printf 'LAB=%s\nPORT=%s\nLINK_PORT=%s\nRELAY=http://127.0.0.1:%s\nWEB=%s\nB=http://127.0.0.1:%s\nREPO=%s\n' "$LAB" "$PORT" "$LINK_PORT" "$RPORT" "$WEB" "$PORT" "$REPO" >"$LAB/env"
    cat "$LAB/env"
    ;;
  cli)
    shift; . "$LAB/env"
    cd "$REPO" && mask PATH="$(dirname "$(readlink -f "$(command -v node)")"):/usr/bin:/bin" CREWHOUSE_PORT="$PORT" CREWHOUSE_STATE_DIR="$LAB/state" \
      CREWHOUSE_CREW_DIR="$LAB/crew" ./crewhouse "$@"
    ;;
  down)
    for p in web crewd relay; do [ -f "$LAB/$p.pid" ] && kill -TERM "$(cat "$LAB/$p.pid")" 2>/dev/null || true; done
    ;;
  *) echo 'usage: pair-lab.sh up <repo> | cli <args> | down' >&2; exit 2 ;;
esac
