#!/bin/sh
# Installs Crewhouse with no npm, no git and no sudo: the newest 64-bit Linux download from GitHub, unpacked into your
# own folders (it carries its own Node and AI engine), and a `crewhouse` command beside your other programs.
#   curl -fsSL https://raw.githubusercontent.com/umeranjum17/crewhouse/main/install.sh | sh
# CREWHOUSE_INSTALL_DIR (default ~/.local/share/crewhouse/release) and CREWHOUSE_BIN_DIR (default ~/.local/bin) move it;
# CREWHOUSE_TARBALL=<file or URL> [CREWHOUSE_SHA256=<hex>] installs that download instead of the newest.
# `install.sh --check` only prints the newest version's number (`crewhouse update` asks it).
# In a terminal it carries on and starts Crewhouse; with no terminal, and under `crewhouse update`, it only installs.
set -eu

# The engine's files are read-only, so a folder with one in it is made writable before it goes.
drop() { [ ! -e "$1" ] || { chmod -R u+w "$1"; rm -rf -- "$1"; }; }
die() { printf 'Crewhouse could not be installed: %s\n' "$*" >&2; exit 1; }
# Sign-ins sit under the state folder, and a folder others can write to is refused; a default Ubuntu login's umask makes one.
# New ones are the person's alone whatever the umask, and an open one of theirs is closed and says how to undo that.
private() {
  if [ ! -e "$1" ]; then (umask 077; mkdir -p -- "$1"); return; fi
  [ -d "$1" ] && [ ! -L "$1" ] && [ -O "$1" ] || return 0
  was=$(stat -c %a "$1")
  case $was in *[2367]?|*[2367]) chmod 700 "$1"; echo "Only you can write to $1 now. It was $was; chmod $was $1 puts it back." ;; esac
}

# All in one function, so a download cut off part-way is a syntax error and runs nothing.
main() {
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || die "this download is for 64-bit Linux. On anything else: npm install -g crewhouse"
for tool in curl tar sha256sum mktemp; do command -v "$tool" >/dev/null || die "$tool is missing; install it and run this again."; done

src=${CREWHOUSE_TARBALL:-}; want=${CREWHOUSE_SHA256:-}; latest=
if [ -z "$src" ]; then
  # GitHub lists releases newest first; the cloud-v releases carry the download, with the checksum GitHub computed.
  api=$(curl -fsSL 'https://api.github.com/repos/umeranjum17/crewhouse/releases?per_page=30') || die "could not reach GitHub to find the newest download."
  found=$(printf '%s\n' "$api" | awk '/"name": "crewhouse-linux-x64.tar.gz"/{n=1} n&&/"digest"/{d=$2} n&&!x&&/"browser_download_url"/{print d, $2; x=1}' | tr -d '",')
  want=${found%% *}; src=${found#* }
  [ -n "$src" ] && [ -n "$want" ] || die "GitHub lists no download with a checksum; see https://github.com/umeranjum17/crewhouse/releases"
  latest=${src#*/download/cloud-v}; latest=${latest%%/*}
fi
[ "${1:-}" != --check ] || { echo "$latest"; exit 0; }

dir=${CREWHOUSE_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/crewhouse/release}
bin=${CREWHOUSE_BIN_DIR:-$HOME/.local/bin}
mkdir -p "$(dirname "$dir")" "$bin"
work=$(mktemp -d)
new=$(mktemp -d "$dir.new.XXXXXX")
trap 'drop "$work"; drop "$new"' EXIT

echo "Downloading Crewhouse (about 180 MB)..."
[ -t 2 ] && bar=--progress-bar || bar=-sS
case $src in
  http://*|https://*) curl -fL $bar -o "$work/crewhouse.tar.gz" "$src" || die "the download failed: $src" ;;
  *) cp -- "$src" "$work/crewhouse.tar.gz" || die "cannot read $src" ;;
esac
if [ -n "$want" ]; then
  got=$(sha256sum "$work/crewhouse.tar.gz" | cut -d' ' -f1)
  [ "$got" = "${want#sha256:}" ] || die "the download does not match its published checksum, so nothing was installed."
fi

tar -xzf "$work/crewhouse.tar.gz" -C "$new" --strip-components=1 || die "the download is not a readable archive."
[ -x "$new/node/bin/node" ] && [ -f "$new/app/bin/crewhouse.mjs" ] || die "this download predates the crewhouse command. Use: npm install -g crewhouse"
chmod 755 "$new"
version=$("$new/node/bin/node" -p "require('$new/app/package.json').version")

# Swap in place; the old copy goes only once the new one is in position.
drop "$dir.old"
if [ -e "$dir" ]; then mv "$dir" "$dir.old"; fi
mv "$new" "$dir"
drop "$dir.old"

echo "Crewhouse $version is installed."
# `crewhouse update` runs this in place: the command and the PATH are already set up.
[ -z "${CREWHOUSE_UPDATING:-}" ] || exit 0
printf '#!/bin/sh\nexec "%s/node/bin/node" "%s/app/bin/crewhouse.mjs" "$@"\n' "$dir" "$dir" > "$bin/crewhouse"
chmod 755 "$bin/crewhouse"
state=${XDG_STATE_HOME:-$HOME/.local/state}
private "$state"; private "${CREWHOUSE_STATE_DIR:-$state/crewhouse}"
case ":$PATH:" in *":$bin:"*) ;; *)
  echo "To type crewhouse, open a new terminal, or use the full path: $bin/crewhouse"
  echo "If a new terminal cannot find it: export PATH=\"$bin:\$PATH\"" ;;
esac
# This script's own input is the pipe from curl, so the app is handed the terminal. With no terminal nothing starts by itself.
if [ -t 1 ] && ( : < /dev/tty ) 2>/dev/null; then "$bin/crewhouse" start < /dev/tty
else echo "Start it with: crewhouse start"; fi
}

main "$@"
