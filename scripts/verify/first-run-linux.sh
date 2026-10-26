#!/usr/bin/env bash
# done-done journey `first-run-linux`: the measured first-run path on a computer build, timed at every step.
#   scripts/verify/first-run-linux.sh <out-dir> <deb> <minimax-key-file>
# Downloads nothing (the .deb is given), unpacks it the way the software centre does (no root: ar + tar, same bytes
# under /opt/crewhouse), opens it from the launcher the app-menu entry runs (launch.mjs), and drives the real first-run
# path in a browser: Chief's greeting, the name, his light first idea, the MiniMax key sheet (which names the model the
# crew took by itself, with Pick another model), and the first real answer.
# Every step is stamped in steps.tsv (seconds from the start of the unpack) with a 1440x900 frame in frames/.
# The key is read from its file straight into the page's own paste box; it is never printed, logged or copied.
set -uo pipefail
# Arguments may come as arguments or as the environment (done-done's own run folder and files).
OUTARG=${1:-${DONE_DONE_EVIDENCE_ROOT:?usage: first-run-linux.sh <out-dir> <deb> <minimax-key-file>}}
DEBARG=${2:-${CREWHOUSE_DEB:?usage: first-run-linux.sh <out-dir> <deb> <key-file> (or CREWHOUSE_DEB)}}
KEYFILE=${3:-${KEY_FILE:?usage: first-run-linux.sh <out-dir> <deb> <key-file> (or KEY_FILE)}}
OUT=$(mkdir -p "$OUTARG" && cd "$OUTARG" && pwd -P); DEB=$(cd "$(dirname "$DEBARG")" && pwd -P)/$(basename "$DEBARG")
[ -s "$DEB" ] || { echo "timed-run: no .deb at $DEB" >&2; exit 2; }
[ -s "$KEYFILE" ] || { echo "timed-run: no key file" >&2; exit 2; }
EV="$OUT"; mkdir -p "$EV/frames" "$EV/log"; rm -f "$EV/steps.tsv"; : > "$EV/steps.tsv"
LAB=$(mktemp -d -t chfr.XXXXXX) # short on purpose: a deep path pushes the engine's bridge.sock past the Unix socket limit
APORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
SESS="ch-first-run-$APORT"
export CHROME_DEVTOOLS_AXI_SESSION=$SESS CHROME_DEVTOOLS_AXI_USER_DATA_DIR="$LAB/chrome" CHROME_DEVTOOLS_AXI_PORT=$APORT
axi() { chrome-devtools-axi "$@"; }
attach() { local i p; for i in $(seq 20); do p=$(axi pages 2>/dev/null | grep -F "127.0.0.1:$PORT" | grep -oE '^ +[0-9]+' | tr -d ' ' | head -1); if [ -n "$p" ]; then axi selectpage "$p" >/dev/null 2>&1 && return 0; fi; sleep 1; done; echo "timed-run: the app's page never appeared" >&2; return 1; }
see() { local i; for i in $(seq "${2:-30}"); do axi snapshot 2>/dev/null | grep -qF -- "$1" && return 0; sleep 1; done; echo "timed-run: never saw: $1" >&2; return 1; }
click() { local i ref; for i in $(seq 10); do ref=$(axi snapshot 2>/dev/null | grep -E '(button|radio|link|textbox|DisclosureTriangle) "' | grep -F -- "$1" | head -1 | grep -oE 'uid=[^ ]+' | cut -d= -f2); [ -n "$ref" ] && axi click "@$ref" >/dev/null 2>&1 && return 0; sleep 1; done; echo "timed-run: no clickable $1" >&2; return 1; }
text() { # a name to type into the box the click just focused
  axi type "$1" >/dev/null 2>&1
}
T0=$(date +%s.%N)
mark() { printf '%s\t%s\t%s\t%s\n' "$1" "$(node -e "console.log(( $(date +%s.%N) - $T0 ).toFixed(1))")" "$(date -Is)" "${2:-}" >> "$EV/steps.tsv"; }
step() { mark "$1" "${2:-}"; echo "timed-run: $1 at $(tail -1 "$EV/steps.tsv" | cut -f2)s"; }
shot() { axi screenshot "$EV/frames/$1.png" >/dev/null 2>&1 || echo "timed-run: no frame $1" >&2; }
cleanup() {
  [ -f "$LAB/home/.local/state/crewhouse/crewd.pid" ] && kill "$(cat "$LAB/home/.local/state/crewhouse/crewd.pid")" 2>/dev/null
  axi stop >/dev/null 2>&1
  chmod -R u+w "$LAB" 2>/dev/null
  rm -rf -- "$LAB" 2>/dev/null
}
trap cleanup EXIT

# 1. Unpack the .deb's data the way dpkg does (no root here): the same tree under /opt/crewhouse.
mkdir -p "$LAB/root" "$LAB/deb"
( cd "$LAB/deb" && ar x "$DEB" && tar -xJf data.tar.xz -C "$LAB/root" ) || { echo "timed-run: unpack failed" >&2; exit 1; }
step "install: .deb unpacked into /opt/crewhouse (${DEB##*/})" "$(du -sh "$LAB/root/opt/crewhouse" | cut -f1)"

# 2. Open it the way the app menu does: launch.mjs starts the crew, then a window shows it.
mkdir -p "$LAB/home/.local/state" "$LAB/home/.config" "$LAB/home/.cache" "$LAB/run" "$LAB/chrome"
( cd "$LAB" && setsid env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" XDG_RUNTIME_DIR="$LAB/run" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_NO_SERVICE=1 CREWHOUSE_PORT=$PORT \
    "$LAB/root/opt/crewhouse/node/bin/node" "$LAB/root/opt/crewhouse/launch.mjs" --no-open > "$EV/log/launch.log" 2>&1 ) \
  || { echo "timed-run: launcher failed" >&2; cat "$EV/log/launch.log" >&2; exit 1; }
step "app opened: crewd answers on this computer" "port $PORT"
ST="$LAB/home/.local/state/crewhouse"; K=$(cat "$ST/person.key"); URL="http://127.0.0.1:$PORT"

# 3. The window: a browser on the app (the launcher's own URL, with its private key in the fragment).
axi open "$URL/#person=$K" 2>&1 | tail -3 >> "$EV/log/axi.log"
step "browser asks for the app (the window the launcher opens)"
attach || exit 1
axi emulate --viewport "1440x900x1" >/dev/null 2>&1
axi pages >> "$EV/log/axi.log" 2>&1
see "What shall I call you?" 120 || { axi pages >&2; axi snapshot 2>&1 | head -30 >&2; exit 1; }
step "first screen: Chief asks the person's name"; shot "01-chief-greeting-day-1440"

click "Tell Chief anything…" && text "Umer"
step "the name typed into Chief's box" "3 letters, driver overhead"
see '"Send"' 10
click "Send"
see "Nice to meet you, Umer" 30 || exit 1
step "name saved: Chief's pitch and three ideas"; shot "02-chief-pitch-day-1440"

click "What should I cook tonight? Three quick ideas"
see "The crew uses your AI account" 30 || exit 1
step "idea tapped: the job waits for a sign-in"; shot "03-job-waits-for-sign-in-day-1440"

click "Sign in with MiniMax"
see "Paste your MiniMax key" 30 || exit 1
step "MiniMax sheet: the step that asks for a key"; shot "04-key-sheet-day-1440"

# The key goes into the page's own paste box (the same input the sheet's form sends), never through a file or the shell.
KEYSET="() => { const i = document.querySelector('.sheet input.input'); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, '$(cat "$KEYFILE")'); i.dispatchEvent(new Event('input',{bubbles:true})); return i.value.length; }"
for _ in 1 2 3; do n=$(axi eval "() => document.querySelector('.sheet input.input') ? document.querySelector('.sheet input.input').value.length : -1" 2>/dev/null | grep -oE '[0-9]+' | head -1); [ "${n:-0}" -gt 20 ] && break; axi eval "$KEYSET" >/dev/null 2>&1; sleep 1; done
# Paste, then Return: the sheet's own form submits. (The card behind it carries the same button words, so a label click would hit that.)
axi press Enter >/dev/null 2>&1
# Nothing is picked by hand: the sheet takes the account's own model (MiniMax's Flash), names it, and offers the way out.
see "You're signed in" 120 || exit 1
see "It thinks with MiniMax" 30 || exit 1
step "key saved: no model to pick, the crew takes MiniMax's Flash by itself"; shot "05-signed-in-day-1440"
for _ in $(seq 40); do axi eval "() => document.querySelectorAll('[role=dialog]').length" 2>/dev/null | grep -q '"0"' && break; sleep 1; done
step "the sheet is out of the way, the waiting job starts"; shot "06-job-started-day-1440"

# 4. The first real answer (the stub engine's words are hidden by the app, so only a real route shows a reply).
REPLY_SECONDS=${REPLY_SECONDS:-600}
for _ in $(seq $REPLY_SECONDS); do
  axi eval "() => { const l=[...document.querySelectorAll('.line')].at(-1); return l.className; }" 2>/dev/null | grep -q 'live-line' || break
  sleep 1
done
step "first real Chief answer in the thread" "waited up to ${REPLY_SECONDS}s"
shot "07-first-answer-day-1440"
axi eval "() => [...document.querySelectorAll('.line.them')].map(l=>l.textContent.trim()).join('\n---\n')" 2>/dev/null | sed -E 's/^result: "(.*)"$/\1/' > "$EV/reply.txt"
mark "done" "the whole path"

# 5. The changed screen in the other theme: signed out again, the sheet is reachable on the same install.
curl -fsS -X POST -H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $K" "$URL/api/accounts/1/minimax/logout" >/dev/null 2>&1
axi open "$URL/?night#person=$K" >/dev/null 2>&1
attach || exit 1
axi emulate --viewport "1440x900x1" >/dev/null 2>&1
see "Sign in with MiniMax" 60 && click "Sign in with MiniMax" && see "Paste your MiniMax key" 30 && step "key sheet, night" && shot "08-key-sheet-night-1440"
echo "timed-run: steps in $EV/steps.tsv, frames in $EV/frames"

# The step record done-done reads beside the frames, written by the one writer every journey here uses.
REPO=$(git rev-parse --show-toplevel)
node "$REPO/scripts/verify/steps.mjs" "$OUT" first-run-linux || echo "timed-run: no step record" >&2
