#!/usr/bin/env bash
# Verify journey `install-line`: the real one-line install on the real download, on plain Ubuntu logins at the default umask 0002.
# In a real terminal the line must end in the running app; the time printed runs from the line to the app answering.
#
#   scripts/verify/install-line.sh <out-dir> <tarball>      tarball from scripts/package.mjs; needs Docker and the ubuntu:24.04 image
#
# Exit 0 and <out-dir>/install-line.txt when every login said what it should. `curl` reads this checkout's install.sh by file://,
# since the published one is main's; everything after that is the line as a person runs it.
set -uo pipefail

if [ "${1:-}" != --inside ]; then
  [ $# -eq 2 ] && [ -f "$2" ] || { echo "usage: install-line.sh <out-dir> <tarball>" >&2; exit 2; }
  OUT=$(mkdir -p "$1" && cd "$1" && pwd -P); TARBALL=$(realpath "$2"); REPO=$(git rev-parse --show-toplevel)
  docker run --rm --memory 6g --cpus 4 -v "$TARBALL:/mnt/crewhouse.tar.gz:ro" -v "$REPO/install.sh:/mnt/install.sh:ro" -v "$REPO/scripts/verify/install-line.sh:/mnt/journey.sh:ro" ubuntu:24.04 \
    bash -c 'apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates >/dev/null 2>&1
      for who in fresh loose quiet; do useradd -m -s /bin/bash "$who"; su - "$who" -c "bash /mnt/journey.sh --inside $who" || failed=1; done; exit "${failed:-0}"' \
    2>&1 | tee "$OUT/install-line.txt"
  exit "${PIPESTATUS[0]}"
fi

WHO=$2 FAILED=0 LINE='curl -fsSL file:///mnt/install.sh | sh'
export CREWHOUSE_TARBALL=/mnt/crewhouse.tar.gz
bad() { echo "install-line: FAIL ($WHO): $*"; FAILED=1; }
says() { grep -qE -- "$1" <<<"$SAID" || bad "should say /$1/"; }
seconds() { awk "BEGIN { printf \"%.1f\", ($(date +%s%N) - $T0) / 1000000000 }"; }
show() { sed -E '/[█▀▄]/d; s/\r$//; s/(Phone pairing code:).*/\1 <masked>/' <<<"$SAID"; }

printf '\n=== %s login: %s, umask %s\n' "$WHO" "$(id -un)" "$(umask)"
if [ "$WHO" = loose ]; then
  mkdir -p ~/.local/state/other-app; echo theirs > ~/.local/state/other-app/history
  stat -c 'before: %a %n' ~/.local/state
fi

printf '$ %s\n' "$LINE"
T0=$(date +%s%N)
if [ "$WHO" = quiet ]; then
  SAID=$(sh -c "$LINE" 2>&1 </dev/null); RC=$?; show; printf '[exit %s, %s s]\n' "$RC" "$(seconds)"
  [ "$RC" = 0 ] || bad "exit $RC"
  says 'Start it with: crewhouse start'
  AGAIN=$(~/.local/bin/crewhouse status 2>&1); echo "$AGAIN"
  grep -q 'is not running' <<<"$AGAIN" || bad 'no terminal must not start it'
  [ "$FAILED" = 0 ] && echo "install-line ($WHO): only installed, and said how to start"
  exit "$FAILED"
fi
SAID=$(script -qec "$LINE" /dev/null 2>&1); RC=$?; ELAPSED=$(seconds); show
printf '[exit %s, %s s from the line to the app answering]\n' "$RC" "$ELAPSED"
[ "$RC" = 0 ] || bad "exit $RC"
says 'Crewhouse [0-9.]+ is installed'
says 'open a new terminal, or use the full path: .*/\.local/bin/crewhouse'
says 'Crewhouse is running at http://127.0.0.1:[0-9]+/'
grep -q 'Start it with' <<<"$SAID" && bad 'a terminal must not be told to start it'
grep -q '#person=' <<<"$SAID" && bad 'the private link was printed'
if [ "$WHO" = loose ]; then
  says 'Only you can write to .*/\.local/state now\. It was 775; chmod 775 .* puts it back'
  [ "$(cat ~/.local/state/other-app/history)" = theirs ] || bad "another app's file changed"
fi
stat -c '%a %n' ~/.local/state ~/.local/state/crewhouse
[ "$(stat -c %a ~/.local/state)" = 700 ] && [ "$(stat -c %a ~/.local/state/crewhouse)" = 700 ] || bad 'the state folder is not 700'

# The same command in a new login finds what the line started; the shell's own PATH picks it up from ~/.profile.
AGAIN=$(bash -lc 'crewhouse status' 2>&1); echo "new login: $AGAIN"
grep -qE 'is running \(pid [0-9]+\)' <<<"$AGAIN" || bad 'a new login should find crewhouse, running'
~/.local/bin/crewhouse stop
[ "$FAILED" = 0 ] && echo "install-line ($WHO): the line ended in the running app in $ELAPSED s"
exit "$FAILED"
