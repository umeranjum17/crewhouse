#!/usr/bin/env bash
# Real-engine proof for ch-signin-fallback-name. Runs under fm-cred-lock.sh (holds
# /home/umer/lab-tmp/claude-test-cred/run.lock for the whole engine lifetime).
# Starts crewd from the task worktree on the REAL engine with a fresh HOME holding
# ONLY the shared Claude test credential (symlinked, never copied), waits for the
# driver (another shell) to drop $LAB/release, then stops cleanly.
set -euo pipefail
WORKTREE=/home/umer/.treehouse/crewhouse-0ec48b/3/crewhouse
LAB=${PROOF_LAB:-/tmp/ch-signin-proof}
EV=/home/umer/.treehouse/firstmate-8bf1b0/3/firstmate/data/evidence/ch-signin-fallback-name
PORT=${PROOF_PORT:-7761}
rm -rf "$LAB"
mkdir -p "$LAB/home/.claude" "$LAB/state" "$LAB/crew" "$LAB/tools" "$EV"
# Never probe the credential with the CLI here: a concurrent `claude` refresh race signs the engine run out.
ln -sfn /home/umer/lab-tmp/claude-test-cred/home/.claude/.credentials.json "$LAB/home/.claude/.credentials.json"
cd "$WORKTREE"
env -i PATH=/home/umer/.local/bin:/usr/bin:/bin LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  CREWHOUSE_PORT="$PORT" MISE_OFFLINE=1 \
  /usr/bin/node src/main.ts > "$EV/crewd-real.log" 2>&1 &
echo $! > "$LAB/crewd.pid"
for _ in $(seq 1 120); do
  if /usr/bin/curl -fs -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
    echo "up: http://127.0.0.1:$PORT pid $(cat "$LAB/crewd.pid")"
    echo "$PORT" > "$LAB/port"
    # The engine reads Claude's credential from its own sealed home, not crewd's HOME.
    mkdir -p "$LAB/state/openclaw/home/.claude"
    ln -sfn /home/umer/lab-tmp/claude-test-cred/home/.claude/.credentials.json "$LAB/state/openclaw/home/.claude/.credentials.json"
    break
  fi
  kill -0 "$(cat "$LAB/crewd.pid")" 2>/dev/null || { echo "crewd died; see $EV/crewd-real.log"; tail -30 "$EV/crewd-real.log"; exit 1; }
  sleep 0.5
done
# Hold the credential lock until the driver releases us (bounded).
for _ in $(seq 1 360); do
  [ -f "$LAB/release" ] && break
  kill -0 "$(cat "$LAB/crewd.pid")" 2>/dev/null || { echo "crewd died mid-proof"; tail -20 "$EV/crewd-real.log"; exit 1; }
  sleep 5
done
kill -TERM "$(cat "$LAB/crewd.pid")" 2>/dev/null || true
for _ in $(seq 1 60); do kill -0 "$(cat "$LAB/crewd.pid")" 2>/dev/null || break; sleep 1; done
echo "stopped"
