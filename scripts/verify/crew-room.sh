#!/usr/bin/env bash
# done-done journey `crew-room` (hand/agent only: needs a browser session and a MiniMax key): one isolated crewd on the
# real engine (OpenClaw through the BYOKit kit) on the MiniMax account's Flash model, with Scout and Scribe on the crew.
# One message asks Chief for a job that needs both; Chief hands it on natively. The journey waits, bounded, for his
# closing words, checks the room (`GET /api/room`: Chief's own brief to each helper, one standup) and captures the crew
# room at 390 wide, day and night: the hand-offs, then the standup at the end.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/crew-room.sh <out-dir> <minimax-key-file>
#   CREW_ACCOUNT=openrouter CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/crew-room.sh <out-dir>   (key in OPENROUTER_API_KEY)
#
# The key is read from the file (or the variable) into the sign-in request only: never printed, logged, copied or kept in the repo.
# On OpenRouter the model is its MiniMax Flash entry (the key sign-in's catalog lists none, so it is named here; CHAT_MODEL overrides). Exit 0
# with crew-room/{room,standup}-{night,day}-390.png, room.json (the room as the app reads it) and crewd.log in <out-dir>;
# non-zero when no standup arrives within REPLY_SECONDS (default 420) or fewer than two hand-offs reached the room.
# WIDTHS overrides the capture widths. Spends a few model calls on that key's account.
set -euo pipefail
ACCOUNT=${CREW_ACCOUNT:-minimax}
[ $# -ge 1 ] || { echo "usage: crew-room.sh <out-dir> [<minimax-key-file>]" >&2; exit 2; }
KEYFILE=${2:-}; [ "$ACCOUNT" = openrouter ] && [ -n "${OPENROUTER_API_KEY:-}" ] || [ -s "$KEYFILE" ] || { echo "crew-room: no key for $ACCOUNT" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-crew-room.XXXXXX)
trap 'crewd_stop || exit 1; chmod -R u+w "$LAB"; rm -rf "$LAB"' EXIT
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
[ -n "$PERSON" ] || { echo "crew-room: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 60 "${H[@]}" "${@:2}" "$B$1"; }
api /api/onboard -d '{"address":"Umer"}' > /dev/null
api /api/accounts/1/$ACCOUNT/login -d '{"via":"key"}' > /dev/null
node -e 'process.stdout.write(JSON.stringify({ text: (process.argv[1] === "openrouter" ? process.env.OPENROUTER_API_KEY : require("node:fs").readFileSync(process.argv[2], "utf8")).trim() }))' "$ACCOUNT" "$KEYFILE" |
  api /api/accounts/1/$ACCOUNT/paste --max-time 120 --data-binary @- > /dev/null
signed() { api /api/accounts | grep -q "\"account\":\"$ACCOUNT\",\"name\":\"[^\"]*\",\"signedIn\":true"; }
for _ in $(seq 120); do signed && break; sleep 0.5; done
signed || { echo "crew-room: $ACCOUNT did not take the key" >&2; exit 1; }
# Flash is the model under test; the picker cannot choose a key sign-in's model, so the lab names it in Chief's own bot.json.
MODEL=${CHAT_MODEL:-$([ "$ACCOUNT" = openrouter ] && echo minimax/minimax-m3.1-flash:free || echo MiniMax-M3.1-Flash)}
node -e 'const f = process.argv[1], c = JSON.parse(require("node:fs").readFileSync(f, "utf8")); c.models = [process.argv[2] + ":" + process.argv[3]]; require("node:fs").writeFileSync(f, JSON.stringify(c, null, 2))' "$LAB/crew/bots/chief/bot.json" "$ACCOUNT" "$MODEL"
echo "crew-room: $ACCOUNT model $MODEL"
api /api/recruit -d '{"template":"scout","name":"Scout"}' > /dev/null
api /api/recruit -d '{"template":"scribe","name":"Scribe"}' > /dev/null
ASK=${CREW_ASK:-'Umer here. I need two things done, in order. First ask Scout to name three story ideas for a newsletter about a neighbourhood park, one short line each. Then, when Scout has answered, ask Scribe to write a two-sentence newsletter note about the first idea. When both have reported back, give me one short summary of what each did.'}
node -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$ASK" | api /api/bots/chief/messages --data-binary @- > /dev/null
# The standup: Chief's job ends done, two hand-offs are in the room, and his closing words are its last line. A job that
# ends failed or unsure is no standup of his, so a model that cannot run the hand-offs fails here at once with that state.
look() { api /api/bots/chief | node -e 'const s = JSON.parse(require("node:fs").readFileSync(0, "utf8")).tasks?.[0]?.state; if (s === "done") process.stdout.write("done"); else if (["failed", "unsure", "needs_you"].includes(s)) process.stdout.write("end " + s)'; }
dump() { api /api/bots/chief > "$OUT/thread.json" || true; api /api/room > "$OUT/room.json" || true; api /api/state > "$OUT/state.json" || true; api "/api/events?after=0" > "$OUT/events.json" || true; cp "$LAB"/state/logs/openclaw*.log "$OUT"/ 2>/dev/null || true; }
R=""
DEADLINE=$((SECONDS + ${REPLY_SECONDS:-420}))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  R=$(look)
  case "$R" in done) break;; end\ *) dump; echo "crew-room: Chief's job ${R#end } on $ACCOUNT $MODEL; thread in $OUT/thread.json" >&2; exit 1;; esac
  R=""; sleep 1
done
[ -n "$R" ] || { dump; echo "crew-room: Chief did not finish within ${REPLY_SECONDS:-420}s" >&2; exit 1; }
api /api/room > "$OUT/room.json"
node -e 'const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")), hands = r.lines.filter((l) => l.from === "chief" && l.to), last = r.lines.at(-1);
  if (hands.length < 2) { console.error("crew-room: " + hands.length + " hand-off(s) in the room; the job needs two"); process.exit(1); }
  if (!last?.standup || last.bot !== "chief") { console.error("crew-room: the room does not end on Chief’s standup"); process.exit(1); }
  console.log("crew-room: " + hands.map((l) => "chief to " + l.to).join(", ") + "; standup: " + last.text.slice(0, 120).replace(/\n/g, " "))' "$OUT/room.json"
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
# The room, opened the way the app routes to it; the thread is its own scroller, so the second shot scrolls it to the standup.
THEN="(async () => { location.hash = '#/room'; for (let i = 0; i < 80 && !document.querySelector('.room-page .line.standup'); i++) await new Promise((r) => setTimeout(r, 100)); const l = document.querySelector('.room-page .lines'); if (l) l.scrollTop = 0; return !!document.querySelector('.room-page .line.standup'); })()"
export THEN WIDTHS="${WIDTHS:-390x844}"
bash "$REPO/scripts/verify/screens.sh" "$OUT/crew-room" room "$B/#person=$PERSON"
AFTER="(() => { const l = document.querySelector('.room-page .lines'); if (l) l.scrollTop = l.scrollHeight; document.querySelector('.room-page .line.standup')?.scrollIntoView({ block: 'end' }); return true; })()" \
  bash "$REPO/scripts/verify/screens.sh" "$OUT/crew-room" standup "$B/#person=$PERSON"
echo "crew-room: Chief's standup is in the room; captures in $OUT/crew-room"
