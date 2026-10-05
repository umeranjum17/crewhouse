#!/usr/bin/env bash
# Start PR 304's crewd (this worktree's code) on the ONE retained test home's state.
# The home itself stays stopped; only its state/crew/tools dirs are borrowed, so the
# sealed ChatGPT sign-in survives (SIGN-IN.md: never copy this folder).
set -euo pipefail
R=/home/umer/lab-tmp/crewhouse-retained
W="$(cd "$(dirname "$0")/../../.." && pwd -P)"   # this worktree
EV=/home/umer/.treehouse/firstmate-8bf1b0/3/firstmate/evidence/ch-pm-21-live
mkdir -p "$EV"
for p in "$R/run/crewd.pid" "$R/run/state/crewd.pid"; do
  [ -f "$p" ] && kill -0 "$(cat "$p")" 2>/dev/null && { echo "a crewd already owns the retained home's state (pid $(cat "$p")); stop it first" >&2; exit 1; }
done

cd "$W"
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME="$R/home" \
  XDG_CONFIG_HOME="$R/home/.config" XDG_CACHE_HOME="$R/home/.cache" \
  XDG_DATA_HOME="$R/home/.local/share" XDG_STATE_HOME="$R/home/.local/state" \
  npm_config_cache="$R/home/.cache/npm" \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent/lab-no-bus XDG_RUNTIME_DIR="$R/home/.run" \
  CREWHOUSE_STATE_DIR="$R/run/state" CREWHOUSE_CREW_DIR="$R/run/crew" CREWHOUSE_TOOLS_DIR="$R/run/tools" \
  CREWHOUSE_PORT=7751 CREWHOUSE_LINK_PORT=7752 MISE_OFFLINE=1 \
  node src/main.ts >>"$EV/crewd.log" 2>&1 &
echo $! > /tmp/ch-pm-21-live.pid

for _ in $(seq 1 120); do
  if curl -fs -o /dev/null "http://127.0.0.1:7751/api/state" 2>/dev/null; then echo "up (pid $(cat /tmp/ch-pm-21-live.pid))"; exit 0; fi
  kill -0 "$(cat /tmp/ch-pm-21-live.pid)" 2>/dev/null || { echo "crewd died; see $EV/crewd.log" >&2; exit 1; }
  sleep 0.5
done
echo "did not answer in 60s; see $EV/crewd.log" >&2; exit 1
