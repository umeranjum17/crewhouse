#!/usr/bin/env bash
# done-done journey `answer-check`: one isolated stub-engine crewd. Chief gives Research Rae a job; Rae's answer waits for
# Verifier Vera to challenge it, and Chief's thread says which answer was checked and what the check found (captured at 390,
# day and night). The first job's figure is wrong ([bad-figure] steers the stub's check), so the card says it does not hold.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/answer-check.sh <out-dir>
#
# Exit 0 with answer-check/chief-{night,day}-390.png, check-events.json and crewd.log in <out-dir>; non-zero when no check ran,
# the unchecked answer reached Chief's thread alone, or the card lacks the checker's finding. Needs /usr/bin/chromium and a
# built web app (npm run build:web).
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: answer-check.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-check.XXXXXX)
trap 'crewhouse_remove_lab "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_PORT="$PORT" \
  CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" \
  node "$REPO/src/main.ts"
PERSON=""
for _ in $(seq 240); do
  if [ -f "$LAB/state/person.key" ]; then
    PERSON=$(cat "$LAB/state/person.key")
    curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$B/api/state" 2>/dev/null | grep -q '"person"' && break
  fi
  sleep 0.25
done
[ -n "$PERSON" ] || { echo "answer-check: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 20 "${H[@]}" "${@:2}" "$B$1"; }
sql() { node -e 'const { DatabaseSync } = require("node:sqlite"), db = new DatabaseSync(process.argv[1]); db.exec("PRAGMA busy_timeout = 10000");
  const [, q, ...a] = process.argv.slice(1); process.stdout.write(JSON.stringify(db.prepare(q).all(...a)))' "$LAB/state/crew.db" "$@"; }
first() { node -e 'const r = JSON.parse(require("node:fs").readFileSync(0, "utf8"))[0]; process.stdout.write(String(r ? Object.values(r)[0] : ""))'; }
api /api/onboard -d '{"address":"Umer"}' > /dev/null
api /api/recruit -d '{"template":"scout","name":"Research Rae"}' > /dev/null
# Chief hands Rae the job through his own tool; the person's yes on the card starts it.
JOB='{"bot":"research-rae","role":"Looks into questions and writes a sourced answer","job":{"does":"Finds out what things cost and says where it read each figure.","aim":"A price you can trust.","gets":"A question and the page to read.","how":"Opens the page, reads the price and reports it with its source.","great":"One price with the page it came from."},"first":"Find out what a day pass at the city pool costs, from citypool.example [two-fare-backtest] [bad-figure]"}'
api /api/bots/chief/messages -d "$(node -e 'console.log(JSON.stringify({text: "Ask Rae about the pool price [tool crew_create " + process.argv[1] + "]"}))' "$JOB")" > /dev/null
ASK=""
for _ in $(seq 120); do ASK=$(sql "SELECT id FROM asks WHERE kind = 'propose' AND state = 'open'" | first); [ -z "$ASK" ] || break; sleep 0.25; done
[ -n "$ASK" ] || { echo "answer-check: Chief never offered the job" >&2; exit 1; }
api "/api/asks/$ASK/answer" -d '{"answer":"allow"}' > /dev/null
CARD=""
for _ in $(seq 120); do CARD=$(sql "SELECT text FROM messages WHERE bot = 'chief' AND text LIKE '%was checked by Verifier Vera%'" | first); [ -z "$CARD" ] || break; sleep 0.5; done
sql "SELECT kind, bot, data FROM events WHERE kind LIKE 'check.%'" > "$OUT/check-events.json"
sql "SELECT bot, author, task_id, text FROM messages WHERE bot = 'chief'" > "$OUT/chief-messages.json"
[ -n "$CARD" ] || { echo "answer-check: no card line saying who checked the answer" >&2; exit 1; }
[ "$(sql "SELECT COUNT(*) FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id IN (SELECT id FROM tasks WHERE bot = 'research-rae') AND text LIKE 'I recommend the lower fare%' AND text NOT LIKE '%checked by Verifier Vera%'" | first)" = 0 ] || { echo "answer-check: the unchecked answer reached Chief's thread alone" >&2; exit 1; }
grep -q "Does not hold" <<<"$CARD" || { echo "answer-check: the card lacks the finding: $CARD" >&2; exit 1; }
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
THEN="(async () => { for (let i = 0; i < 50 && !document.querySelector('.sh-chief a'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('.sh-chief a')?.click(); for (let i = 0; i < 50 && !document.querySelector('.home-chat'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.home-chat'); })()" \
  WIDTHS="390x844" bash "$REPO/scripts/verify/screens.sh" "$OUT/answer-check" chief "$B/#person=$PERSON"
node "$REPO/scripts/verify/steps.mjs" "$OUT" answer-check
echo "answer-check: checked card line: $CARD"
