#!/usr/bin/env bash
# done-done journey `core`: the core user journey, end to end on the real product — a person pairs the PWA to
# their own crew and gets a real Chief reply. One run, one person, one crew.
#
#   scripts/verify/pair-chat.sh <out-dir>
#
# The lab: the real engine (OpenClaw through the BYOKit kit) on the account the key signs in, the repo's own
# relay (the PWA's way in), the built web shell on a public-style origin, and one Chromium under Xvfb that pairs,
# says hello and waits for Chief's words. The key comes by path (`CHAT_KEY_FILE`, the repo's usual place), is
# read into the sign-in request and nowhere else: never printed, logged, copied or kept. The model is the
# account's own (OpenRouter's free MiniMax M3.1 Flash). Spends a few model calls on that key.
#
# Evidence in <out-dir>: chief-reply-{day,night}-{390,1440}.png (the real answer in the paired app),
# two-words-390.png (the pairing in the person's hands), reply.txt (Chief's words), run.json (every step),
# crewd.log, the run's step record and ready.txt.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: pair-chat.sh <out-dir>   (CHAT_ACCOUNT, CHAT_KEY_FILE, CHAT_MODEL)" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
# The app under test: this checkout by default, an installed release by the upgrade journey (APP_DIR).
APP_DIR=${APP_DIR:-$REPO}
[ "$APP_DIR" = "$REPO" ] && CREWD_ENTRY=src/main.ts || CREWD_ENTRY=dist/crewd.js
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-pair-chat.XXXXXX)
RELAY_PID=""; WEB_PID=""
cleanup() {
  crewd_stop || true
  for p in "$RELAY_PID" "$WEB_PID"; do [ -n "$p" ] || continue; kill -TERM "$p" 2>/dev/null || true; done
  for _ in $(seq 50); do
    alive=0
    for p in "$RELAY_PID" "$WEB_PID"; do [ -n "$p" ] && kill -0 "$p" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && break
    sleep 0.1
  done
  for p in "$RELAY_PID" "$WEB_PID"; do [ -n "$p" ] && kill -KILL "$p" 2>/dev/null || true; done
  chmod -R u+w "$LAB" 2>/dev/null || true
  rm -rf "$LAB"
}
trap cleanup EXIT
mkdir -p "$LAB"/{home,state,crew,tools,run,relay,tmp} "$LAB/state/openclaw"
free() { node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
# The node on PATH may be a shim that cannot run; the engine's floor is Node 22.22.3.
NODE_BIN=${NODE_BIN:-$(dirname "$(readlink -f "$(command -v node)")")}
export PATH="$NODE_BIN:/usr/bin:/bin"
[ -x "$NODE_BIN/node" ] || { echo "pair-chat: no node at $NODE_BIN" >&2; exit 1; }
PORT=$(free); LINK_PORT=$(free); RPORT=$(free); WPORT=$(free)
B="http://127.0.0.1:$PORT"; RELAY="http://127.0.0.1:$RPORT"; WEB="http://crewhouse.localhost:$WPORT"
ACCOUNT=${CHAT_ACCOUNT:-openrouter}
MODEL=${CHAT_MODEL:-minimax/minimax-m3.1-flash:free}
# The key comes by path (the person's own key file, the repo's usual place), never from an environment
# variable: it is read into the sign-in request and nowhere else.
KEY_FILE=${CHAT_KEY_FILE:-$HOME/.config/openrouter/api_key}
ASK=${CHAT_ASK:-Good morning Chief. Please say hello back in one short sentence.}
export ASK
[ -s "$KEY_FILE" ] || { echo "pair-chat: no key in $KEY_FILE" >&2; exit 2; }
# The engine's own set (the patched engine the kit builds) is heavy; keep it in one place a later run reuses.
ENGINE_DIR=${CREWHOUSE_ENGINE_DIR:-$REPO/runtime/openclaw}
mkdir -p "$ENGINE_DIR"
mask() { exec env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB/tmp" XDG_STATE_HOME="$LAB/home/.local/state" \
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_RUN_MODE=test "$@"; }
printf 'LAB=%s\nPORT=%s\nLINK_PORT=%s\nRELAY=%s\nWEB=%s\nB=%s\nREPO=%s\n' "$LAB" "$PORT" "$LINK_PORT" "$RELAY" "$WEB" "$B" "$REPO" > "$LAB/env"
# The computer's own CLI against this lab (the pair code, the yes at the computer).
cat > "$LAB/cli" <<CLI
#!/usr/bin/env bash
exec env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB/tmp" XDG_STATE_HOME="$LAB/home/.local/state" \\
  XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \\
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_RUN_MODE=test \\
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \\
  CREWHOUSE_ENGINE_DIR="$ENGINE_DIR" CREWHOUSE_PORT="$PORT" "$REPO/crewhouse" "\$@"
CLI
chmod +x "$LAB/cli"

# --- the relay: the PWA's way in (the repo's own relay, open signup) ---
(cd "$REPO" && mask PORT="$RPORT" HOST=127.0.0.1 RELAY_DATA="$LAB/relay" RELAY_SIGNUP=open node relay/main.ts > "$LAB/relay.log" 2>&1) &
RELAY_PID=$!
for _ in $(seq 300); do curl -fsS --max-time 5 "$RELAY/health" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fsS --max-time 5 "$RELAY/health" >/dev/null || { echo "pair-chat: the relay never came up" >&2; tail -5 "$LAB/relay.log" >&2; exit 1; }

# --- the crew: the real engine, on its own home and its own state ---
START=$SECONDS
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB/tmp" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" \
  XDG_CACHE_HOME="$LAB/home/.cache" XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_RUN_MODE=test CREWHOUSE_PORT="$PORT" CREWHOUSE_LINK_PORT="$LINK_PORT" CREWHOUSE_LINK_HOST=127.0.0.1 \
  CREWHOUSE_RELAY="$RELAY" CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  CREWHOUSE_ENGINE_DIR="$ENGINE_DIR" node "$APP_DIR/$CREWD_ENTRY"
PERSON=""
for _ in $(seq 6000); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"phase":"ready"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "pair-chat: the crew never became ready" >&2; tail -20 "$OUT/crewd.log" >&2; exit 1; }
echo "pair-chat: the crew is ready in $((SECONDS - START))s" | tee "$OUT/ready.txt"

# --- the person's account: signed in with the key named by the environment ---
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 120 "${H[@]}" "$@"; }
api -X POST "$B/api/accounts/1/$ACCOUNT/login" -d '{"via":"key"}' >/dev/null
node -e 'process.stdout.write(JSON.stringify({ text: require("node:fs").readFileSync(process.argv[1], "utf8").trim() }))' "$KEY_FILE" |
  api -X POST --data-binary @- "$B/api/accounts/1/$ACCOUNT/paste" >/dev/null
for _ in $(seq 240); do api "$B/api/accounts" | grep -Eq "\"account\":\"$ACCOUNT\",[^}]*\"signedIn\":true" && break; sleep 0.5; done
api "$B/api/accounts" | grep -Eq "\"account\":\"$ACCOUNT\",[^}]*\"signedIn\":true" || { echo "pair-chat: $ACCOUNT did not take the key" >&2; exit 1; }
echo "pair-chat: signed in to $ACCOUNT"
# The model under test, named in Chief's own bot.json: the picker cannot choose a key sign-in's models, and the
# kit registers the model the bot already names.
node -e 'const f=process.argv[1], c=JSON.parse(require("node:fs").readFileSync(f,"utf8")); c.models=[process.argv[2]+":"+process.argv[3]]; require("node:fs").writeFileSync(f, JSON.stringify(c,null,2))' \
  "$LAB/crew/bots/chief/bot.json" "$ACCOUNT" "$MODEL"
echo "pair-chat: Chief thinks with $ACCOUNT:$MODEL"

# --- the app the person pairs: the built shell on a public-style origin ---
[ "$APP_DIR" = "$REPO" ] && { node "$REPO/scripts/build-web.mjs" > "$OUT/build-web.log" 2>&1 || { echo "pair-chat: the web build failed" >&2; cat "$OUT/build-web.log" >&2; exit 1; }; }
(cd "$REPO" && mask node scripts/verify/serve-web.mjs "$APP_DIR/web/dist" "$WPORT" > "$LAB/web.log" 2>&1) &
WEB_PID=$!
for _ in $(seq 300); do curl -fsS --max-time 5 "$WEB/" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fsS --max-time 5 "$WEB/" >/dev/null || { echo "pair-chat: the shell never came up" >&2; exit 1; }

# --- the journey: pair, say hello, read the answer ---
node "$REPO/scripts/verify/pair-chat-plan.mjs" "$LAB" "$OUT" > "$LAB/plan.json"
xvfb-run -a -s "-screen 0 1920x1200x24" node "$REPO/scripts/verify/pwa-shell.mjs" "$LAB/plan.json" > "$OUT/run.json" 2> "$OUT/run.err" || true
node -e '
const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const bad = r.filter((s) => s.error);
if (bad.length) { console.error("pair-chat: failed steps: " + bad.map((s) => s.step).join(", ")); process.exit(1); }
' "$OUT/run.json" || { tail -20 "$OUT/run.err" >&2; exit 1; }
# Chief's words, out of the app's own thread.
node -e '
const fs = require("node:fs"), r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const reply = r.filter((s) => s.step === "reply").map((s) => s.value).filter(Boolean).pop();
if (!reply) { console.error("pair-chat: Chief never answered"); process.exit(1); }
fs.writeFileSync(process.argv[2], "You asked Chief: " + process.argv[3] + "\nChief replied (" + process.argv[4] + "): " + reply + "\n");
console.log(reply);
' "$OUT/run.json" "$OUT/reply.txt" "$ASK" "$ACCOUNT:$MODEL" || exit 1
# The step record done-done reads (the run's own steps, in the person's words).
node "$REPO/scripts/verify/steps.mjs" "$OUT" pair-chat
echo "pair-chat: Chief answered; evidence in $OUT"
