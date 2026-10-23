#!/usr/bin/env bash
# done-done journey `flash-read` (needs a browser session and an OpenRouter key): one isolated crewd on the real
# engine (OpenClaw through the BYOKit kit) on MiniMax M3.1 Flash, with Scout on the crew. The person asks Chief to
# read the file a helper wrote in the helper's own folder. The crew's own work is the crew's: the read must run, no
# question may reach the person, and Chief's job must end (done) instead of parking in "Needs you".
#
#   CREW_ACCOUNT=openrouter CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/flash-read.sh <out-dir>
#
# The key is read from $OPENROUTER_API_KEY (a variable name, never a value) into the sign-in request only: never
# printed, logged, copied or kept in the repo. Exit 0 when Chief's job ended without a question; non-zero when it
# parked on an ask, when the read never ran, or when the person was asked about a folder that is not theirs. Spends a
# few model calls on that key's account.
set -euo pipefail
ACCOUNT=${CREW_ACCOUNT:-openrouter}
[ $# -ge 1 ] || { echo "usage: flash-read.sh <out-dir>" >&2; exit 2; }
[ "$ACCOUNT" = openrouter ] && [ -n "${OPENROUTER_API_KEY:-}" ] || { echo "flash-read: no key for $ACCOUNT" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=${FLASH_READ_LAB:-$(mktemp -d -t crewhouse-flash-read.XXXXXX)}
trap 'crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  ${CREWHOUSE_ENGINE_DIR:+CREWHOUSE_ENGINE_DIR="$CREWHOUSE_ENGINE_DIR"} \
  CREWHOUSE_PORT="$PORT" CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 2400); do # the first start installs the engine
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"phase":"ready"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "flash-read: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 60 "${H[@]}" "${@:2}" "$B$1"; }
api /api/onboard -d '{"address":"Umer"}' > /dev/null
api /api/accounts/1/$ACCOUNT/login -d '{"via":"key"}' > /dev/null
node -e 'process.stdout.write(JSON.stringify({ text: process.env.OPENROUTER_API_KEY.trim() }))' |
  api /api/accounts/1/$ACCOUNT/paste --max-time 120 --data-binary @- > /dev/null
signed() { api /api/accounts | grep -q "\"account\":\"$ACCOUNT\",\"name\":\"[^\"]*\",\"signedIn\":true"; }
for _ in $(seq 120); do signed && break; sleep 0.5; done
signed || { echo "flash-read: $ACCOUNT did not take the key" >&2; exit 1; }
# Flash is the model under test; a key sign-in's catalog lists none, so the lab names it in Chief's own bot.json.
MODEL=${CHAT_MODEL:-minimax/minimax-m3.1-flash:free}
node -e 'const f = process.argv[1], c = JSON.parse(require("node:fs").readFileSync(f, "utf8")); c.models = [process.argv[2] + ":" + process.argv[3]]; require("node:fs").writeFileSync(f, JSON.stringify(c, null, 2))' "$LAB/crew/bots/chief/bot.json" "$ACCOUNT" "$MODEL"
api /api/recruit -d '{"template":"scout","name":"Scout"}' > /dev/null
# A helper's finished file, in the helper's own folder inside the crew's install.
mkdir -p "$LAB/crew/bots/scout/files"
printf '1. The bench that got a name\n2. Dawn patrol\n3. The one tree everyone knows\n' > "$LAB/crew/bots/scout/files/ideas.md"
ASK=${FLASH_READ_ASK:-"Scout wrote three story ideas into a file. Read the file $LAB/crew/bots/scout/files/ideas.md and tell me exactly what it says, one short line per idea."}
node -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$ASK" | api /api/bots/chief/messages --data-binary @- > /dev/null
dump() { api /api/bots/chief > "$OUT/thread.json" || true; api /api/state > "$OUT/state.json" || true; api "/api/events?after=0" > "$OUT/events.json" || true; }
DEADLINE=$((SECONDS + ${REPLY_SECONDS:-420}))
S=""
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  S=$(api /api/bots/chief | node -e 'const s = JSON.parse(require("node:fs").readFileSync(0, "utf8")).tasks?.[0]?.state ?? ""; process.stdout.write(s)')
  case "$S" in done|failed|unsure|paused) break;; esac
  sleep 1
done
dump
[ -n "$S" ] || { echo "flash-read: Chief's job did not settle within ${REPLY_SECONDS:-420}s" >&2; exit 1; }
node -e 'const t = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")), s = JSON.parse(require("node:fs").readFileSync(process.argv[2], "utf8"));
  const asks = (s.asks ?? []).map((a) => a.title), job = t.tasks?.[0] ?? {};
  console.log("job: " + (job.state ?? "none") + " | " + String(job.result ?? "").slice(0, 160));
  console.log("asks: " + (asks.length ? asks.join(" | ") : "none"));
  if (asks.length) { console.error("flash-read: the person was asked about a file the crew owns"); process.exit(1); }
  if (job.state !== "done") { console.error("flash-read: Chief'"'"'s job ended " + job.state + ", not done"); process.exit(1); }' "$OUT/thread.json" "$OUT/state.json"
# The app on the same lab, so the capture shows the thread with Chief's answer and no question.
if [ -n "${CHROME_DEVTOOLS_AXI_SESSION:-}" ]; then
  export THEN='(async () => { location.hash = "#/chief"; for (let i = 0; i < 60 && !document.querySelector(".home-chat, .chat-page, .chief-page, .lines"); i++) await new Promise((r) => setTimeout(r, 100)); return true; })()'
  bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" chief "$B/#person=$PERSON" || echo "flash-read: the capture failed" >&2
fi
echo "flash-read: Chief read the helper's file and his job ended; thread in $OUT/thread.json"
node "$REPO/scripts/verify/steps.mjs" "$OUT" flash-read
