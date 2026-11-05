#!/usr/bin/env bash
# done-done journey `pi-engine`: the Pi flag, off and on, in the real app.
# Off: the bot list and a bot's chat as they stand, by bot-crew.sh, into <out>/flag-off. On: an isolated crewd with
# CREWHOUSE_ENGINE=pi runs Chief on the real pinned Pi through @byokit/pi, on a real model (the free MiniMax M3.1 Flash, the key
# read from the file into crewd's environment and nowhere else); one message goes through the API the app uses, and his thread
# is captured at 390 and 1280, day and night, and in the installed window. A stand-in person's Pi folder in the lab's HOME, the
# HOME crewd and Pi both start from, is hashed whole before and after. The owner's real folder is never read here.
#
#   scripts/verify/pi-engine.sh <out-dir> <minimax-key-file>
#
# Needs node scripts/prepare-pi.mjs, /usr/bin/chromium and ImageMagick. Spends a few model calls on that key.
# Writes reply.txt (Chief's words and Pi's own session record of them), pi-folder.txt (the hashes) and the step record.
set -euo pipefail
OUT=${1:?usage: pi-engine.sh <out-dir> <minimax-key-file>}; KEYFILE=${2:?usage: pi-engine.sh <out-dir> <minimax-key-file>}; mkdir -p "$OUT"
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
[ -f "$REPO/runtime/byokit/packages/pi/dist/index.js" ] || { echo "pi-engine: run node scripts/prepare-pi.mjs first" >&2; exit 1; }
[ -f "$REPO/web/dist/index.html" ] || (cd "$REPO" && npm run build:web > "$OUT/build-web.log" 2>&1)
LAB=$(mktemp -d -t crewhouse-pi.XXXXXX)
trap 'crewhouse_remove_lab "$LAB"' EXIT
STANDIN="$LAB/home/.pi/agent"
mkdir -p "$STANDIN/extensions" "$LAB"/{state,crew,tools,run}
hashes() { (cd "$LAB/home/.pi" && find . -type f | sort | xargs -r sha256sum); }
printf '{"canary":{"type":"api_key","key":"CANARY"}}' > "$STANDIN/auth.json"
printf '{"defaultModel":"canary-model"}' > "$STANDIN/settings.json"
printf 'throw new Error("CANARY extension loaded");' > "$STANDIN/extensions/canary.ts"
BEFORE=$(hashes)

bash "$REPO/scripts/verify/bot-crew.sh" "$OUT/flag-off"

NODE=$(node -p process.execPath)
PORT=$("$NODE" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
MODEL=${PI_MODEL:-MiniMax-M3.1-Flash}
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" KEYFILE="$KEYFILE" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=pi CREWHOUSE_ENGINE_BASE_URL=https://api.minimax.io/v1 CREWHOUSE_ENGINE_MODEL="$MODEL" CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  bash -c 'CREWHOUSE_ENGINE_API_KEY=$(cat "$KEYFILE") exec "$@"' pi-engine "$NODE" "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "pi-engine: crewd never became ready" >&2; exit 1; }
grep -q '(engine: pi,' "$OUT/crewd.log" || { echo "pi-engine: crewd did not start on Pi" >&2; exit 1; }
api() { curl -fsS --max-time 60 -H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "${@:2}" "$B$1"; }
api /api/onboard -d '{"address":"Umer"}' > /dev/null
ASK=${ASK:-Good morning Chief. Please say hello back in one short sentence.}
TASK=$(node -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$ASK" | api /api/bots/chief/messages --data-binary @- | node -pe 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).task')
look() { api /api/bots/chief | node -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")), task = t.tasks.find((x) => x.id === Number(process.argv[1]));
  const m = (t.messages ?? []).filter((x) => x.author === "bot" && x.task_id === task?.id && String(x.text ?? "").trim());
  if (task?.state === "done" && m.length) process.stdout.write("done " + m.at(-1).text); else if (["failed", "unsure"].includes(task?.state)) process.stdout.write("end " + task.state)' "$TASK"; }
R=""; DEADLINE=$((SECONDS + ${REPLY_SECONDS:-180}))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  R=$(look)
  case "$R" in done\ *) R=${R#done }; break;; end\ *) echo "pi-engine: Chief's job ${R#end }" >&2; exit 1;; esac
  R=""; sleep 1
done
[ -n "$R" ] || { echo "pi-engine: no reply from Chief within ${REPLY_SECONDS:-180}s" >&2; exit 1; }
# Pi's own record of the turn: the words the app shows must be the words Pi's session wrote, on the model it asked.
RECORD=$(node -e 'const fs = require("node:fs"), dir = process.argv[1], [file] = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  const a = fs.readFileSync(dir + "/" + file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.message?.role === "assistant").at(-1).message;
  console.log(JSON.stringify({ session: file.replace(/^[^_]*_/, ""), provider: a.provider, model: a.model, text: a.content.filter((c) => c.type === "text").map((c) => c.text).join("") }))' "$LAB/state/pi/chief/work/sessions")
node -e 'const r = JSON.parse(process.argv[1]); if (!r.text.includes(process.argv[2].trim().slice(0, 40))) { console.error("pi-engine: Pi session has other words than the chat"); process.exit(1); }' "$RECORD" "$R"
printf 'Engine: Pi, flag on (CREWHOUSE_ENGINE=pi), model %s\nYou asked Chief: %s\nChief replied: %s\nPi session record: %s\n' "$MODEL" "$ASK" "$R" "$RECORD" > "$OUT/reply.txt"
THREAD="(async () => { location.hash = '#/chief'; for (let i = 0; i < 100 && !document.body.innerText.includes($(node -p 'JSON.stringify(process.argv[1].trim().slice(0, 24))' "$R")); i++) await new Promise((r) => setTimeout(r, 100)); })()"
node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT/flag-on" chief "$THREAD"
GATE_PWA=1 node "$REPO/scripts/verify/home-gate.mjs" "$REPO" "$B/#person=$PERSON" "$OUT/flag-on/installed" chief "$THREAD"
crewd_stop
[ "$(hashes)" = "$BEFORE" ] || { echo "pi-engine: the stand-in person's Pi folder changed" >&2; exit 1; }
{ echo "A stand-in person's Pi folder, in the HOME crewd and Pi started from, hashed whole before and after the flag-on run: unchanged, byte for byte."
  printf '%s\n' "$BEFORE"; } > "$OUT/pi-folder.txt"
node "$REPO/scripts/verify/steps.mjs" "$OUT" pi-engine "ask=$ASK" "reply=$R" "model=$MODEL"
echo "pi-engine: Chief replied on Pi; captures in $OUT"
