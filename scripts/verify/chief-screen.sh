#!/usr/bin/env bash
# Chief does a personal-assistant job on its own screen: one isolated crewd on the real engine (OpenClaw, its own
# `computer` tool and node host) with the scripted model (test/openclaw-stub.ts), onboarded as Umer. Umer asks Chief to
# renew a library card on a loopback form; Chief's desktop and node start, and every computer call crosses crewd's
# gate. Films Chief's display while it works, then checks that a call naming another bot's node is refused.
#
#   scripts/verify/chief-screen.sh <out-dir> [<minimax-key-file>]
#
# With a key file the model is real: no scripted provider, Chief signs in to MiniMax through the sign-in sheet's key
# paste (the key is read from the file, never printed or logged), runs on the key lane's own MiniMax-M3, and is asked in
# plain words; the check is then the form's own saved line. The network and the key's account are used.
#
# Exit 0 with chief-screen.mp4, saved.txt (the form's own record), events.json (crewd's gate trail) and crewd.log in
# <out-dir>; non-zero otherwise. Needs Xvfb, Chromium, bubblewrap and ffmpeg. No account, no network, no sends.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: chief-screen.sh <out-dir> [<minimax-key-file>]" >&2; exit 2; }
KEYFILE=${2:-}; [ -z "$KEYFILE" ] || [ -s "$KEYFILE" ] || { echo "chief-screen: no key in the key file" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-screen.XXXXXX)
HELPER="" FILM="" APP=""
trap '[ -z "$APP" ] || { touch "$LAB/stop-film"; wait "$APP" 2>/dev/null; }; [ -z "$FILM" ] || kill -INT "$FILM" 2>/dev/null; [ -z "$HELPER" ] || kill "$HELPER" 2>/dev/null; crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
node "$REPO/scripts/verify/chief-screen-model.ts" "$LAB/env" "$OUT/saved.txt" ${KEYFILE:+real} > "$OUT/model.log" 2>&1 &
HELPER=$!
for _ in $(seq 100); do [ -s "$LAB/env" ] && break; sleep 0.1; done
. "$LAB/env"
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
MODEL_ENV=(CREWHOUSE_ENGINE_BASE_URL="${MODEL:-}" CREWHOUSE_ENGINE_API_KEY=scripted); [ -z "$KEYFILE" ] || MODEL_ENV=()
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  "${MODEL_ENV[@]}" CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 1200); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"phase":"ready"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "chief-screen: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
post() { curl -fsS --max-time 60 "${H[@]}" -d "$2" "$B$1" > /dev/null; }
post /api/onboard '{"address":"Umer"}'
if [ -n "$KEYFILE" ]; then # the sign-in sheet's own path: start a key sign-in, paste the key from its file (the key lane runs MiniMax-M3, the model that sees the screen)
  post /api/accounts/1/minimax/login '{"via":"key"}'
  node -e 'process.stdout.write(JSON.stringify({ text: require("node:fs").readFileSync(process.argv[1], "utf8").trim() }))' "$KEYFILE" |
    curl -fsS --max-time 120 "${H[@]}" --data-binary @- "$B/api/accounts/1/minimax/paste" > /dev/null
  for _ in $(seq 120); do curl -fsS --max-time 10 "${H[@]}" "$B/api/accounts" | grep -q '"account":"minimax","name":"MiniMax","signedIn":true' && break; sleep 0.5; done
  curl -fsS --max-time 10 "${H[@]}" "$B/api/accounts" | grep -q '"account":"minimax","name":"MiniMax","signedIn":true' || { echo "chief-screen: MiniMax did not take the key: $(curl -fsS --max-time 10 "${H[@]}" "$B/api/accounts" | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")).find((a) => a.account === "minimax").signIn)')" >&2; exit 1; }
fi
# The app as the person sees it, at phone and desktop width, from before the first word to the end.
if [ -n "$KEYFILE" ]; then bash "$REPO/scripts/verify/app-film.sh" "$B/#person=$PERSON" "$OUT/app.mp4" "$LAB/stop-film" & APP=$!; sleep 12; fi
# The scripted model's moves: the address bar, the form, the name, Renew, then the outcome it saw.
act() { printf '[tool computer {"node": "crewhouse-chief", %s}] ' "$1"; }
SCRIPT="$(act '"action": "screenshot"')$(act '"action": "key", "text": "ctrl+l"')$(act "\"action\": \"type\", \"text\": \"$SITE\"")$(act '"action": "key", "text": "Return"')"
SCRIPT+="$(act '"action": "screenshot"')$(act '"action": "left_click", "coordinate": [500, 270], "frameId": "{frameId}"')$(act '"action": "type", "text": "Umer Farooq"')$(act '"action": "key", "text": "Return"')"
SCRIPT+='[tool crew_outcome {"worked": true, "seen": "The library page says the card is renewed."}]'
# A first word opens Chief's run, which starts its desktop and node; the job itself waits until the film rolls.
post /api/bots/chief/messages '{"text":"Good morning Chief, I have an errand for you in a minute."}'
[ -z "$KEYFILE" ] || SCRIPT="Do it yourself on your own screen, with your computer: open $SITE and renew it for me. Do not hand it to anyone."
ASK=$(node -e 'console.log(JSON.stringify({ text: `Please renew my library card on the Riverside Library site, my name is Umer Farooq. ${process.argv[1]}` }))' "$SCRIPT")
# Chief's display: the Xvfb crewd started with Chief's own cookie, found by its X socket.
X=""
for _ in $(seq 600); do
  for p in $(pgrep -u "$(id -u)" -x Xvfb || true); do
    tr '\0' '\n' < "/proc/$p/cmdline" 2>/dev/null | grep -qx "$LAB/state/desktops/chief.xauth" || continue
    for fd in /proc/"$p"/fd/*; do i=$(readlink "$fd" 2>/dev/null | sed -n 's/^socket:\[\([0-9]*\)\]$/\1/p'); [ -n "$i" ] || continue
      X=$(awk -v i="$i" '$7 == i && $8 ~ /X11-unix\/X[0-9]+$/ { sub(/.*X11-unix\/X/, "", $8); print ":" $8; exit }' /proc/net/unix); [ -n "$X" ] && break 2; done
  done
  sleep 0.1
done
[ -n "$X" ] || { echo "chief-screen: Chief's desktop never started" >&2; exit 1; }
DISPLAY=$X XAUTHORITY="$LAB/state/desktops/chief.xauth" ffmpeg -y -loglevel error -f x11grab -video_size 1280x800 -framerate 10 -i "$X" -pix_fmt yuv420p "$OUT/chief-screen.mp4" < /dev/null &
FILM=$!
sleep 2
post /api/bots/chief/messages "$ASK"
for _ in $(seq 2400); do [ -s "$OUT/saved.txt" ] && break; sleep 0.25; done
sleep 3 # the thank-you page on film
kill -INT "$FILM"; wait "$FILM" || true; FILM=""
if [ -n "$APP" ]; then sleep 20; touch "$LAB/stop-film"; wait "$APP"; APP=""; fi # the app shows Chief's words and the job's state
# Another bot's screen is never Chief's: crewd's gate refuses a call that names any node but its own.
if [ -z "$KEYFILE" ]; then
post /api/bots/chief/messages '{"text":"[tool computer {\"node\": \"crewhouse-scout\", \"action\": \"screenshot\"}]"}'
for _ in $(seq 240); do curl -fsS --max-time 10 "${H[@]}" "$B/api/bots/chief" | grep -q 'Name your own computer on every call' && break; sleep 0.25; done
curl -fsS --max-time 10 "${H[@]}" "$B/api/bots/chief" | grep -q 'Name your own computer on every call' || { echo "chief-screen: a call naming another node was not refused" >&2; exit 1; }
fi
node -e '
const { DatabaseSync } = require("node:sqlite"), db = new DatabaseSync(process.argv[1], { readOnly: true });
console.log(JSON.stringify(db.prepare("SELECT at, kind, data FROM events WHERE bot = ? AND kind LIKE ? ORDER BY seq").all("chief", "run.%"), null, 1));
console.log(JSON.stringify(db.prepare("SELECT id, state, acted, outcome FROM tasks WHERE bot = ?").all("chief")));' "$LAB/state/crew.db" > "$OUT/events.json"
[ -z "$KEYFILE" ] || grep -qF 'Used computer' "$OUT/events.json" || { echo "chief-screen: Chief never used the computer tool" >&2; exit 1; }
grep -qx 'name=Umer Farooq' "$OUT/saved.txt" || { echo "chief-screen: the form was not saved with Umer's name" >&2; exit 1; }
echo "chief-screen: Chief renewed the card on its own screen; film in $OUT/chief-screen.mp4"
