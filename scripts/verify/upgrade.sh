#!/usr/bin/env bash
# done-done journey `upgrade`: the release path a person takes — the previous shipped version, installed, then
# upgraded over in place, and the core journey driven on the upgraded app.
#
#   scripts/verify/upgrade.sh <out-dir>
#
# The previous shipped version is the one before this checkout's on npm (the app ships as an npm package with a
# bin). It is installed into a throwaway prefix, then this checkout's own build is packed and installed over it in
# the same prefix, exactly as a person upgrades. The upgraded app (its own daemon and its own web app, both from
# the installed package) then runs the core journey: pair the PWA, say hello, read Chief's real answer.
#
# The key is read from the environment by name only: never printed, logged, copied or kept. The model is the
# account's own (OpenRouter's free MiniMax M3.1 Flash). Spends a few model calls on that key.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: upgrade.sh <out-dir>   (CHAT_ACCOUNT, CHAT_KEY_FILE, CHAT_MODEL)" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
LAB=$(mktemp -d -t crewhouse-upgrade.XXXXXX)
cleanup() { chmod -R u+w "$LAB" 2>/dev/null || true; rm -rf "$LAB"; }
trap cleanup EXIT
CURRENT=$(node -e 'console.log(require(process.argv[1] + "/package.json").version)' "$REPO")
# The version before this one on npm: what a person has installed today.
PREVIOUS=$(npm view crewhouse versions --json 2>/dev/null | node -e '
let s = ""; process.stdin.on("data", (d) => s += d).on("end", () => {
  const all = JSON.parse(s || "[]").filter((v) => v !== process.argv[1]);
  if (!all.length) { console.error("no published version to upgrade from"); process.exit(1); }
  console.log(all[all.length - 1]);
});' "$CURRENT")
PREFIX="$LAB/prefix"
echo "upgrade: $PREVIOUS is published, this checkout is $CURRENT"

# --- the previous shipped version, installed as a person installs it ---
npm i --prefix "$PREFIX" --no-audit --no-fund --ignore-scripts "crewhouse@$PREVIOUS" > "$OUT/npm-previous.log" 2>&1 || {
  echo "upgrade: the published version did not install" >&2; tail -5 "$OUT/npm-previous.log" >&2; exit 1; }
BEFORE=$(node -e 'console.log(require(process.argv[1] + "/package.json").version)' "$PREFIX/node_modules/crewhouse")
[ "$BEFORE" = "$PREVIOUS" ] || { echo "upgrade: the installed version is $BEFORE, not $PREVIOUS" >&2; exit 1; }
echo "upgrade: installed $BEFORE"

# --- this checkout, packed as it is published, installed over it in place ---
npm pack --pack-destination "$LAB" > "$OUT/npm-pack.log" 2>&1 || { echo "upgrade: the pack failed" >&2; tail -5 "$OUT/npm-pack.log" >&2; exit 1; }
TARBALL=$(ls "$LAB"/crewhouse-*.tgz | head -1)
npm i --prefix "$PREFIX" --no-audit --no-fund --ignore-scripts "$TARBALL" > "$OUT/npm-upgrade.log" 2>&1 || {
  echo "upgrade: the upgrade did not install" >&2; tail -5 "$OUT/npm-upgrade.log" >&2; exit 1; }
AFTER=$(node -e 'console.log(require(process.argv[1] + "/package.json").version)' "$PREFIX/node_modules/crewhouse")
[ "$AFTER" = "$CURRENT" ] || { echo "upgrade: the installed version is $AFTER, not $CURRENT" >&2; exit 1; }
printf 'the previous shipped version: %s\nupgraded in place to: %s\ninstalled at: %s\n' "$BEFORE" "$AFTER" "$PREFIX/node_modules/crewhouse" > "$OUT/upgrade.txt"
echo "upgrade: $BEFORE upgraded in place to $AFTER"

# --- the core journey, on the upgraded app ---
APP_DIR="$PREFIX/node_modules/crewhouse" bash "$REPO/scripts/verify/pair-chat.sh" "$OUT/core"
cp "$OUT/core/steps.json" "$OUT/steps.json"
echo "upgrade: the upgraded app paired and answered; evidence in $OUT"
