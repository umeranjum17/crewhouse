# Sourced by the verify drivers that boot a crewd (docs/verification/runbook.md, Launch). crewd and everything it
# starts share one process group of their own (setsid), and the driver's cleanup calls crewd_stop before removing
# $LAB: TERM to the whole group, KILL after a bounded grace, then wait until no member is left. Only an empty group
# lets the lab go; a group that outlives KILL keeps it and fails the run. HUP, INT and TERM exit through cleanup.
CREWD=""
# The driver's own stderr: a trap can run inside a redirected command (`… >/dev/null 2>&1`), so say things here.
exec {crewd_err}>&2
crewd_traps() { trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM; }
crewd_traps
# crewhouse_remove_lab <dir>: only discard a lab after every owned process group is empty.
crewhouse_remove_lab() {
  local lab=$1
  crewd_stop || return 1
  chmod -R u+w -- "$lab" && rm -rf -- "$lab"
}
# crewd_start <dir> <log> <command…>: the command, run in <dir>, leads a fresh group and dies with this shell
# (setpriv's parent-death signal). The group record lets a later shell stop it by lab directory alone.
crewd_start() {
  local sig="" rc=0 lab="" arg
  for arg in "${@:3}"; do case "$arg" in TMPDIR=*) lab=${arg#TMPDIR=}; break;; esac; done
  if [ -z "$lab" ]; then for arg in "${@:3}"; do case "$arg" in HOME=*) lab=${arg#HOME=}; lab=${lab%/home}; break;; esac; done; fi
  case "$lab" in */tmp) lab=${lab%/tmp};; esac
  [ -n "$lab" ] && [ -d "$lab" ] || { echo "${0##*/}: crewd_start needs a TMPDIR or HOME under its lab" >&"$crewd_err"; return 2; }
  trap 'sig=129' HUP; trap 'sig=130' INT; trap 'sig=143' TERM
  ( cd "$1" && exec setsid setpriv --pdeathsig KILL -- "${@:3}" ) > "$2" 2>&1 &
  crewd_group "$!" || rc=$?
  if [ "$rc" -eq 0 ]; then printf '%s\n' "$CREWD" > "$lab/.crewd-group.tmp" && mv -- "$lab/.crewd-group.tmp" "$lab/.crewd-group"; fi
  crewd_traps; [ -z "$sig" ] || exit "$sig"; return "$rc"
}
crewd_group() {
  for _ in $(seq 100); do kill -0 -- "-$1" 2>/dev/null && { CREWD=$1; return 0; }; sleep 0.05; done
  echo "${0##*/}: crewd's own process group never appeared" >&"$crewd_err"; return 1
}
crewd_gone() { ! kill -0 -- "-$CREWD" 2>/dev/null; }
crewd_drain() { kill "-$1" -- "-$CREWD" 2>/dev/null || true; for _ in $(seq 100); do crewd_gone && return 0; sleep 0.05; done; crewd_gone; }
# crewd_stop: empty crewd's group (nothing to do once it is); non-zero, keeping $LAB, when a member outlives KILL.
crewd_stop() {
  [ -n "$CREWD" ] || return 0
  trap '' HUP INT TERM
  if ! crewd_drain TERM; then
    echo "${0##*/}: crewd's process group $CREWD outlived SIGTERM; sending SIGKILL" >&"$crewd_err"
    crewd_drain KILL || { echo "${0##*/}: crewd's process group $CREWD outlived SIGKILL; keeping $LAB" >&"$crewd_err"; return 1; }
  fi
  CREWD=""; crewd_traps
}
# crewd_stop_lab <dir>: stop only the process group recorded in the specified lab.
crewd_stop_lab() {
  local lab=$1 pgid
  [ -f "$lab/.crewd-group" ] || return 0
  IFS= read -r pgid < "$lab/.crewd-group" || return 1
  [[ "$pgid" =~ ^[1-9][0-9]*$ ]] || { echo "${0##*/}: invalid crewd group record in $lab" >&"$crewd_err"; return 1; }
  CREWD=$pgid
  crewd_stop || return 1
  rm -f -- "$lab/.crewd-group"
}
