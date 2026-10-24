#!/usr/bin/env bash
# done-done journey `member-models-screens` (needs a browser session): one isolated stub-engine crewd, the chat order
# "Use ChatGPT for Scout on the quick model." and the refused "Use Grok for Scout." in Chief's thread, captured dark and
# light at 1280 and 390 into <out>/screens/. Chief's two lines are scripted (CREWHOUSE_STUB_GOLDEN); the crew_use call
# behind each really runs and writes models.json, which this script also copies to <out>.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/member-models-screens.sh "$DONE_DONE_EVIDENCE_ROOT"
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: member-models-screens.sh <evidence-dir>" >&2; exit 2; }
OUT=$1; mkdir -p "$OUT/screens"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-mm-screens.XXXXXX)
trap 'rc=$?; [ "$rc" = 0 ] || cp "$LAB/crewd.log" "$OUT/crewd-screens.log" 2>/dev/null; crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
case "$(command -v node)" in */mise/shims/*) mkdir "$LAB/bin" && ln -s /usr/bin/node /usr/bin/npm /usr/bin/npx "$LAB/bin/" && export PATH=$LAB/bin:$PATH;; esac # done-done runs with a clean environment, where a version-manager shim fails: use the distro node and npm, alone, so every other shim keeps its place
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_STUB_GOLDEN=1 CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts"
PERSON=""
DEADLINE=$((SECONDS + 60))
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    if curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"'; then break; fi
  fi
  [ "$SECONDS" -ge "$DEADLINE" ] && break
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "member-models-screens: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
curl -fsS --max-time 10 "${H[@]}" -d '{"address":"Umer"}' "$B/api/onboard" > /dev/null
curl -fsS --max-time 10 "${H[@]}" -d '{"template":"scout","name":"Scout"}' "$B/api/recruit" > /dev/null
say() { curl -fsS --max-time 10 "${H[@]}" -d "{\"text\":\"$1\"}" "$B/api/bots/chief/messages" > /dev/null
  for _ in $(seq 120); do curl -fsS --max-time 10 "${H[@]}" "$B/api/bots/chief" | grep -qF "$2" && return 0; sleep 0.25; done; echo "member-models-screens: no reply with: $2" >&2; exit 1; }
say 'Use ChatGPT for Scout on the quick model.' 'Scout now thinks with ChatGPT'
say 'Use Grok for Scout.' 'not signed in to Grok'
grep -q '"chatgpt:quick-1"' "$LAB/crew/models.json" || { echo "member-models-screens: models.json lacks the pick" >&2; exit 1; }
cp "$LAB/crew/models.json" "$OUT/models-screens.json"
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
URL="$B/#person=$PERSON"
# Chief's thread, opened the way a person does: a tap on Chief's card on Home.
THEN="(async () => { for (let i = 0; i < 50 && !document.querySelector('.sh-chief a'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('.sh-chief a')?.click(); for (let i = 0; i < 50 && !document.querySelector('.home-chat'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.home-chat'); })()" \
  WIDTHS="1280x800 390x844" bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" chief-models "$URL"
echo "member-models-screens: $(ls "$OUT"/screens/*.png | wc -l) captures in $OUT/screens"
