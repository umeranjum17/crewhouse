#!/usr/bin/env bash
# done-done journey `found-login`: a fresh Crewhouse on a computer where Claude Code is already signed in offers it on Chief's
# card, runs nothing until the tap, and one real reply from that login proves it (scripts/verify/found-login.ts).
# Local proof, never CI: it runs the installed, signed-in CLI as it is, under this HOME, and opens no login file.
# Needs web/dist built.   scripts/verify/found-login.sh "$DONE_DONE_EVIDENCE_ROOT"
set -euo pipefail
OUT=$1; mkdir -p "$OUT"
REPO=$(git rev-parse --show-toplevel)
S=$(mktemp -d -t crewhouse-found-login.XXXXXX); mkdir -p "$S/home"
. "$REPO/scripts/verify/crewd-group.sh"
export CHROME_DEVTOOLS_AXI_SESSION=ch-found-login-$$ CHROME_DEVTOOLS_AXI_USER_DATA_DIR="$S/profile"
export CHROME_DEVTOOLS_AXI_PORT=$(node -e 's=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})') # a name's hashed port can land on another session
ax() { chrome-devtools-axi "$@" >/dev/null 2>&1 || true; }
# A page that rewrites its own address comes back unselected: select it again before the next step.
go() { ax open "$1"; ax selectpage "$(chrome-devtools-axi pages | sed -n 's/^ *\([0-9]*\),http.*/\1/p' | head -1)"; ax wait 2500; }
say() { echo "$*" | tee -a "$OUT/found-login.txt"; }
: > "$OUT/found-login.txt"

words='crewhouse login works'
line=$(cd "$S" && claude -p "Reply with exactly these words and nothing else: $words" < /dev/null)
say "installed CLI, one-line prompt, normal HOME: $line"
[ "$line" = "$words" ]

env -i PATH="/usr/bin:/bin:$(dirname "$(command -v claude)")" LANG=C.UTF-8 HOME="$S/home" FOUND_HOME="$HOME" TMPDIR="$S" XDG_STATE_HOME="$S/home/.local/state" XDG_DATA_HOME="$S/home/.local/share" \
  XDG_CONFIG_HOME="$S/home/.config" XDG_CACHE_HOME="$S/home/.cache" XDG_RUNTIME_DIR="$S/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$S/no-bus" \
  CREWHOUSE_CALLBACK_PORT=0 node "$REPO/scripts/verify/found-login.ts" "$REPO" "$S/lab" "$S/ready.json" > "$S/fixture.log" 2>&1 &
FIX=$!
stop() { ax stop; kill -TERM "$FIX" 2>/dev/null || true; for _ in $(seq 40); do kill -0 "$FIX" 2>/dev/null || break; sleep 0.25; done
  kill -KILL "$FIX" 2>/dev/null || true; crewhouse_remove_lab "$S"; }
trap stop EXIT
for _ in $(seq 120); do [ -s "$S/ready.json" ] && break; sleep 0.5; done
B=$(node -p "require('$S/ready.json').base"); P=$(<"$S/lab/state/person.key")
api() { curl -fsS -H x-crewhouse:1 -H "Authorization: Bearer $P" -H 'content-type: application/json' "$@"; }
api -X POST -d '{"address":"Sam"}' "$B/api/onboard" >/dev/null

row=$(api "$B/api/accounts" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).find(a=>a.account==="claude");console.log(JSON.stringify({found:r.found,signedIn:r.signedIn}))})')
say "before the tap, the claude row reads: $row"
[ "$row" = '{"found":true,"signedIn":false}' ]

go "$B/?r=0#person=$P"; ax resize 390 844; go "$B/?r=1#person=$P"
ax screenshot "$OUT/found-login-offer-390.png"
ax resize 1440 900; go "$B/?r=2#person=$P"
ax screenshot "$OUT/found-login-offer-1440.png"
card=$(chrome-devtools-axi eval 'document.querySelector(".ask-words")?.textContent ?? ""')
say "card: $card"
grep -q 'already signed in on this computer' <<< "$card"
jobs=$(api "$B/api/state" | node -p 'JSON.parse(require("fs").readFileSync(0)).tasks.length')
say "jobs before the tap: $jobs"
[ "$jobs" = 0 ]

from=$(date +%s%3N)
ax eval '[...document.querySelectorAll("button")].find((b) => /^Use Claude Code/.test(b.textContent)).click()'
reply=''
for _ in $(seq 300); do
  reply=$(api "$B/api/bots/chief" | node -p 'JSON.parse(require("fs").readFileSync(0)).messages.filter((m) => m.author === "bot").at(-1)?.text ?? ""')
  [ -n "$reply" ] && break
  sleep 0.2
done
took=$(( $(date +%s%3N) - from ))
say "tap to real reply: $took ms"
say "Chief, from the installed CLI: $reply"
[ -n "$reply" ]
ax wait 1500
ax screenshot "$OUT/found-login-reply-1440.png"
ax resize 390 844; go "$B/?r=3#person=$P"
ax screenshot "$OUT/found-login-after-390.png"
row=$(api "$B/api/accounts" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).find(a=>a.account==="claude");console.log(JSON.stringify({found:r.found,signedIn:r.signedIn}))})')
say "after the reply, the claude row reads: $row"
[ "$row" = '{"found":false,"signedIn":true}' ]
node "$REPO/scripts/verify/steps.mjs" "$OUT" found-login
