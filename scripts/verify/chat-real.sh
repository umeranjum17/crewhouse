#!/usr/bin/env bash
# done-done journey `chat-real` (hand/agent only: needs a browser session and a MiniMax key): one isolated crewd on the
# real engine (OpenClaw through the BYOKit kit), signed in to MiniMax through the sign-in sheet's own key paste, on
# the account's Flash model. One message goes to Chief; the journey waits, bounded, for a real reply (the stub engine's
# words are hidden by the app, so only a real route can show one) and captures Chief's thread at 390 wide, day and night.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> [PACKAGE_DIR=<extracted crewhouse/ of the tarball>] scripts/verify/chat-real.sh <out-dir> <minimax-key-file>
# PACKAGE_DIR runs a built release instead of the checkout and records the seconds to ready (ready.txt); it fails if the release installs an engine at first run.
#
# The key is read from the file into the sign-in request only: never printed, logged, copied or kept in the repo. Exit 0
# with chat-real/chief-{night,day}-390.png, reply.txt (Chief's words) and timeline.txt in <out-dir> (crewd.log only on a failure); non-zero when no reply
# arrives within REPLY_SECONDS (default 180) or the reply is a stub line. Spends a few model calls on that key's account.
set -euo pipefail
[ $# -ge 2 ] || { echo "usage: chat-real.sh <out-dir> <key-file | ->  (CHAT_ACCOUNT, CHAT_KEY_ENV, CHAT_MODEL)" >&2; exit 2; }
ACCOUNT=${CHAT_ACCOUNT:-minimax}; KEYFILE=$2
if [ -n "${CHAT_KEY_ENV:-}" ]; then [ -n "${!CHAT_KEY_ENV:-}" ] || { echo "chat-real: \$$CHAT_KEY_ENV is empty" >&2; exit 2; }; # the key stays in that variable, by name only
else [ -s "$KEYFILE" ] || { echo "chat-real: no key in the key file" >&2; exit 2; }; fi
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-chat-real.XXXXXX)
TL="$OUT/timeline.txt"; : > "$TL" # every step stamped: seconds from crewd's start to the first Chief reply
mark() { printf '%s %s\n' "$(date +%s.%N)" "$1" >> "$TL"; }
mark start
trap 'crewd_stop || exit 1; [ "${OK:-}" = 1 ] || cp "$LAB/crewd.log" "$OUT/" 2>/dev/null; chmod -R u+w "$LAB"; rm -rf "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
if [ -n "${PACKAGE_DIR:-}" ]; then # a release as a person gets it: its own Node and engine, product mode in a throwaway HOME
  mkdir -p "$LAB/home/.local/state" "$LAB/home/.config" "$LAB/home/.cache"
  ST="$LAB/home/.local/state/crewhouse"; CR="$LAB/home/Crewhouse"; LINK=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
  START=$SECONDS
  crewd_start "$PACKAGE_DIR/app" "$LAB/crewd.log" env -i PATH="$PACKAGE_DIR/node/bin:/usr/bin:/bin" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
    XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_PACKAGED=1 CREWHOUSE_RUN_MODE=product CREWHOUSE_PORT="$PORT" CREWHOUSE_LINK_PORT="$LINK" \
    "$PACKAGE_DIR/node/bin/node" src/main.ts
else
  ST="$LAB/state"; CR="$LAB/crew"; START=$SECONDS
  crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
    XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
    XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
    XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
    CREWHOUSE_PORT="$PORT" CREWHOUSE_STATE_DIR="$ST" CREWHOUSE_CREW_DIR="$CR" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
    node "$REPO/src/main.ts"
fi
PERSON=""
for _ in $(seq 2400); do # the first start installs the engine
  if [ -f "$ST/person.key" ]; then
    PERSON=$(cat "$ST/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"phase":"ready"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "chat-real: crewd never became ready" >&2; exit 1; }
echo "chat-real: ready ${PACKAGE_DIR:+(release folder) }$((SECONDS - START)) s after start" | tee "$OUT/ready.txt"
[ -z "${PACKAGE_DIR:-}" ] || ! ls "$LAB/home/.local/share/crewhouse/engine"* >/dev/null 2>&1 || { echo "chat-real: the release installed an engine of its own at first run" >&2; exit 1; }
[ -z "${PACKAGE_DIR:-}" ] || { echo "engine: the release's own, $(ls "$PACKAGE_DIR/app/runtime" | tr '\n' ' ')under its app folder; installed under the person's home: none"; } | tee -a "$OUT/ready.txt"
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 60 "${H[@]}" "${@:2}" "$B$1"; }
# Flash is the model under test. It is named in Chief's own bot.json BEFORE the sign-in: the engine's catalog lists a key
# sign-in's models as unavailable (the picker cannot choose it), and the kit registers the model the bot already names.
MODEL=${CHAT_MODEL:-MiniMax-M3.1-Flash}
[ "$ACCOUNT" = minimax ] || MODEL=${CHAT_MODEL:-minimax/minimax-m3.1-flash:free}
node -e 'const f = process.argv[1], c = JSON.parse(require("node:fs").readFileSync(f, "utf8")); c.models = [process.argv[3] + ":" + process.argv[2]]; require("node:fs").writeFileSync(f, JSON.stringify(c, null, 2))' "$CR/bots/chief/bot.json" "$MODEL" "$ACCOUNT"
echo "chat-real: model $MODEL"
# The first-day path: no name, the first request typed on Hello; it waits for the sign-in and starts by itself.
ASK='Good morning Chief. Please say hello back in one short sentence.'
api /api/onboard -d "{\"address\":\"\",\"ask\":\"$ASK\"}" > /dev/null
mark "first request sent"
api /api/accounts/1/$ACCOUNT/login -d '{"via":"key"}' > /dev/null
mark "key sheet open"
node -e 'const e = process.env.CHAT_KEY_ENV; process.stdout.write(JSON.stringify({ text: (e ? process.env[e] : require("node:fs").readFileSync(process.argv[1], "utf8")).trim() }))' "$KEYFILE" |
    api /api/accounts/1/$ACCOUNT/paste --max-time 120 --data-binary @- > /dev/null
for _ in $(seq 120); do api /api/accounts | grep -Eq "\"account\":\"$ACCOUNT\",[^}]*\"signedIn\":true" && break; sleep 0.5; done
api /api/accounts | grep -Eq "\"account\":\"$ACCOUNT\",[^}]*\"signedIn\":true" || { echo "chat-real: $ACCOUNT did not take the key" >&2; exit 1; }
mark "signed in"
# Chief's reply: his words in the thread once the job is done. A job that failed is no reply, even though crewd writes
# a line for it, so a model that rejects Chief's request fails here at once with that state.
look() { api /api/bots/chief | node -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")), s = t.tasks?.[0]?.state, m = (t.messages ?? []).filter((x) => x.author === "bot" && String(x.text ?? "").trim() && !/\bstub [\w-]+:/.test(x.text));
  if (s === "done" && m.length) process.stdout.write("done " + m.at(-1).text); else if (["failed", "unsure"].includes(s)) process.stdout.write("end " + s)'; }
R=""
DEADLINE=$((SECONDS + ${REPLY_SECONDS:-180}))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  R=$(look)
  case "$R" in done\ *) R=${R#done }; break;; end\ *) api /api/bots/chief > "$OUT/thread.json" || true; cp "$ST"/logs/openclaw*.log "$LAB/crewd.log" "$OUT"/ 2>/dev/null || true; echo "chat-real: Chief's job ${R#end } on $MODEL; thread in $OUT/thread.json" >&2; exit 1;; esac
  R=""; sleep 1
done
[ -n "$R" ] || { api /api/bots/chief > "$OUT/thread.json" || true; echo "chat-real: no reply from Chief within ${REPLY_SECONDS:-180}s" >&2; exit 1; }
mark "first Chief reply"
cp "$ST"/logs/openclaw*.log "$OUT"/ 2>/dev/null || true
# the engine's own log names the model that answered
grep -q "\[model-fetch\] response provider=$ACCOUNT .*model=$MODEL " "$OUT"/openclaw-events.log || { echo "chat-real: the reply did not come from $MODEL" >&2; exit 1; }
rm -f "$OUT"/openclaw*.log # the assertion above is the proof; the raw logs are over the judge's 64 KB read
printf 'You asked Chief: %s\nChief replied (model %s): %s\n' "$ASK" "$MODEL" "$R" > "$OUT/reply.txt"
[ -z "${PACKAGE_DIR:-}" ] || { cat "$OUT/reply.txt"; grep -E "engine ready|first words|signed in" "$LAB/crewd.log" | cut -c1-120; } >> "$OUT/ready.txt" # the release run's one self-contained record
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
# Chief's thread, opened the way a person does: a tap on Chief's card on Home.
THEN="(async () => { for (let i = 0; i < 50 && !document.querySelector('.sh-chief a'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('.sh-chief a')?.click(); for (let i = 0; i < 50 && !document.querySelector('.home-chat'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.home-chat'); })()" \
  WIDTHS=390x844 bash "$REPO/scripts/verify/screens.sh" "$OUT/chat-real" chief "$B/#person=$PERSON"
OK=1
echo "chat-real: Chief replied; thread captured in $OUT/chat-real"
