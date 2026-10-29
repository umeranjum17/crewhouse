# Sourced by the verify drivers that boot a crewd (docs/verification/runbook.md, Launch). crewd and everything it
# starts share one process group of their own (setsid), and the driver's cleanup calls crewd_stop before removing
# $LAB: TERM to the whole group, KILL after a bounded grace, then wait until no member is left. Only an empty group
# lets the lab go; a group that outlives KILL keeps it and fails the run. HUP, INT and TERM exit through cleanup.
CREWD=""
# The driver's own stderr: a trap can run inside a redirected command (`… >/dev/null 2>&1`), so say things here.
exec {crewd_err}>&2
crewd_traps() { trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM; }
crewd_traps
# crewhouse_remove_lab <dir>: only discard a lab after every process that runs in it is gone: crewd's group, then anything
# of ours still holding the lab as cwd, environment or command line (the engine runs detached in a group of its own; a
# driver's Xvfb, film and helper start outside crewd_start). A process that cannot be stopped keeps the lab and ends
# the driver loudly on stderr with a non-zero status, never a silent 0 with a lab left behind.
crewhouse_remove_lab() {
  local lab=$1 was=$? rc=0
  crewd_stop || rc=1
  crewd_sweep "$lab" || rc=1
  [ "$rc" -ne 0 ] || { chmod -R u+w -- "$lab" && rm -rf -- "$lab"; } || rc=1
  [ "$rc" -eq 0 ] || { echo "${0##*/}: FAILED: $lab left behind; a process of this run could not be stopped" >&"$crewd_err"; exit $((was ? was : 70)); }
}
# crewd_lab_pids <dir>: pids of this user's processes that name <dir> in cwd, environ or argv, except this shell, its
# ancestors and the processes of the scan itself (forks of this function carry the driver's environment).
crewd_lab_pids() {
  local lab=$1 me=$BASHPID skip=" $$ $BASHPID " p pp
  pp=$$; while [ "$pp" -gt 1 ]; do pp=$(awk '{ sub(/^.*\) /, ""); print $2 }' "/proc/$pp/stat" 2>/dev/null) || break; skip+="$pp "; done
  { grep -alFl -f - /proc/[0-9]*/cmdline /proc/[0-9]*/environ <<< "$lab"; ls -l /proc/[0-9]*/cwd | while read -r l; do [[ "$l" == *" -> $lab" || "$l" == *" -> $lab/"* ]] && echo "${l#* /proc/}"; done; } 2>/dev/null |
    sed -n 's|^\(/proc/\)\?\([0-9]*\)/.*|\2|p' | sort -u | while read -r p; do
      case "$skip" in *" $p "*) continue;; esac; [ -O "/proc/$p" ] || continue
      for ((pp = p; pp > 1 && pp != me; )); do pp=$(awk '{ sub(/^.*\) /, ""); print $2 }' "/proc/$pp/stat" 2>/dev/null) || break; done
      [ "$pp" = "$me" ] || [ -z "$pp" ] || echo "$p"
    done
}
# crewd_sweep <dir>: TERM, then KILL after a bounded grace, every process crewd_lab_pids finds; non-zero if one outlives KILL.
crewd_sweep() {
  local lab=$1 sig pids
  trap '' HUP INT TERM
  for sig in TERM KILL; do
    pids=$(crewd_lab_pids "$lab"); [ -n "$pids" ] || break
    kill "-$sig" $pids 2>/dev/null || true
    for end in $((SECONDS + 5)); do while [ -n "$(crewd_lab_pids "$lab")" ] && [ "$SECONDS" -le "$end" ]; do sleep 0.05; done; done
  done
  pids=$(crewd_lab_pids "$lab"); crewd_traps
  [ -z "$pids" ] || { echo "${0##*/}: processes ${pids//$'\n'/ } outlived SIGKILL; keeping $lab" >&"$crewd_err"; return 1; }
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
