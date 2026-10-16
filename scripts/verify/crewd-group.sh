# Sourced by the verify drivers that boot a crewd (docs/verification/runbook.md, Launch). crewd and everything it
# starts share one process group of their own (setsid), and the driver's cleanup calls crewd_stop before removing
# $LAB: TERM to the whole group, KILL after a bounded grace, then wait until no member is left. Only an empty group
# lets the lab go; a group that outlives KILL keeps it and fails the run. HUP, INT and TERM exit through cleanup.
CREWD=""
crewd_traps() { trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM; }
crewd_traps
# crewd_start <dir> <log> <command…>: the command, run in <dir>, leads a fresh group and dies with this shell
# (setpriv's parent-death signal). No job control, so setsid never forks and $! is crewd; CREWD is set once the
# group exists, and a signal meanwhile waits for that, so cleanup still drains it.
crewd_start() {
  local sig="" rc=0
  trap 'sig=129' HUP; trap 'sig=130' INT; trap 'sig=143' TERM
  ( cd "$1" && exec setsid setpriv --pdeathsig KILL -- "${@:3}" ) > "$2" 2>&1 &
  crewd_group $! || rc=$?
  crewd_traps; [ -z "$sig" ] || exit "$sig"; return "$rc"
}
crewd_group() {
  for _ in $(seq 100); do kill -0 -- "-$1" 2>/dev/null && { CREWD=$1; return 0; }; sleep 0.05; done
  echo "${0##*/}: crewd's own process group never appeared" >&2; return 1
}
crewd_gone() { ! kill -0 -- "-$CREWD" 2>/dev/null; }
crewd_drain() { kill "-$1" -- "-$CREWD" 2>/dev/null || true; for _ in $(seq 100); do crewd_gone && return 0; sleep 0.05; done; crewd_gone; }
# crewd_stop: empty crewd's group (nothing to do once it is); non-zero, keeping $LAB, when a member outlives KILL.
crewd_stop() {
  [ -n "$CREWD" ] || return 0
  trap '' HUP INT TERM
  if ! crewd_drain TERM; then
    echo "${0##*/}: crewd's process group $CREWD outlived SIGTERM; sending SIGKILL" >&2
    crewd_drain KILL || { echo "${0##*/}: crewd's process group $CREWD outlived SIGKILL; keeping $LAB" >&2; return 1; }
  fi
  CREWD=""; crewd_traps
}
