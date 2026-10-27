#!/usr/bin/env bash
# Verify journey `cli-install`: the install line as a person types it, from a clean state: an empty folder, a throwaway
# HOME, no repo, no systemd, no keyring. Then the six commands: start, status, link, doctor, stop (and a wrong word).
#
#   scripts/verify/cli-install.sh <out-dir> npm                  packs this checkout and `npm install -g`s it into a throwaway prefix
#   scripts/verify/cli-install.sh <out-dir> download <tarball>   runs install.sh on a build of scripts/package.mjs (dist/crewhouse-*-linux-x64.tar.gz)
#   CLI_LAB_ROOT=<dir>  keeps the lab (a real engine install is ~1 GB; /tmp is RAM) there instead of a temp folder
#
# npm mode packs the checkout because the registry's copy has not got these commands until it is published. Exit 0 and
# <out-dir>/cli-install-<mode>.txt (the transcript, every command with its exit code) when every command said what it should.
set -uo pipefail
[ $# -ge 2 ] || { echo "usage: cli-install.sh <out-dir> npm | download <tarball>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P); MODE=$2; TARBALL=${3:-}
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
[ "$MODE" = npm ] || { [ "$MODE" = download ] && [ -f "$TARBALL" ]; } || { echo "cli-install: download needs the tarball's path" >&2; exit 2; }
LAB=$(mktemp -d -p "${CLI_LAB_ROOT:-${TMPDIR:-/tmp}}" crewhouse-cli.XXXXXX); LAB=$(cd "$LAB" && pwd -P)
TX="$OUT/cli-install-$MODE.txt"; : > "$TX"
FAILED=0
cleanup() { [ -z "${PREFIX_BIN:-}" ] || (cd "$LAB/empty" && "${E[@]}" crewhouse stop >/dev/null 2>&1); chmod -R u+w "$LAB" 2>/dev/null; rm -rf -- "$LAB"; }
trap cleanup EXIT
H=$LAB/home; mkdir -p "$H"/{.local/state,.local/share,.config,.cache} "$LAB"/{run,empty}
free() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
NODEBIN=$(dirname "$(node -p process.execPath)")
PREFIX_BIN=$LAB/prefix/bin; [ "$MODE" = npm ] || PREFIX_BIN=$LAB/bin
E=(env -i PATH="$PREFIX_BIN:$NODEBIN:/usr/bin:/bin" LANG=C.UTF-8 HOME="$H" TMPDIR="$LAB" XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus"
   npm_config_cache="$LAB/npm-cache" CREWHOUSE_PORT="$(free)" CREWHOUSE_LINK_PORT="$(free)")

# step <expected exit> <expected words | -> <command…>: runs it in the empty folder and records what it said.
step() {
  local want=$1 words=$2 out rc; shift 2
  printf '\n$ %s\n' "$*" | tee -a "$TX"
  out=$(cd "$LAB/empty" && "${E[@]}" "$@" 2>&1); rc=$?
  printf '%s\n[exit %s]\n' "$out" "$rc" | sed -E 's/\x1b\[[0-9;]*m//g' | tee -a "$TX"
  if [ "$rc" != "$want" ] || { [ "$words" != - ] && ! tr "\n" " " <<<"$out" | grep -qE -- "$words"; }; then
    echo "cli-install: FAIL: '$*' should exit $want and say /$words/" | tee -a "$TX"; FAILED=1
  fi
}

if [ "$MODE" = npm ]; then
  TGZ=$(cd "$REPO" && npm pack --pack-destination "$LAB" 2>/dev/null | tail -1)
  step 0 - npm install -g --no-audit --no-fund --prefix "$LAB/prefix" "$LAB/$TGZ"
else
  step 0 'Crewhouse [0-9.]+ is installed' env CREWHOUSE_TARBALL="$TARBALL" CREWHOUSE_INSTALL_DIR="$LAB/release" CREWHOUSE_BIN_DIR="$LAB/bin" sh "$REPO/install.sh"
fi
step 0 '^Crewhouse [0-9]+\.[0-9]+\.[0-9]+ *$' crewhouse --version
step 0 'crewhouse update' crewhouse help
step 3 'is not running' crewhouse status
step 0 'is not running' crewhouse stop
step 0 'Crewhouse is running at http://127.0.0.1:[0-9]+/.*Phone pairing code' crewhouse start
step 0 'is running \(pid [0-9]+\) at http://127.0.0.1:[0-9]+' crewhouse status
step 0 'engine|crew' crewhouse doctor
step 0 'open this link|not listening for phones' crewhouse link
if [ "$MODE" = download ]; then # update: the same build installed over itself while running; crewd must come back as a new process
  pid() { (cd "$LAB/empty" && "${E[@]}" crewhouse status | sed -n 's/.*(pid \([0-9]*\)).*/\1/p'); }
  P1=$(pid)
  step 0 'is installed.*Crewhouse is running at' env CREWHOUSE_TARBALL="$TARBALL" crewhouse update
  P2=$(pid)
  step 0 'is running' crewhouse status
  [ -n "$P2" ] && [ "$P1" != "$P2" ] || { echo "cli-install: FAIL: update left crewd as pid '$P1' -> '$P2'" | tee -a "$TX"; FAILED=1; }
fi
step 0 'Crewhouse stopped' crewhouse stop
step 3 'is not running' crewhouse status
step 2 'Unknown command: bogus' crewhouse bogus
[ "$FAILED" = 0 ] && echo "cli-install ($MODE): every command said what it should" | tee -a "$TX"
exit "$FAILED"
