#!/usr/bin/env bash
# done-done journey `connect-apps` (hand/agent only: needs a MiniMax key file, a browser session and a person who can finish
# Composio's own sign-in page): one isolated crewd on the real engine, signed in to MiniMax, then Connect apps -> Composio's
# sign-in -> Chief uses ONE connected app for a read-only request, with the person saying yes on the ask card.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/connect-apps.sh <out-dir>   (CONNECT_CONFIG, ASK, REPLY_SECONDS, SIGNIN_SECONDS)
#
# done-done runs a journey with a clean environment, so the settings come from a file of NAME=value lines (default
# ~/.config/crewhouse/connect-apps.conf; the environment still wins): CONNECT_KEY_FILE is the path of the MiniMax key (never its
# value) and CONNECT_HANDOFF a folder for the app's address.
# The run opens no browser for the sign-in: it writes the app's address to $CONNECT_HANDOFF/app-url.txt and waits, bounded by
# SIGNIN_SECONDS (default 1500), for Connect apps to turn on. The person (or the agent driving the person's own browser) opens
# that address, taps Connect apps and finishes Composio's page. Then Chief gets ASK (read-only); the one ask card, which must name
# a Composio app, is answered "yes, once" through the API, as the card's own button would; any other ask fails the run.
# If no app is connected yet, Chief offers Composio's connect link: it is written to $CONNECT_HANDOFF/connect-link.txt and the run waits,
# bounded by GRANT_SECONDS (default 900), for the person to approve it and create $CONNECT_HANDOFF/granted; Chief is then asked again.
# The key is read from the file into the sign-in request only. Exit 0 with connected-apps/*.png (Chief's thread, the Apps screen,
# 390 and 1440 wide, day and night), reply.txt, ask.txt and app.mp4 (the app at both widths while Chief works).
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: connect-apps.sh <out-dir>" >&2; exit 2; }
CONF=${CONNECT_CONFIG:-$HOME/.config/crewhouse/connect-apps.conf}
[ ! -f "$CONF" ] || while IFS='=' read -r k v; do case $k in CONNECT_KEY_FILE|CONNECT_HANDOFF|ASK) [ -n "${!k:-}" ] || export "$k=$v";; esac; done < "$CONF"
KEYFILE=${CONNECT_KEY_FILE:-}; [ -s "$KEYFILE" ] || { echo "connect-apps: CONNECT_KEY_FILE names no key file" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P); HAND=$(mkdir -p "${CONNECT_HANDOFF:?CONNECT_HANDOFF names no folder}" && cd "$CONNECT_HANDOFF" && pwd -P)
export PATH=/usr/bin:$PATH # the distro node: done-done runs with a clean environment, where a version-manager shim fails
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-connect-apps.XXXXXX)
trap 'touch "$LAB/stop-film" 2>/dev/null; [ -z "${FILM:-}" ] || wait "$FILM" 2>/dev/null || true; crewd_stop || true; [ "${OK:-}" = 1 ] || cp "$LAB/crewd.log" "$OUT/" 2>/dev/null; chmod -R u+w "$LAB"; rm -rf "$LAB"' EXIT
trap 'exit 143' HUP INT TERM # an aborted run still reaches the EXIT trap, which stops crewd's group and removes the lab
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
# The provider may answer the key's check with a rate limit when the key is shared and busy: try again a few times.
signed() { api /api/accounts | grep -Eq '"account":"minimax",[^}]*"signedIn":true'; }
for try in 1 2 3 4 5 6; do
  api /api/accounts/1/minimax/login -d '{"via":"key"}' > /dev/null
  node -e 'process.stdout.write(JSON.stringify({ text: require("node:fs").readFileSync(process.argv[1], "utf8").trim() }))' "$KEYFILE" | api /api/accounts/1/minimax/paste --max-time 120 --data-binary @- > /dev/null || true
  for _ in $(seq 240); do signed && break 2; api /api/accounts | grep -q '"state":"failed"' && break; sleep 0.5; done
  echo "connect-apps: the key sign-in did not go through (try $try); waiting before the next" >&2; sleep 60
done
signed || { echo "connect-apps: minimax did not take the key" >&2; exit 1; }
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
ASK=${ASK:-'Chief, use my Composio apps (not a direct Google connection) to read the subject line of my most recent email in Gmail. If Gmail is not connected in Composio yet, give me the Composio connect link. Only read it: do not create, change, send or delete anything. Tell me what you found in a few short lines.'}
node -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$ASK" | api /api/bots/chief/messages --data-binary @- > /dev/null
# Each ask card must name a Composio app and is answered once (no standing answer exists for it). await_chief waits, bounded,
# for Chief's job to end: END is done, unsure, failed or none; his last words are in $LAB/last.txt and a Composio connect link
# he offered (an app the person has not connected yet) in LINK.
: > "$OUT/ask.txt"
await_chief() {
  END=none; LINK=""; local DEADLINE=$((SECONDS + ${REPLY_SECONDS:-420})) o
  while [ "$SECONDS" -lt "$DEADLINE" ]; do
    api /api/state | node -e 'const s = JSON.parse(require("node:fs").readFileSync(0, "utf8")); for (const a of s.asks.filter((x) => x.bot === "chief")) console.log(a.id + "\t" + a.kind + "\t" + a.title)' > "$LAB/asks.tsv"
    while IFS=$'\t' read -r id kind title; do
      [ -n "$id" ] || continue
      printf 'ask %s (%s): %s\n' "$id" "$kind" "$title" >> "$OUT/ask.txt"
      case "$title" in *"Composio apps"*) api /api/asks/$id/answer -d '{"answer":"allow","scope":"once"}' > /dev/null ;; *) echo "connect-apps: an ask that is not a Composio app: $title" >&2; exit 1 ;; esac
    done < "$LAB/asks.tsv"
    o=$(api /api/bots/chief | node -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")), s = t.tasks?.[0]?.state, m = (t.messages ?? []).filter((x) => x.author === "bot" && String(x.text ?? "").trim());
      const link = m.map((x) => /https:\/\/connect\.composio\.dev\/link\/[\w-]+/.exec(x.text)?.[0]).filter(Boolean).at(-1) ?? "";
      require("node:fs").writeFileSync(process.argv[1], m.at(-1)?.text ?? "");
      process.stdout.write((["done", "failed", "unsure"].includes(s) && (s !== "done" || m.length) ? s : "none") + " " + link)' "$LAB/last.txt")
    END=${o%% *}; LINK=${o#* }
    [ "$END" = none ] || return 0
    sleep 2
  done
}
await_chief
if [ "$END" != done ] && [ -n "$LINK" ]; then # an app is not connected yet: the person says yes to Composio's own link, once
  printf '%s\n' "$LINK" > "$HAND/connect-link.txt"
  echo "connect-apps: Chief offered a connect link in $HAND/connect-link.txt; waiting for $HAND/granted"
  DEADLINE=$((SECONDS + ${GRANT_SECONDS:-900}))
  until [ -e "$HAND/granted" ]; do [ "$SECONDS" -lt "$DEADLINE" ] || { echo "connect-apps: the connect link was never approved" >&2; exit 1; }; sleep 2; done
  ASK=${ASK2:-'I connected it in Composio. Please use my Composio apps to read the subject line of my most recent email in Gmail. Only read it: do not create, change, send or delete anything. Tell me what you found in a few short lines.'}
  node -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$ASK" | api /api/bots/chief/messages --data-binary @- > /dev/null
  await_chief
fi
[ "$END" = done ] || { api /api/bots/chief > "$OUT/thread.json" || true; echo "connect-apps: Chief's job ended $END; thread in $OUT/thread.json" >&2; exit 1; }
R=$(cat "$LAB/last.txt")
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
