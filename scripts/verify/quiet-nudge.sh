#!/usr/bin/env bash
# done-done journey `quiet-nudge`: one isolated stub-engine crewd, a helper's job held mid-run, its recorded activity moved
# back five hours so crewd's own tick finds it quiet. Chief says so once in his thread (captured at 390 and 1280, day and
# night), never again on later ticks; moved back to 25 hours the job is stopped and ends unsure.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/quiet-nudge.sh <out-dir>
#
# Exit 0 with quiet-nudge/chief-{night,day}-{390,1280}.png and crewd.log in <out-dir>; non-zero when the nudge is missing,
# repeats, or the stop does not end the job unsure. Needs /usr/bin/chromium and a built web app (npm run build:web).
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: quiet-nudge.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-quiet.XXXXXX)
trap 'crewd_stop || exit 1; rm -rf "$LAB"' EXIT
mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
B="http://127.0.0.1:$PORT"
crewd_start "$REPO" "$OUT/crewd.log" env -i PATH="$PATH" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" \
  XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" \
  XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
  XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE=stub CREWHOUSE_HOLD_MS=3600000 CREWHOUSE_PORT="$PORT" \
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
[ -n "$PERSON" ] || { echo "quiet-nudge: crewd never became ready" >&2; exit 1; }
H=(-H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON")
api() { curl -fsS --max-time 20 "${H[@]}" "${@:2}" "$B$1"; }
api /api/onboard -d '{"address":"Umer"}' > /dev/null
api /api/recruit -d '{"template":"scout","name":"Research Rae"}' > /dev/null
api /api/bots/research-rae/messages -d '{"text":"Compare six phone plans that keep my number, and ask permission before you pick"}' > /dev/null
# The job and what crewd records about it, read straight from its database (read-only questions; one write moves the clock).
sql() { node -e 'const { DatabaseSync } = require("node:sqlite"), db = new DatabaseSync(process.argv[1]); db.exec("PRAGMA busy_timeout = 10000");
  const [, q, ...a] = process.argv.slice(1), r = /^\s*select/i.test(q) ? db.prepare(q).all(...a) : db.prepare(q).run(...a); if (Array.isArray(r)) process.stdout.write(JSON.stringify(r))' "$LAB/state/crew.db" "$@"; }
TASK=""
for _ in $(seq 120); do TASK=$(sql "SELECT id FROM tasks WHERE bot = 'research-rae' AND state = 'working'" | node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(0, "utf8"))[0]?.id ?? ""))'); [ -z "$TASK" ] || break; sleep 0.25; done
[ -n "$TASK" ] || { echo "quiet-nudge: Rae's job never started working" >&2; exit 1; }
nudges() { sql "SELECT COUNT(*) AS n FROM messages WHERE bot = 'chief' AND text LIKE '%has been quiet for a while%'" | node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(0, "utf8"))[0].n))'; }
back() { sql "UPDATE events SET at = at - ? WHERE json_extract(data, '\$.task') = CAST(? AS INTEGER)" "$1" "$TASK"; sql "UPDATE tasks SET created_at = created_at - ?, updated_at = updated_at - ? WHERE id = ?" "$1" "$1" "$TASK"; }
[ "$(nudges)" = 0 ] || { echo "quiet-nudge: a fresh job was nudged" >&2; exit 1; }
back $((5 * 3600 * 1000))
for _ in $(seq 40); do [ "$(nudges)" != 0 ] && break; sleep 0.5; done
[ "$(nudges)" = 1 ] || { sql "SELECT seq, at, kind, data FROM events WHERE bot = 'research-rae'" > "$OUT/events.json"; sql "SELECT * FROM tasks" > "$OUT/tasks.json"; echo "quiet-nudge: expected one nudge, saw $(nudges)" >&2; exit 1; }
sleep 6 # four more ticks: the same quiet stretch never speaks again
[ "$(nudges)" = 1 ] || { echo "quiet-nudge: the nudge repeated" >&2; exit 1; }
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
THEN="(async () => { for (let i = 0; i < 50 && !document.querySelector('.sh-chief a'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('.sh-chief a')?.click(); for (let i = 0; i < 50 && !document.querySelector('.home-chat'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.home-chat'); })()" \
  WIDTHS="390x844 1280x800" bash "$REPO/scripts/verify/screens.sh" "$OUT/quiet-nudge" chief "$B/#person=$PERSON"
back $((20 * 3600 * 1000))
for _ in $(seq 40); do [ "$(sql "SELECT state FROM tasks WHERE id = $TASK" | grep -o unsure)" = unsure ] && break; sleep 0.5; done
sql "SELECT id, state FROM tasks WHERE id = $TASK" > "$OUT/task-after-stop.json"
grep -q '"state":"unsure"' "$OUT/task-after-stop.json" || { echo "quiet-nudge: the 24-hour stop did not end the job unsure" >&2; exit 1; }
node -e 'const [out, v, steps, result] = process.argv.slice(1); require("node:fs").writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: v }, start: "a fresh stub-engine crewd with one helper", steps: JSON.parse(steps), result }))' "$OUT" "$(node -p 'require("./package.json").version')" '["A helper job is held mid-run","Its recorded activity is five hours old, so crewd tick finds it quiet","Chief thread shows one line that the job has been quiet","Later ticks add no second line","Chief thread is captured at 390 and 1280, day and night","The job activity is 25 hours old and crewd stops it"]' "Chief thread holds one plain line about the quiet job, and the job ended unsure"
echo "quiet-nudge: one nudge, no repeat, stop ended unsure; captures in $OUT/quiet-nudge"
