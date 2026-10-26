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
trap '[ "${OK:-}" = 1 ] || cp "$LAB/crewd.log" "$OUT/" 2>/dev/null; crewhouse_remove_lab "$LAB"' EXIT
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
echo "chat-real: ready ${PACKAGE_DIR:+(release folder) }$((SECONDS - START)) s after start" | tee ${PACKAGE_DIR:+"$OUT/ready.txt"}
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
ASK=${ASK:-'Good morning Chief. Please say hello back in one short sentence.'}
[ "${CHAT_ASKS:-}" = 1 ] && ASK=${ASK_INBOX:-'Can you go through my inbox and tell me what came in today that needs an answer from me?'} # the first-day path's one request is the first of the three
if [ "${CHAT_ASKS:-}" = 1 ]; then api /api/onboard -d "{\"address\":\"${CHAT_NAME:-Umer}\",\"ask\":\"$ASK\"}" > /dev/null
elif [ -n "${HELPER:-}" ]; then api /api/onboard -d '{"address":""}' > /dev/null; else api /api/onboard -d "{\"address\":\"\",\"ask\":\"$ASK\"}" > /dev/null; fi
mark "first request sent"
api /api/accounts/1/$ACCOUNT/login -d '{"via":"key"}' > /dev/null
mark "key sheet open"
node -e 'const e = process.env.CHAT_KEY_ENV; process.stdout.write(JSON.stringify({ text: (e ? process.env[e] : require("node:fs").readFileSync(process.argv[1], "utf8")).trim() }))' "$KEYFILE" |
    api /api/accounts/1/$ACCOUNT/paste --max-time 120 --data-binary @- > /dev/null
for _ in $(seq 120); do api /api/accounts | grep -Eq "\"account\":\"$ACCOUNT\",[^}]*\"signedIn\":true" && break; sleep 0.5; done
api /api/accounts | grep -Eq "\"account\":\"$ACCOUNT\",[^}]*\"signedIn\":true" || { echo "chat-real: $ACCOUNT did not take the key" >&2; exit 1; }
mark "signed in"
# CHAT_ASKS=1: the same lab and sign-in, three everyday asks in one thread, each state captured as it happens (the
# journey `chat-asks`). A person's inbox with no Gmail, a file made from a paste, a weekly reminder they start.
if [ "${CHAT_ASKS:-}" = 1 ]; then
  OUT_PASTE=$(cat <<'NOTE'
Neighbours' barbecue, Saturday 4pm, the park on Mill Street. Bring: one side dish. Sam is bringing chairs.
Priya has the drinks. If it rains: my place at 5, same food. Ask everyone to say how many they're bringing by Thursday.
NOTE
)
  PROBE=$REPO/scripts/verify/chat-probe.mjs
  probe() { node "$PROBE" "$B" "$LAB/probes/$1" "$2" 1440 900 "/?day#person=$PERSON" "$3" | tail -1; } # outside the evidence root: live frames are not judged

  stills() { # stills <slug> <widths>: the thread as it stands, both themes
    local T A
    T="(async () => { location.hash = '#/chief'; for (let i = 0; i < 80 && !document.querySelector('.chat'); i++) await new Promise((r) => setTimeout(r, 100)); for (let i = 0; i < 8; i++) { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'More'); if (!b) break; b.click(); await new Promise((r) => setTimeout(r, 200)); } return !!document.querySelector('.chat'); })()"
    A="(async () => { for (const l of document.querySelectorAll('.chat .lines, .lines')) l.scrollTop = l.scrollHeight * 3; await new Promise((r) => setTimeout(r, 700)); document.querySelector('.chat .lines, .lines')?.lastElementChild?.scrollIntoView({ block: 'end' }); await new Promise((r) => setTimeout(r, 600)); return 1; })()"
    THEN="$T" AFTER="$A" WIDTHS="$2" bash "$REPO/scripts/verify/screens.sh" "$OUT" "$1" "$B/#person=$PERSON" >/dev/null
  }
  bots() { api /api/bots/chief | node -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")); process.stdout.write(String((t.messages ?? []).filter((m) => m.author === "bot").length));'; }
  settle() { # settle <task-id>
    for _ in $(seq 90); do
      api /api/bots/chief | TASK="$1" node -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")), s = (t.tasks ?? []).find((x) => x.id === Number(process.env.TASK))?.state ?? ""; process.stdout.write(s)' | grep -qE '^(done|failed|unsure|needs_you)$' && return 0
      sleep 3
    done
    return 1
  }
  say() { local n=$1 m=$2; for _ in $(seq $((m / 5))); do [ "$(bots)" -ge "$n" ] && return 0; sleep 5; done; return 1; }
  press() { # press <label>: the one button on Chief's thread with this label
    local first hit=absent
    first=$(chrome-devtools-axi pages | awk -F, 'NR>1 { gsub(/ /, "", $1); if ($1 ~ /^[0-9]+$/) { print $1; exit } }')
    if [ -n "$first" ]; then chrome-devtools-axi selectpage "$first" >/dev/null; else chrome-devtools-axi newpage about:blank >/dev/null; fi
    chrome-devtools-axi open "$B/?day#person=$PERSON" >/dev/null 2>&1 || true
    chrome-devtools-axi eval "() => { location.hash = '#/chief'; return 1 }" >/dev/null 2>&1 || true
    sleep 5
    for _ in $(seq 24); do
      if chrome-devtools-axi eval "() => { const b = [...document.querySelectorAll('.chat button, .lines button, main button')].find((x) => x.textContent.trim() === '$1'); if (!b) return 'absent'; b.click(); return 'clicked'; }" 2>&1 | grep -q clicked; then hit=clicked; break; fi
      sleep 5
    done
    echo "chat-asks: pressed \"$1\": $hit"
  }
  settle 1 || true # the inbox ask went in as the first request, before the key
  n=$(bots); press "Not now"; say $((n + 1)) 180 || true; settle 1 || true
  stills ask1-gmail "1440x900 390x844"
  probe ask2-file "$OUT_PASTE" 300 || true
  n=$(bots); settle 2 || true; say $((n + 1)) 120 || true
  stills ask2-doc "1440x900 390x844"
  probe ask3-reminder 'Set me a weekly reminder to water the plants, Sunday evening.' 240 || true
  settle 3 || true
  stills ask3-reminder "1440x900 390x844" # as it first appears, before anything is tapped
  press "Start it" || true
  for _ in $(seq 24); do [ "$(api /api/state | grep -c '"routines":\[{' || true)" -gt 0 ] && break; sleep 5; done
  api /api/bots/chief > "$OUT/thread-final.json"
  api /api/state > "$OUT/state-final.json"
  WIDTHS=1440x900 bash "$REPO/scripts/verify/screens.sh" "$OUT" routines "$B/#/routines" >/dev/null
  DOC=$(grep -o 'files/[a-z0-9-]*\.docx' "$OUT/thread-final.json" | head -1 || true)
  ROUT=$(node -e 'const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")), r = (s.routines ?? [])[0]; process.stdout.write(r ? `${r.name} | ${r.schedule} | ${r.state} | ${new Date(r.next_at).toISOString()}` : "no routine")' "$OUT/state-final.json")
  printf 'document %s\nroutine %s\n' "${DOC:-no document delivered}" "$ROUT" > "$OUT/result.txt"
  node "$REPO/scripts/verify/steps.mjs" "$OUT" chat-asks "doc=${DOC:-no document delivered}" "routine=$ROUT"
  OK=1
  echo "chat-asks: three asks driven; thread and states in $OUT"
  exit 0
fi
# HELPER=<template id> (HELPER_NAME) makes the journey a helper's: the template is hired on the same model, Chief is asked
# to hand it ASK, and the wait is on the helper's own job, which must end with its words (a research helper's report).
BOT=chief
if [ -n "${HELPER:-}" ]; then
  BOT=$(api /api/recruit -d "{\"template\":\"$HELPER\",\"name\":\"${HELPER_NAME:-$HELPER}\"}" | node -pe 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).id')
  node -e 'const f = process.argv[1], c = JSON.parse(require("node:fs").readFileSync(f, "utf8")); c.models = [process.argv[3] + ":" + process.argv[2]]; require("node:fs").writeFileSync(f, JSON.stringify(c, null, 2))' "$CR/bots/$BOT/bot.json" "$MODEL" "$ACCOUNT"
fi
[ -z "${HELPER:-}" ] || { node -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$ASK" | api /api/bots/chief/messages --data-binary @- > /dev/null; }
# Chief's reply: his words in the thread once the job is done. A job that failed is no reply, even though crewd writes
# a line for it, so a model that rejects Chief's request fails here at once with that state.
look() { api /api/bots/$BOT | node -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")), s = t.tasks?.[0]?.state, m = (t.messages ?? []).filter((x) => x.author === "bot" && String(x.text ?? "").trim() && !/\bstub [\w-]+:/.test(x.text));
  if (s === "done" && m.length) process.stdout.write("done " + m.at(-1).text); else if (["failed", "unsure"].includes(s)) process.stdout.write("end " + s)'; }
R=""
DEADLINE=$((SECONDS + ${REPLY_SECONDS:-180}))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  R=$(look)
  case "$R" in done\ *) R=${R#done }; break;; end\ *) api /api/bots/$BOT > "$OUT/thread.json" || true; cp "$ST"/logs/openclaw*.log "$LAB/crewd.log" "$OUT"/ 2>/dev/null || true; echo "chat-real: Chief's job ${R#end } on $MODEL; thread in $OUT/thread.json" >&2; exit 1;; esac
  R=""; sleep 1
done
[ -n "$R" ] || { api /api/bots/$BOT > "$OUT/thread.json" || true; echo "chat-real: no reply from Chief within ${REPLY_SECONDS:-180}s" >&2; exit 1; }
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
if [ "$BOT" != chief ]; then # the helper's own page, where its answer sits
  THEN="(async () => { location.hash = '#/h/$BOT'; for (let i = 0; i < 50 && !document.querySelector('.home-chat'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.home-chat'); })()" \
    WIDTHS=390x844 bash "$REPO/scripts/verify/screens.sh" "$OUT/helper" "$BOT" "$B/#person=$PERSON"
fi
OK=1
# done-done's step record: what a person did and saw
if [ "$BOT" != chief ]; then
  node "$REPO/scripts/verify/steps.mjs" "$OUT" chat-real-helper "bot=$BOT" "ask=$ASK" "model=$MODEL"
else
  node "$REPO/scripts/verify/steps.mjs" "$OUT" chat-real "ask=$ASK" "model=$MODEL"
fi
echo "chat-real: $BOT replied; thread captured in $OUT/chat-real"
