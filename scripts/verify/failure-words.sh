#!/usr/bin/env bash
# Verify journey `failure-words`: the real download on a plain Ubuntu login (default umask, no browser, no Tailscale), broken
# the ways a person's machine breaks. Every failure must say its cause and one next line within seconds, with no stack trace
# and no private link, and the printed line itself must get past the group-writable ~/.local a default login has.
#
#   scripts/verify/failure-words.sh <out-dir> <tarball>     tarball from scripts/package.mjs; needs Docker and the ubuntu:24.04 image
#
# Exit 0 and <out-dir>/failure-words.txt (every command, its words, exit code and milliseconds) when each said what it should.
# When BYOKit's fix for that ~/.local lands (pick 0), the first start succeeds: the three steps marked below go with why.mjs's line.
set -uo pipefail

if [ "${1:-}" != --inside ]; then
  [ $# -eq 2 ] && [ -f "$2" ] || { echo "usage: failure-words.sh <out-dir> <tarball>" >&2; exit 2; }
  OUT=$(mkdir -p "$1" && cd "$1" && pwd -P); TARBALL=$(realpath "$2"); REPO=$(git rev-parse --show-toplevel)
  docker run --rm --memory 6g --cpus 4 -v "$TARBALL:/mnt/crewhouse.tar.gz:ro" -v "$REPO/install.sh:/mnt/install.sh:ro" -v "$REPO/scripts/verify/failure-words.sh:/mnt/journey.sh:ro" ubuntu:24.04 \
    bash -c 'apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates >/dev/null 2>&1; useradd -m -s /bin/bash me; su - me -c "bash /mnt/journey.sh --inside"' \
    2>&1 | tee "$OUT/failure-words.txt"
  exit "${PIPESTATUS[0]}"
fi

FAILED=0 SAID=
# step <expected exit> <words> <longest ms> <command…>: an exit, words and a time limit it must meet, and nothing a person must not see.
step() {
  local want=$1 words=$2 limit=$3 rc t0 ms; shift 3
  printf '\n$ %s\n' "$*"
  t0=$(date +%s%N); SAID=$("$@" 2>&1); rc=$?; ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  printf '%s\n[exit %s, %s ms]\n' "$SAID" "$rc" "$ms" | sed -E '/[█▀▄]/d; s/(Phone pairing code:).*/\1 <masked>/'
  if [ "$rc" != "$want" ] || [ "$ms" -gt "$limit" ] || ! tr '\n' ' ' <<<"$SAID" | grep -qE -- "$words"; then
    echo "failure-words: FAIL: '$*' should exit $want within $limit ms and say /$words/"; FAILED=1
  fi
  if grep -qE '^\s+at .+[:(]|Node\.js v[0-9]|#person=' <<<"$SAID"; then echo "failure-words: FAIL: '$*' showed a stack trace or the private link"; FAILED=1; fi
}

echo "login: $(id -un), umask $(umask)"
step 0 'Crewhouse [0-9.]+ is installed' 120000 env CREWHOUSE_TARBALL=/mnt/crewhouse.tar.gz sh /mnt/install.sh
export PATH="$HOME/.local/bin:$PATH"   # the line install.sh prints
stat -c '%a %n' ~/.local

# A default Ubuntu login: ~/.local is group-writable. (These three steps go when pick 0 lands; see the header.)
step 1 'Engine: A folder your sign-ins would sit under' 10000 crewhouse doctor
step 1 'did not start: A folder your sign-ins would sit under .* Next: ' 10000 crewhouse start
NEXT=$(sed -n 's/^Next: //p' <<<"$SAID")
step 0 'Crewhouse is running at http://127.0.0.1:[0-9]+/' 60000 sh -c "$NEXT"

step 0 'is running \(pid [0-9]+\)' 5000 crewhouse status
step 0 'in your browser' 5000 crewhouse open   # no browser here: the address, never the private link
step 0 'Crewhouse stopped' 10000 crewhouse stop
step 1 'is not running\. Start it with crewhouse start' 5000 crewhouse open

NODE=$HOME/.local/share/crewhouse/release/node/bin/node
"$NODE" -e 'require("node:net").createServer().listen(7711,"127.0.0.1",()=>console.log("port 7711 held"))' &
HOLDER=$!
for _ in $(seq 100); do (: < /dev/tcp/127.0.0.1/7711) 2>/dev/null && break; sleep 0.1; done
step 1 'Another program is already using port 7711.* Next: close that program' 10000 crewhouse start
kill "$HOLDER"; wait "$HOLDER" 2>/dev/null

# A first start under a folder it may not write to. (A data folder already in place keeps working: its files are still writable.)
mv ~/.local/state/crewhouse ~/.local/state.kept; chmod 555 ~/.local/state
step 1 'not allowed to write to .*/\.local/state.* Next: give that folder back' 10000 crewhouse start
chmod 755 ~/.local/state; mv ~/.local/state.kept ~/.local/state/crewhouse

step 1 'Tailscale is not installed, and a phone needs a way to reach it.* Next: run CREWHOUSE_RELAY_PUBLIC=.* or install Tailscale' 5000 crewhouse setup --headless --install-only

step 0 'Crewhouse is running at' 60000 crewhouse start
step 0 'Crewhouse stopped' 10000 crewhouse stop
[ "$FAILED" = 0 ] && echo "failure-words: every failure said its cause and one next line"
exit "$FAILED"
