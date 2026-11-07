#!/usr/bin/env bash
# done-done journey `signin-remote` (needs a browser session): the sign-in sheet for a browser that came in over SSH
# (docs/verification/own-server.md). The launcher marks `crewhouse open --link`'s link `&remote=1`; the sheet then leads with the
# code, names the exact 1455 forward on the browser route, and says plainly when the account has codes turned off. A browser
# opened with no mark (a screen on the machine itself) keeps the browser route first. Demo data, one stub-engine lab to serve the app.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/signin-remote.sh "$DONE_DONE_EVIDENCE_ROOT"
#
# Writes <out>/screens/{remote-code,remote-browser,remote-codesoff,local-browser}-{night,day}-{1440,390}.png.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: signin-remote.sh <evidence-dir>" >&2; exit 2; }
OUT=$1; mkdir -p "$OUT/screens"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-signin-remote.XXXXXX)
trap 'rc=$?; [ "$rc" = 0 ] || cp "$LAB/crewd.log" "$OUT/crewd-signin-remote.log" 2>/dev/null; crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
case "$(command -v node)" in */mise/shims/*) mkdir "$LAB/bin" && ln -s /usr/bin/node /usr/bin/npm /usr/bin/npx "$LAB/bin/" && export PATH=$LAB/bin:$PATH;; esac
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts"
PERSON=
for _ in $(seq 240); do
  [ -f "$LAB/state/person.key" ] && PERSON=$(cat "$LAB/state/person.key") && curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "signin-remote: crewd never became ready" >&2; exit 1; }
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
S="bash $REPO/scripts/verify/screens.sh $OUT/screens"
$S remote-code "$B/#person=$PERSON&remote=1" "demo=signin&sheet=signin&phase=code"
$S remote-browser "$B/#person=$PERSON&remote=1" "demo=signin&sheet=signin&phase=waiting"
$S remote-codesoff "$B/#person=$PERSON&remote=1" "demo=codesoff&sheet=signin"
$S local-browser "$B/#person=$PERSON" "demo=signin&sheet=signin&phase=waiting"
node "$REPO/scripts/verify/steps.mjs" "$OUT" signin-remote
echo "signin-remote: $(ls "$OUT"/screens/*.png | wc -l) captures in $OUT/screens"
