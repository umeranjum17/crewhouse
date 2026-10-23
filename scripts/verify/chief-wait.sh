#!/usr/bin/env bash
# done-done journey `chief-wait` (no account, no model call, no network): one isolated crewd on the real engine
# (OpenClaw through the BYOKit kit) with a scripted model, and one helper on the crew. The person asks Chief to get
# something from the helper. Chief hands the job on natively, waits for the helper's report, and answers the person
# from it. The journey fails when Chief works past the hand-off instead of waiting (it goes after the helper's file),
# when the job does not end `done`, when the answer is not the helper's report, or when a question reaches the person.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/chief-wait.sh <out-dir>
#
# The engine comes from $CREWHOUSE_ENGINE_DIR when it is set, else the install the app keeps; the lab itself is a
# throwaway folder (throwaway HOME/XDG/TMPDIR, an OS-assigned port, its own engine home). Nothing of the owner's
# install, sign-in or files is read or written. Exit 0 with the captures, the thread and the step record in <out-dir>;
# non-zero when Chief did not wait for the helper's report.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: chief-wait.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
LAB=$(mktemp -d -t crewhouse-chief-wait.XXXXXX)
. "$(dirname "${BASH_SOURCE[0]}")/crewd-group.sh"
LAB_PID=""
stop() { [ -z "$LAB_PID" ] || kill "$LAB_PID" 2>/dev/null || true; }
trap 'stop; crewhouse_remove_lab "$LAB" 2>/dev/null || true' EXIT
# The scripted model needs a real npm on the PATH (a mise shim that cannot read its own config fails the install).
PATH=/usr/bin:$PATH
export PATH
env CREWHOUSE_ENGINE_DIR="${CREWHOUSE_ENGINE_DIR:-$HOME/.local/share/crewhouse/engine}" \
  node "$REPO/scripts/verify/native-delegation.ts" "$LAB" "$LAB/ready.json" --scripted > "$OUT/lab.log" 2>&1 &
LAB_PID=$!
READY=""
for _ in $(seq 240); do
  if [ -s "$LAB/ready.json" ]; then READY=1; break; fi
  kill -0 "$LAB_PID" 2>/dev/null || break
  sleep 0.5
done
[ -n "$READY" ] || { echo "chief-wait: the lab never came up; lab.log in $OUT" >&2; exit 1; }
B=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).base)' "$LAB/ready.json")
PERSON=$(cat "$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).authorityFile)' "$LAB/ready.json")")
api() { curl -fsS --max-time 60 -H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "$@"; }
ASK=${CHIEF_WAIT_ASK:-'Ask Research Rae to read the facts file and bring back its reference.'}
node -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$ASK" | api "$B/api/bots/chief/messages" --data-binary @- > /dev/null
dump() { api "$B/api/bots/chief" > "$OUT/thread.json" || true; api "$B/api/state" > "$OUT/state.json" || true; api "$B/api/events?after=0" > "$OUT/events.json" || true; }
DEADLINE=$((SECONDS + ${REPLY_SECONDS:-300}))
STATE=""
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  STATE=$(api "$B/api/bots/chief" | node -e 'const s = JSON.parse(require("node:fs").readFileSync(0, "utf8")).tasks?.[0]?.state ?? ""; process.stdout.write(s)')
  case "$STATE" in done|failed|unsure|needs_you|paused) break;; esac
  sleep 1
done
dump
[ -n "$STATE" ] || { echo "chief-wait: Chief's job did not settle within ${REPLY_SECONDS:-300}s" >&2; exit 1; }
node -e 'const t = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")), s = JSON.parse(require("node:fs").readFileSync(process.argv[2], "utf8")),
  e = JSON.parse(require("node:fs").readFileSync(process.argv[3], "utf8")), job = t.tasks?.[0] ?? {}, own = (e ?? []).filter((x) => x.kind === "run.call" && x.bot === "chief"),
  asked = (s.asks ?? []).map((a) => a.title), said = String(job.result ?? "");
console.log("job: " + (job.state ?? "none") + " | " + said.slice(0, 160));
console.log("asks: " + (asked.length ? asked.join(" | ") : "none"));
if (asked.length) { console.error("chief-wait: the person was asked a question while the helper worked"); process.exit(1); }
if (job.state !== "done") { console.error("chief-wait: Chief'"'"'s job ended " + job.state + ", not done"); process.exit(1); }
if (!/BLUE-42/.test(said)) { console.error("chief-wait: Chief answered without the helper'"'"'s report: " + said.slice(0, 120)); process.exit(1); }
if (own.length) { console.error("chief-wait: Chief worked past the hand-off (" + own.length + " call(s) of its own) instead of waiting for the report"); process.exit(1); }' "$OUT/thread.json" "$OUT/state.json" "$OUT/events.json"
# The app on the same lab, so the capture shows Chief's thread with the answer his helper's report brought.
if [ -n "${CHROME_DEVTOOLS_AXI_SESSION:-}" ]; then
  export THEN='(async () => { location.hash = "#/chief"; for (let i = 0; i < 60 && !document.querySelector(".home-chat, .chat-page, .chief-page, .lines"); i++) await new Promise((r) => setTimeout(r, 100)); return true; })()'
  bash "$REPO/scripts/verify/screens.sh" "$OUT/screens" chief "$B/#person=$PERSON" || echo "chief-wait: the capture failed" >&2
fi
# The step record done-done reads beside the captures.
node "$REPO/scripts/verify/steps.mjs" "$OUT" chief-wait "model=the scripted model on the real engine"
echo "chief-wait: Chief waited for the helper and answered from its report; captures in $OUT/screens"
