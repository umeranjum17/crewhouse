#!/usr/bin/env bash
# done-done journey `chief-reply-engine`: Chief answers on this checkout's pinned engine, with no account and no model
# spend. The native household lab (native-delegation.ts --scripted) boots the real crewd on the real OpenClaw engine
# from runtime/openclaw, with a scripted local provider as its model and a synthetic sign-in. One message goes to Chief;
# the journey waits, bounded, for his job to end done and captures his thread at 390 wide, day and night.
#
#   CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/chief-reply-engine.sh <out-dir>
#
# Exit 0 with chief-reply-engine/chief-{day,night}-390.png, reply.txt (the engine version, the message and Chief's
# words) and the journey's step record in <out-dir>; non-zero when the job does not end done within REPLY_SECONDS
# (default 180).
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: chief-reply-engine.sh <out-dir>" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P)
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
LAB=$(mktemp -d -t crewhouse-chief-reply.XXXXXX)
trap '[ "${OK:-}" = 1 ] || cp "$LAB/lab.log" "$OUT/" 2>/dev/null; crewhouse_remove_lab "$LAB"' EXIT
ENGINE=$(cd "$REPO" && node -e 'import("@byokit/openclaw").then((m) => console.log(m.ENGINE_VERSION))')
crewd_start "$REPO" "$LAB/lab.log" env -i PATH="$PATH" LANG=C.UTF-8 DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" \
  CREWHOUSE_ENGINE_DIR="${CREWHOUSE_ENGINE_DIR:-$REPO/runtime/openclaw}" node scripts/verify/native-delegation.ts "$LAB/lab" "$LAB/ready.json" --scripted
for _ in $(seq 1200); do [ -s "$LAB/ready.json" ] && break; crewd_gone && { cat "$LAB/lab.log" >&2; exit 1; }; sleep 0.25; done
[ -s "$LAB/ready.json" ] || { echo "chief-reply-engine: the lab never became ready" >&2; exit 1; }
B=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).base' "$LAB/ready.json")
PERSON=$(cat "$LAB/lab/state/person.key")
api() { curl -fsS --max-time 60 -H content-type:application/json -H x-crewhouse:1 -H "Authorization: Bearer $PERSON" "${@:2}" "$B$1"; }
ASK=${ASK:-Good morning Chief. Please say hello back in one short sentence.}
TASK=$(node -e 'process.stdout.write(JSON.stringify({ text: process.argv[1] }))' "$ASK" | api /api/bots/chief/messages --data-binary @- | node -pe 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).task')
look() { api /api/bots/chief | node -e 'const t = JSON.parse(require("node:fs").readFileSync(0, "utf8")), task = t.tasks.find((x) => x.id === Number(process.argv[1]));
  const m = (t.messages ?? []).filter((x) => x.author === "bot" && x.task_id === task?.id && String(x.text ?? "").trim());
  if (task?.state === "done" && m.length) process.stdout.write("done " + m.at(-1).text); else if (["failed", "unsure"].includes(task?.state)) process.stdout.write("end " + task.state)' "$TASK"; }
R=""; DEADLINE=$((SECONDS + ${REPLY_SECONDS:-180}))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  R=$(look)
  case "$R" in done\ *) R=${R#done }; break;; end\ *) api /api/bots/chief > "$OUT/thread.json" || true; echo "chief-reply-engine: Chief's job ${R#end }" >&2; exit 1;; esac
  R=""; sleep 1
done
[ -n "$R" ] || { api /api/bots/chief > "$OUT/thread.json" || true; echo "chief-reply-engine: no reply from Chief within ${REPLY_SECONDS:-180}s" >&2; exit 1; }
printf 'Engine: OpenClaw %s (this checkout'"'"'s pin), model: a scripted local provider\nYou asked Chief: %s\nChief replied: %s\n' "$ENGINE" "$ASK" "$R" > "$OUT/reply.txt"
export CHROME_DEVTOOLS_AXI_SESSION="${CHROME_DEVTOOLS_AXI_SESSION:?set to your task-named session}"
# Chief's thread, opened the way a person does: a tap on Chief's card on Home.
THEN="(async () => { for (let i = 0; i < 50 && !document.querySelector('.sh-chief a'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('.sh-chief a')?.click(); for (let i = 0; i < 50 && !document.querySelector('.home-chat'); i++) await new Promise((r) => setTimeout(r, 100)); return !!document.querySelector('.home-chat'); })()" \
  WIDTHS=390x844 bash "$REPO/scripts/verify/screens.sh" "$OUT/chief-reply-engine" chief "$B/#person=$PERSON"
OK=1
node "$REPO/scripts/verify/steps.mjs" "$OUT" chief-reply-engine "engine=OpenClaw $ENGINE" "ask=$ASK" "reply=$R"
echo "chief-reply-engine: Chief replied on OpenClaw $ENGINE; thread captured in $OUT/chief-reply-engine"
