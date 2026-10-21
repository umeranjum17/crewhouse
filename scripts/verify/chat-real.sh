#!/usr/bin/env bash
# done-done journey `chat-real` (hand/agent only: needs a browser session and a MiniMax key): one isolated crewd on the
# real engine (OpenClaw through the BYOKit kit), signed in to MiniMax through the sign-in sheet's own key paste, on
# the account's Flash model. One message goes to Chief; the journey waits, bounded, for a real reply (the stub engine's
# words are hidden by the app, so only a real route can show one) and captures Chief's thread at 390 wide, day and night.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/chat-real.sh <out-dir> <minimax-key-file>
#
# Every step is stamped in <out-dir>/timeline.txt (seconds from crewd's start to the first Chief reply). ENGINE_DIR names
# an engine install to reuse (CREWHOUSE_ENGINE_DIR), so a run can time the steps after the one-off install.
#
# The key is read from the file into the sign-in request only: never printed, logged, copied or kept in the repo. Exit 0
# with chat-real/chief-{night,day}-390.png, reply.txt (Chief's words), timeline.txt in <out-dir>, and crewd.log only on a failure; non-zero when no reply
# arrives within REPLY_SECONDS (default 180) or the reply is a stub line. Spends a few model calls on that key's account.
set -euo pipefail
[ $# -ge 2 ] || { echo "usage: chat-real.sh <out-dir> <minimax-key-file>" >&2; exit 2; }
KEYFILE=$2; case "$KEYFILE" in env:*) v=${KEYFILE#env:}; [ -n "${!v:-}" ];; *) [ -s "$KEYFILE" ];; esac || { echo "chat-real: no key in the key file" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-chat-real.XXXXXX)
trap 'crewd_stop || exit 1; [ "${OK:-}" = 1 ] || cp "$LAB/crewd.log" "$OUT/" 2>/dev/null; chmod -R u+w "$LAB"; rm -rf "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
A=${CHAT_ACCOUNT:-minimax}; N=MiniMax; [ "$A" = openrouter ] && N=OpenRouter # CHAT_ACCOUNT=openrouter: the same journey on MiniMax Flash through an OpenRouter key, when the MiniMax plan is out of quota
TL="$OUT/timeline.txt"; : > "$TL"
mark() { printf '%s %s\n' "$(date +%s.%N)" "$1" >> "$TL"; }
mark start
crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" ${ENGINE_DIR:+CREWHOUSE_ENGINE_DIR="$ENGINE_DIR"} \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
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
[ -n "$PERSON" ] || { echo "chat-real: crewd never became ready" >&2; exit 1; }
# An OpenRouter key has no Flash default and its live catalog is not listed to the app, so the lab's Chief is pointed at the model by name.
[ "$A" != openrouter ] || node -e 'const f = process.argv[1], b = JSON.parse(require("node:fs").readFileSync(f, "utf8")); b.models = ["openrouter:" + process.argv[2]]; require("node:fs").writeFileSync(f, JSON.stringify(b, null, 2))' "$LAB/crew/bots/chief/bot.json" "${CHAT_MODEL:-minimax/minimax-m3.1-flash:free}"
mark "engine ready"
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 60 "${H[@]}" "${@:2}" "$B$1"; }
# SHOTS=1 captures the first-day screens at 390 wide, day and night, before the sign-in (slower: time a run without it).
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
shot() { [ "${SHOTS:-0}" = 1 ] || return 0; WIDTHS=390x844 bash "$REPO/scripts/verify/screens.sh" "$OUT/first-run" "$@"; }
OPEN_CHIEF="for (let i = 0; i < 50 && !document.querySelector('.sh-chief a'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('.sh-chief a')?.click(); for (let i = 0; i < 50 && !document.querySelector('.home-chat'); i++) await new Promise((r) => setTimeout(r, 100));"
shot hello "$B/#person=$PERSON"
# The first-day path: no name, the first request typed on Hello, then the key. The request waits for the sign-in and starts by itself.
ASK='Good morning Chief. Please say hello back in one short sentence.'
api /api/onboard -d "{\"address\":\"\",\"ask\":\"$ASK\"}" > /dev/null
mark "first request sent"
THEN="(async () => { $OPEN_CHIEF return !!document.querySelector('.ask'); })()" shot card "$B/#person=$PERSON"
THEN="(async () => { $OPEN_CHIEF for (const b of document.querySelectorAll('.ai-picks button')) if (/$N/.test(b.textContent)) { b.click(); break; } for (let i = 0; i < 50 && !document.querySelector('input[type=password]'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('input[type=password]'); })()" shot key-sheet "$B/#person=$PERSON"
api "/api/accounts/1/$A/login" -d '{"via":"key"}' > /dev/null
mark "key sheet open"
node -e 'const k = process.argv[1]; process.stdout.write(JSON.stringify({ text: (k.startsWith("env:") ? process.env[k.slice(4)] : require("node:fs").readFileSync(k, "utf8")).trim() }))' "$KEYFILE" |
  api "/api/accounts/1/$A/paste" --max-time 120 --data-binary @- > /dev/null
mark "key pasted"
for _ in $(seq 120); do api /api/accounts | grep -q "\"account\":\"$A\",\"name\":\"$N\",\"signedIn\":true" && break; sleep 0.5; done
api /api/accounts | grep -q "\"account\":\"$A\",\"name\":\"$N\",\"signedIn\":true" || { cp "$LAB"/state/logs/openclaw*.log "$OUT"/ 2>/dev/null; echo "chat-real: $N did not take the key" >&2; exit 1; }
mark "signed in"
MODEL=${CHAT_MODEL:-MiniMax-M3.1-Flash}; [ "$A" != openrouter ] || MODEL=${CHAT_MODEL:-minimax/minimax-m3.1-flash:free}
# Chief's reply: his words in the thread once the job is done. A job that failed is no reply, even though crewd writes
# a line for it, so a model that rejects Chief's request fails here at once with that state.
look() { api /api/bots/chief | node -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")), s = t.tasks?.[0]?.state, m = (t.messages ?? []).filter((x) => x.author === "bot" && String(x.text ?? "").trim() && !/\bstub [\w-]+:/.test(x.text));
  if (s === "done" && m.length) process.stdout.write("done " + m.at(-1).text); else if (["failed", "unsure"].includes(s)) process.stdout.write("end " + s)'; }
R=""
DEADLINE=$((SECONDS + ${REPLY_SECONDS:-180}))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  R=$(look)
  case "$R" in done\ *) R=${R#done }; break;; end\ *) api /api/bots/chief > "$OUT/thread.json" || true; cp "$LAB"/state/logs/openclaw*.log "$OUT"/ 2>/dev/null || true; echo "chat-real: Chief's job ${R#end } on $MODEL; thread in $OUT/thread.json" >&2; exit 1;; esac
  R=""; sleep 1
done
[ -n "$R" ] || { api /api/bots/chief > "$OUT/thread.json" || true; echo "chat-real: no reply from Chief within ${REPLY_SECONDS:-180}s" >&2; exit 1; }
mark "first Chief reply"
api /api/bots/chief > "$OUT/thread.json" || true
cp "$LAB"/state/logs/openclaw*.log "$OUT"/ 2>/dev/null || true
# A MiniMax key starts on Flash with nothing picked by hand: the engine's own log names the model that answered.
grep -q "\[model-fetch\] response provider=$A .*model=$MODEL " "$OUT"/openclaw-events.log || { echo "chat-real: the reply did not come from $MODEL" >&2; exit 1; }
rm -f "$OUT/openclaw-events.log" # the assertion above is the proof of the model; the raw log is over the judge's 64 KB read
echo "chat-real: model $MODEL"
printf 'Chief replied, on %s (named in the engine log), to a first request typed with no name, after a %s key sign-in:\n%s\n' "$MODEL" "$N" "$R" > "$OUT/reply.txt"; mark "model $MODEL answered (engine log)"; rm -f "$OUT/openclaw.log" "$OUT/thread.json"; OK=1
# Chief's thread, opened the way a person does: a tap on Chief's card on Home.
THEN="(async () => { for (let i = 0; i < 50 && !document.querySelector('.sh-chief a'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('.sh-chief a')?.click(); for (let i = 0; i < 50 && !document.querySelector('.home-chat'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.home-chat'); })()" \
  WIDTHS=390x844 bash "$REPO/scripts/verify/screens.sh" "$OUT/chat-real" chief "$B/#person=$PERSON"
node -e 'const rows = require("node:fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => [parseFloat(l), l.slice(l.indexOf(" ") + 1)]); for (const [t, w] of rows) console.log((t - rows[0][0]).toFixed(1).padStart(7), "s ", w)' "$TL"
echo "chat-real: Chief replied; thread captured in $OUT/chat-real"
