#!/usr/bin/env bash
# done-done journey `connect-apps` (hand/agent only: needs a MiniMax key file, a browser session and a person who can finish
# Composio's own sign-in page): one isolated crewd on the real engine, signed in to MiniMax, then Connect apps -> Composio's
# sign-in -> Chief uses ONE connected app for a read-only request, with the person saying yes on the ask card.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/connect-apps.sh <out-dir> <minimax-key-file> <handoff-dir>
#
# The run opens no browser for the sign-in: it writes the app's address to <handoff-dir>/app-url.txt and waits, bounded by
# SIGNIN_SECONDS (default 1500), for Connect apps to turn on. The person (or the agent driving the person's own browser) opens
# that address, taps Connect apps and finishes Composio's page. Then Chief gets ASK (read-only); the one ask card, which must name
# a Composio app, is answered "yes, once" through the API, as the card's own button would; any other ask fails the run.
# The key is read from the file into the sign-in request only. Exit 0 with connected-apps/*.png (Chief's thread, the Apps screen,
# 390 and 1440 wide, day and night), reply.txt, ask.txt and app.mp4 (the app at both widths while Chief works).
set -euo pipefail
[ $# -ge 3 ] || { echo "usage: connect-apps.sh <out-dir> <minimax-key-file> <handoff-dir>  (ASK, REPLY_SECONDS, SIGNIN_SECONDS)" >&2; exit 2; }
KEYFILE=$2; [ -s "$KEYFILE" ] || { echo "connect-apps: no key in the key file" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P); HAND=$(mkdir -p "$3" && cd "$3" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-connect-apps.XXXXXX)
trap 'touch "$LAB/stop-film" 2>/dev/null; [ -z "${FILM:-}" ] || wait "$FILM" 2>/dev/null || true; crewd_stop || exit 1; [ "${OK:-}" = 1 ] || cp "$LAB/crewd.log" "$OUT/" 2>/dev/null; chmod -R u+w "$LAB"; rm -rf "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"; ST="$LAB/state"; CR="$LAB/crew"
crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_PORT="$PORT" CREWHOUSE_STATE_DIR="$ST" CREWHOUSE_CREW_DIR="$CR" CREWHOUSE_TOOLS_DIR="$LAB/tools" node "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 2400); do
  if [ -f "$ST/person.key" ]; then
    PERSON=$(cat "$ST/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"phase":"ready"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "connect-apps: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 60 "${H[@]}" "${@:2}" "$B$1"; }
MODEL=${CHAT_MODEL:-MiniMax-M3.1-Flash}
node -e 'const f = process.argv[1], c = JSON.parse(require("node:fs").readFileSync(f, "utf8")); c.models = ["minimax:" + process.argv[2]]; require("node:fs").writeFileSync(f, JSON.stringify(c, null, 2))' "$CR/bots/chief/bot.json" "$MODEL"
api /api/onboard -d '{"address":"Umer"}' > /dev/null
api /api/accounts/1/minimax/login -d '{"via":"key"}' > /dev/null
node -e 'process.stdout.write(JSON.stringify({ text: require("node:fs").readFileSync(process.argv[1], "utf8").trim() }))' "$KEYFILE" | api /api/accounts/1/minimax/paste --max-time 120 --data-binary @- > /dev/null
for _ in $(seq 120); do api /api/accounts | grep -Eq '"account":"minimax",[^}]*"signedIn":true' && break; sleep 0.5; done
api /api/accounts | grep -Eq '"account":"minimax",[^}]*"signedIn":true' || { echo "connect-apps: minimax did not take the key" >&2; exit 1; }
# The hand-off: the address to open, then the wait for the person's own sign-in on Composio's page.
printf '%s\n' "$B/#person=$PERSON" > "$HAND/app-url.txt"
echo "connect-apps: app address in $HAND/app-url.txt; waiting for Connect apps to turn on"
DEADLINE=$((SECONDS + ${SIGNIN_SECONDS:-1500}))
until api /api/composio | grep -q '"state":"on"'; do
  [ "$SECONDS" -lt "$DEADLINE" ] || { echo "connect-apps: Connect apps never turned on" >&2; exit 1; }
  sleep 2
done
echo "connect-apps: Connect apps is on"
bash "$REPO/scripts/verify/app-film.sh" "$B/#person=$PERSON" "$OUT/app.mp4" "$LAB/stop-film" & FILM=$!
sleep 14
ASK=${ASK:-'Chief, please use my connected apps to read what is on my calendar today. Only read it: do not create, change, send or delete anything. Tell me what you found in a few short lines.'}
node -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$ASK" | api /api/bots/chief/messages --data-binary @- > /dev/null
# The one ask card: it must name a Composio app, and it is answered once (no standing answer exists for it).
: > "$OUT/ask.txt"; R=""; DEADLINE=$((SECONDS + ${REPLY_SECONDS:-420}))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  api /api/state | node -e 'const s = JSON.parse(require("node:fs").readFileSync(0, "utf8")); for (const a of s.asks.filter((x) => x.bot === "chief")) console.log(a.id + "\t" + a.kind + "\t" + a.title)' > "$LAB/asks.tsv"
  while IFS=$'\t' read -r id kind title; do
    [ -n "$id" ] || continue
    printf 'ask %s (%s): %s\n' "$id" "$kind" "$title" >> "$OUT/ask.txt"
    case "$title" in *"Composio apps"*) api /api/asks/$id/answer -d '{"answer":"allow","scope":"once"}' > /dev/null ;; *) echo "connect-apps: an ask that is not a Composio app: $title" >&2; exit 1 ;; esac
  done < "$LAB/asks.tsv"
  R=$(api /api/bots/chief | node -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")), s = t.tasks?.[0]?.state, m = (t.messages ?? []).filter((x) => x.author === "bot" && String(x.text ?? "").trim());
    if (s === "done" && m.length) process.stdout.write("done " + m.at(-1).text); else if (["failed", "unsure"].includes(s)) process.stdout.write("end " + s)')
  case "$R" in done\ *) R=${R#done }; break;; end\ *) api /api/bots/chief > "$OUT/thread.json" || true; echo "connect-apps: Chief's job ${R#end }; thread in $OUT/thread.json" >&2; exit 1;; esac
  R=""; sleep 2
done
[ -n "$R" ] || { api /api/bots/chief > "$OUT/thread.json" || true; echo "connect-apps: no reply within ${REPLY_SECONDS:-420}s" >&2; exit 1; }
[ -s "$OUT/ask.txt" ] || { echo "connect-apps: Chief answered without asking, so no connected app was used" >&2; exit 1; }
cp "$ST"/logs/openclaw*.log "$OUT"/ 2>/dev/null || true
grep -q "\[model-fetch\] response provider=minimax .*model=$MODEL " "$OUT"/openclaw-events.log || { echo "connect-apps: the reply did not come from $MODEL" >&2; exit 1; }
rm -f "$OUT"/openclaw*.log
printf 'You asked Chief: %s\nChief replied (model %s): %s\n' "$ASK" "$MODEL" "$R" > "$OUT/reply.txt"
sleep 6; touch "$LAB/stop-film"; wait "$FILM"; FILM=""
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
THEN="(async () => { for (let i = 0; i < 50 && !document.querySelector('.sh-chief a'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('.sh-chief a')?.click(); for (let i = 0; i < 50 && !document.querySelector('.home-chat'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.home-chat'); })()" \
  bash "$REPO/scripts/verify/screens.sh" "$OUT/connected-apps" chief "$B/#person=$PERSON"
bash "$REPO/scripts/verify/screens.sh" "$OUT/connected-apps" apps "$B/#/apps"
OK=1
node "$REPO/scripts/verify/steps.mjs" "$OUT" connect-apps "ask=$ASK" "model=$MODEL"
echo "connect-apps: Chief used a connected app; thread captured in $OUT/connected-apps"
