#!/usr/bin/env bash
# done-done journey `onboard-chat`: a fresh person's first run. After the computer is set up the app opens straight on
# Chief's chat: he asks the name there, the answer is saved as the address, and he pitches with ideas to try (no Hello
# screen between). One isolated stub-engine crewd, no model words, no network, no sends; captures at 390 and 1280, night
# and day, into <out>/screens/. Run it on an older checkout with REPO_DIR=<that checkout> (MODE is read from the build:
# an app with no "How does this work?" chip drives the old Hello screen instead and captures its "before").
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/onboard-chat.sh <evidence-dir>
#
# Exit 0 with the PNGs and journey.json (the person's address, Chief's thread and the page's own checks), non-zero otherwise.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: onboard-chat.sh <evidence-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=${REPO_DIR:-$(git rev-parse --show-toplevel)}
VERIFY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$VERIFY/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-onboard.XXXXXX)
trap 'crewd_stop || exit 1; rm -rf "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  "${NODE_BIN:-node}" "$REPO/src/main.ts"
PERSON=""
DEADLINE=$((SECONDS + 60))
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  [ "$SECONDS" -ge "$DEADLINE" ] && break
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "onboard-chat: crewd never became ready" >&2; exit 1; }
H=(-H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
get() { curl -fsS --max-time 10 "${H[@]}" "$B$1"; }
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
axi() { timeout -k 10 120 chrome-devtools-axi "$@"; }
SHOTS="$VERIFY/screens.sh"; URL="$B/#person=$PERSON"; export WIDTHS="390x844 1280x800"
ready() { printf '(async () => { for (let i = 0; i < 100 && !(%s); i++) await new Promise((r) => setTimeout(r, 100)); return !!(%s); })()' "$1" "$1"; }
# The page's own words typed into the open composer and sent, the way a person does (the textarea is React's).
type_send() { axi eval "(async () => { const t = document.querySelector('$1 textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, '$2'); t.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 200)); document.querySelector('$1 button.send').click(); return true; })()"; }

# The old build (a Hello screen) or the new one (Chief's chat first): told by the built app itself.
if grep -q "How does this work" "$REPO"/web/dist/*.js 2>/dev/null; then MODE=after; else MODE=before; fi
echo "onboard-chat: $MODE ($REPO)" >&2
if [ "$MODE" = before ]; then
  THEN=$(ready "document.querySelector('.fr-hello .idea')") bash "$SHOTS" "$OUT/screens" before-hello "$URL"
  axi eval "document.querySelector('.fr-hello .idea').click()" > /dev/null
  for _ in $(seq 100); do get /api/state | grep -q '"onboarded":1' && break; sleep 0.2; done
  THEN=$(ready "document.querySelector('.lines .line.me')") bash "$SHOTS" "$OUT/screens" before-chat "$URL"
  get /api/state > "$OUT/journey.json"
  exit 0
fi

# 1. The fresh first run lands on Chief's chat with the name question: no Hello screen, no other route.
THEN=$(ready "location.hash === '#/chief' && document.querySelector('.dock textarea') && /What shall I call you/.test(document.body.innerText)") bash "$SHOTS" "$OUT/screens" ask-name "$URL"
get /api/state | grep -q '"onboarded":0' || { echo "onboard-chat: not a fresh person" >&2; exit 1; }
# 2. The name is typed in the chat's own box: saved as the address, Chief's pitch follows with the ideas to try.
type_send .dock Umer > /dev/null
for _ in $(seq 100); do get /api/state | grep -q '"address":"Umer"' && break; sleep 0.2; done
get /api/state | grep -q '"address":"Umer"' || { echo "onboard-chat: the name was not saved" >&2; exit 1; }
URL="$B/#/chief"
CHIPS=$(ready "document.querySelectorAll('.chips.center .chip').length >= 4")
THEN=$CHIPS bash "$SHOTS" "$OUT/screens" pitch "$URL"
# 3. How does this work? answers in the chat itself.
THEN="(async () => { await $(ready "document.querySelectorAll('.chips.center .chip').length >= 4"); [...document.querySelectorAll('.chips.center .chip')].find((c) => /How does this work/.test(c.textContent)).click(); return $(ready "document.querySelector('.promises')"); })()" bash "$SHOTS" "$OUT/screens" how "$URL"
# 4. A tapped idea is the first job: it goes to Chief as the person's own line.
axi eval "(async () => { await $(ready "document.querySelectorAll('.chips.center .chip').length >= 4"); [...document.querySelectorAll('.chips.center .chip')].find((c) => !/How does/.test(c.textContent)).click(); return true; })()" > /dev/null
for _ in $(seq 100); do get /api/bots/chief | grep -q 'dinners' && break; sleep 0.2; done
axi eval "$(ready "!document.querySelector('.chips.center .chip')")" > /dev/null
axi screenshot "$OUT/screens/tapped-idea-1280-day.png" > /dev/null
get /api/bots/chief | node -e 'const p = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(JSON.stringify({ messages: p.messages.map((m) => ({ author: m.author, text: m.text.slice(0, 160) })) }, null, 1))' > "$OUT/journey.json"
get /api/state | node -e 'const s = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(JSON.stringify({ person: s.person }))' >> "$OUT/journey.json"
grep -q '"author": "person"' "$OUT/journey.json" && grep -q 'Nice to meet you, Umer' "$OUT/journey.json" || { echo "onboard-chat: Chief's thread lacks the name or the pitch" >&2; exit 1; }
echo "onboard-chat: $(ls "$OUT"/screens/*.png | wc -l) captures in $OUT/screens"
# done-done's step record: what a person did and saw (a node script on stdin, so no shell quoting touches the words)
node - "$OUT" <<'JS'
const fs = require("node:fs");
const v = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
fs.writeFileSync(process.argv[2] + "/steps.json", JSON.stringify({
  target: { version: v },
  start: "first launch of Crewhouse on a new computer, nobody signed in, no name given",
  steps: ["Open Crewhouse after computer setup: it opens on Chief's chat, and he asks what to call you", "Type a name in the chat", "Read Chief's pitch and the ideas to try", "Tap How does this work? and read the answer in the chat", "Tap an idea: it goes to Chief as the first job"],
  result: "Chief asks the name in chat and pitches with ideas to tap, with no Hello screen between; the name is saved as the address",
}, null, 2));
JS
