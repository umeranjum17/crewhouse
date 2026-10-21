#!/usr/bin/env bash
# done-done journey `phone-live-control` (hand/agent only: needs a browser session and a MiniMax key): one isolated crewd
# on the real engine (OpenClaw through the BYOKit kit), signed in to MiniMax through the sign-in sheet's own key paste,
# Research Rae (a helper with a computer) on MiniMax-M3.1-Flash. On the phone layout (390 wide, day and night) it shows
# a live helper run with its control bar, then each control working through the app's own buttons:
#   Stop       the run ends "Stopped by you." and no further step arrives
#   Take control   the helper pauses, its real screen opens with You have control, Hand it back returns the wheel
#   Approve    a file outside the helper's space asks; Yes, go ahead lets it through and the reply carries the file's words
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/phone-live-control.sh <out-dir> <minimax-key-file>
#
# The key is read from the file into the sign-in request only: never printed, logged or kept. Exit 0 with
# live-/stopped-/takeover-/approved-{night,day}-390.png and report.txt in <out-dir> (ask-/handed-back-/held- ones in $EXTRA_DIR when set); non-zero
# when any step does not happen within its bound. Spends a few model calls on that key's account.
set -euo pipefail
[ $# -ge 2 ] || { echo "usage: phone-live-control.sh <out-dir> <minimax-key-file>" >&2; exit 2; }
KEYFILE=$2; [ -s "$KEYFILE" ] || { echo "phone-live-control: no key in the key file" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
axi() { local out rc n=0; while :; do if out=$(timeout -k 10 120 chrome-devtools-axi "$@" 2>&1); then rc=0; else rc=$?; fi; if [ $rc -eq 0 ]; then printf '%s\n' "$out"; return 0; fi; n=$((n + 1)); echo "phone-live-control: chrome-devtools-axi $* failed (exit $rc, attempt $n): $out" >&2; [ $n -ge 2 ] && return "$rc"; sleep 2; done; }
page() { axi open about:blank > /dev/null 2>&1 && return 0; axi selectpage "$(axi pages | awk -F, 'NR>1 { gsub(/ /, "", $1); if ($1 ~ /^[0-9]+$/) id = $1 } END { print id }')" > /dev/null; axi open about:blank > /dev/null || axi newpage about:blank > /dev/null; } # leave the last page first: one document reloaded all run ran out of WebAssembly memory
node "$REPO/scripts/verify/personal-voice.mjs" --self-test > /dev/null && node "$REPO/scripts/verify/personal-voice.mjs" > /dev/null
LAB=$(mktemp -d -t crewhouse-live.XXXXXX)
trap 'crewd_stop || exit 1; chmod -R u+w "$LAB"; rm -rf "$LAB" || { sleep 5; chmod -R u+w "$LAB"; rm -rf "$LAB"; }' EXIT
mkdir -p "$LAB/home/Documents" "$LAB"/{state,crew,tools,run}
NOTE="$LAB/home/Documents/lab-note.txt"
echo "The lab note says the garden gate code is 4417." > "$NOTE"
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$LAB/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
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
[ -n "$PERSON" ] || { echo "phone-live-control: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 60 "${H[@]}" "${@:2}" "$B$1"; }
fail() { echo "phone-live-control: $*" >&2; api /api/bots/research-rae > "$OUT/thread.json" 2>/dev/null || true; cp "$LAB/crewd.log" "$OUT/crewd.log" 2>/dev/null || true; exit 1; } # the engine log and thread are kept only when the run fails
api /api/onboard -d '{"address":"Umer"}' > /dev/null
api /api/accounts/1/minimax/login -d '{"via":"key"}' > /dev/null
node -e 'process.stdout.write(JSON.stringify({ text: require("node:fs").readFileSync(process.argv[1], "utf8").trim() }))' "$KEYFILE" |
  api /api/accounts/1/minimax/paste --max-time 120 --data-binary @- > /dev/null
for _ in $(seq 120); do api /api/accounts | grep -q '"account":"minimax","name":"MiniMax","signedIn":true' && break; sleep 0.5; done
api /api/accounts | grep -q '"account":"minimax","name":"MiniMax","signedIn":true' || fail "MiniMax did not take the key"
api /api/recruit -d '{"template":"scout","name":"Research Rae"}' > /dev/null
MODEL=${CHAT_MODEL:-MiniMax-M3.1-Flash}
for b in chief research-rae; do # the picker cannot choose Flash (chat-real.sh): name it in each bot's own bot.json
  node -e 'const f = process.argv[1], c = JSON.parse(require("node:fs").readFileSync(f, "utf8")); c.models = ["minimax:" + process.argv[2]]; require("node:fs").writeFileSync(f, JSON.stringify(c, null, 2))' "$LAB/crew/bots/$b/bot.json" "$MODEL"
done
echo "phone-live-control: model $MODEL" | tee "$OUT/report.txt"

# What crewd itself says about Rae's newest job: its state, result and how many engine steps it has taken.
job() { api /api/bots/research-rae | node -e 'const s = JSON.parse(require("node:fs").readFileSync(0)), t = s.tasks?.[0] ?? {}, n = (s.trail ?? []).filter((e) => e.kind === "run.tool" && e.data?.task === t.id).length; process.stdout.write(`${t.id ?? 0} ${t.state ?? "none"} ${n} ${String(t.result ?? "").replace(/\s+/g, " ").slice(0, 200)}`)'; }
field() { local j; j=$(job); case "$1" in id) echo "${j%% *}";; state) j=${j#* }; echo "${j%% *}";; steps) j=${j#* }; j=${j#* }; echo "${j%% *}";; result) j=${j#* }; j=${j#* }; echo "${j#* }";; esac; }
wait_for() { local what=$1 bound=$2; shift 2; for _ in $(seq "$bound"); do "$@" && return 0; sleep 1; done; fail "$what did not happen within ${bound}s ($(job))"; }
steps_since() { [ "$(field id)" = "$1" ] && [ "$(field steps)" -ge "$2" ]; }
send() { api /api/bots/research-rae/messages -d "$(node -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$1")" > /dev/null; }
state_is() { [ "$(field state)" = "$1" ]; }
controls_are() { api /api/state | node -e 'const s = JSON.parse(require("node:fs").readFileSync(0)); process.exit(s.bots.find((b) => b.id === "research-rae")?.controls === process.argv[1] ? 0 : 1)' "$1"; }
ask_open() { api /api/state | node -e 'process.exit(JSON.parse(require("node:fs").readFileSync(0)).asks.length ? 0 : 1)'; }
SEQ=0
open() { SEQ=$((SEQ + 1)); CUR=("$1" "$2" "$3"); page; axi emulate --viewport "390x844x3,mobile,touch" > /dev/null
  for try in 1 2 3; do # a fresh browser can drop the first #person= open: open again until the page shows
    [ "$try" = 1 ] || page
    axi open "$B/?$1&r=$SEQ$try#person=$PERSON" > /dev/null
    axi eval "(async () => { await new Promise((r) => setTimeout(r, 1500)); location.hash = '$2'; for (let i = 0; i < 80 && !document.querySelector('$3'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('$3'); })()" | grep -q true && return 0
  done
  axi screenshot "$OUT/failed-$1.png" > /dev/null || true; axi console > "$OUT/failed-$1.console" 2>&1 || true; fail "$2 never showed $3 ($1)"; }
shot() { local d=$OUT; case "$1" in live|stopped|takeover|approved) ;; *) d=${EXTRA_DIR:-}; esac; [ -z "$d" ] || axi screenshot "$d/$1-$2-390.png" > /dev/null; } # the four proof captures go to the evidence; the in-between ones only when EXTRA_DIR is set
# both <name> <route> <selector>: the same state, night then day.
both() { for theme in night day; do open "$theme" "$2" "$3"; shot "$1" "$theme" || { open "$theme" "$2" "$3"; shot "$1" "$theme"; }; done; } # a tab that died under the shot is opened again once
text() { axi eval "document.querySelector('$1')?.innerText ?? ''" | sed -n 's/^result: //p' | node -e 'process.stdout.write(JSON.parse(JSON.parse(require("node:fs").readFileSync(0, "utf8"))).replace(/\s+/g, " ").trim())'; }
clicked() { axi eval "(() => { const b = [...document.querySelectorAll('$1')].find((x) => /$2/.test(x.innerText)); b?.click(); return !!b; })()" | grep -q true; }
click() { clicked "$@" || { open "${CUR[@]}"; clicked "$@"; } || fail "no $1 button reading $2 among: $(axi eval "[...document.querySelectorAll('$1')].map((x) => JSON.stringify(x.innerText)).join(' ')" | tr '\n' ' ')"; } # the page the last open left may have died: open it once more
note() { echo "$*" | tee -a "$OUT/report.txt"; }

CHAT='#/h/research-rae/chat'
# ---- 1. Approve (first: the helper's session is still clean, so it goes straight to the file) ----
send "Read exactly the file $NOTE with your file tool, without listing any folder, and tell me, in one sentence, what it says."
J3=$(field id); [ "$J3" != 0 ] || fail "no approval job"
wait_for "the file ask" 150 ask_open
both ask "$CHAT" '.live-ctl'
case "$(text '.live-ctl')" in *Waiting*) ;; *) fail "the bar does not say Waiting while the ask is open: $(text '.live-ctl')";; esac
ask_ids() { api /api/state | node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(0)).asks.map((a) => a.id).join(","))'; }
changed() { state_is done || { ask_open && [ "$(ask_ids)" != "$1" ]; }; }
taps=0
while :; do # the helper may look in the folder first: each ask is its own tap, and the job ends done after the last
  taps=$((taps + 1)); [ "$taps" -le 4 ] || fail "the helper kept asking after four yeses"
  seen=$(ask_ids); click '.btns .btn' '^Yes, go ahead'
  wait_for "the job to move after the yes" 150 changed "$seen"
  state_is done && break
  wait_for "the next ask" 60 ask_open; open day "$CHAT" '.btns .btn'; shot ask-again day
done
case "$(field result)" in *[Gg]ate*) ;; *) fail "the reply is not about the note: $(field result)";; esac
api /api/bots/research-rae | grep -q '"words":"Read lab-note.txt"' || fail "the engine never recorded the read of the note"
note "approve: job $J3 done after $taps tap(s) on Yes, go ahead: $(field result)"
both approved "$CHAT" '.chat'
# ---- 2. A live run, then Stop ----
send "Please fetch https://example.com, then https://example.org, then https://www.iana.org/help/example-domains, one at a time. For each page tell me its title and one sentence about it. Then write a 150-word summary of all three."
J1=$(field id); [ "$J1" != "$J3" ] || fail "no live job"; wait_for "the first job to start" 30 state_is working
wait_for "three engine steps" 150 steps_since "$J1" 3
both live "$CHAT" '.live-ctl'
bar=$(text '.live-ctl'); note "live bar: $bar"
case "$bar" in *"At work"*"Take control"*Stop*) ;; *) fail "the live bar is not At work, Take control, Stop: $bar";; esac
click '.live-ctl .btn' '^Stop$'
wait_for "Stop to end the job" 60 state_is failed
[ "$(field result)" = "Stopped by you." ] || fail "Stop left the result: $(field result)"
stopped_line() { case "$(text '.live-end')" in *stopped*) return 0;; esac; return 1; }
wait_for "the thread to say it stopped" 30 stopped_line
[ -z "$(text '.live-ctl')" ] || fail "the live bar is still up after Stop"
note "stop line: $(text '.live-end')"
shot stopped day # the end line shows only on the page that watched it end: the night capture is the same page, switched
axi eval "document.documentElement.dataset.theme = 'night'" > /dev/null; shot stopped night
S=$(field steps); sleep 8; [ "$(field steps)" = "$S" ] || fail "a step arrived after Stop"
note "stop: job $J1 ended 'Stopped by you.' with $S steps and none after"

# ---- 3. Take control, then hand it back ----
send "Please fetch https://example.com, then https://example.org, then https://www.iana.org/help/example-domains, one at a time. For each page give me its title and two sentences about it. Then write a 200-word comparison of all three."
J2=$(field id); [ "$J2" != "$J1" ] || fail "no second job"
wait_for "two engine steps" 150 steps_since "$J2" 2
open day "$CHAT" '.live-ctl'
click '.live-ctl .btn' '^Take control$'
wait_for "the controls to move to you" 30 controls_are person
both takeover '#/h/research-rae/screen' '.hand-back'
note "take control: $(text '.page') | controls person"
S=$(field steps); sleep 8; [ "$(field steps)" -le "$((S + 1))" ] || fail "the helper kept working while you held the controls"
open day "$CHAT" '.live-ctl'
case "$(text '.live-ctl')" in *"You have control"*"Open screen"*) ;; *) fail "the bar does not say you hold the controls: $(text '.live-ctl')";; esac
shot held day
open day '#/h/research-rae/screen' '.hand-back'
click '.hand-back .btn' '^Hand it back$'
wait_for "the controls to go back" 30 controls_are bot
note "hand back: controls back to the helper"
both handed-back "$CHAT" '.live-ctl'
if state_is working; then click '.live-ctl .btn' '^Stop$'; wait_for "the second Stop" 60 state_is failed; fi

note "phone-live-control: all three controls worked on $MODEL; captures in $OUT"
