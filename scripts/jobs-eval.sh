#!/usr/bin/env bash
# The jobs eval (docs/jobs-eval.md): the jobs helper on a real model against a written rubric, beside a plain-model baseline.
# Not part of `npm test` or CI; it spends a real account's model calls.
#
#   JOBS_EVAL_CLAUDE_HOME=<a HOME holding a signed-in Claude login> scripts/jobs-eval.sh --out <dir> [--runs 1] [--model <id>]
#                                                [--cases goal,shortlist,prep] [--wait 900] [--ledger <file> | --no-ledger]
#   scripts/jobs-eval.sh --engine stub --out <dir>     scripted answers, no account or model: proves the harness only
#
# Each run is a fresh throwaway crewd (own HOME, state, ports), seeded on the stub engine and then restarted on the real one; the
# fixed web is served on loopback. Exit 0 with <dir>/report.md, results.json, helper-<n>.json, baseline-<n>.json, and one line
# appended to the ledger (commit, model, prompt hash, scores). Hold the login's single-writer lock around it:
#   flock <lockfile> scripts/jobs-eval.sh …
set -euo pipefail
REPO=$(git rev-parse --show-toplevel)
. "$REPO/scripts/verify/crewd-group.sh"
die() { echo "jobs-eval: $*" >&2; exit 2; }
ENGINE=real; RUNS=1; MODEL=""; CASES=goal,shortlist,prep; WAIT=900; OUT=""; LEDGER="$REPO/scripts/jobs-eval/ledger.jsonl"
while [ $# -gt 0 ]; do case "$1" in
  --out) OUT=$2; shift 2;; --engine) ENGINE=$2; shift 2;; --runs) RUNS=$2; shift 2;; --model) MODEL=$2; shift 2;;
  --cases) CASES=$2; shift 2;; --wait) WAIT=$2; shift 2;; --ledger) LEDGER=$2; shift 2;; --no-ledger) LEDGER=""; shift;;
  *) die "unknown argument $1";; esac; done
[ -n "$OUT" ] || die "usage: jobs-eval.sh --out <dir> [--engine real|stub] [--runs N] [--model id] [--cases a,b] [--wait seconds] [--ledger file | --no-ledger]"
[ "$ENGINE" = real ] || [ "$ENGINE" = stub ] || die "--engine is real or stub"
[ "$ENGINE" = stub ] || [ -f "${JOBS_EVAL_CLAUDE_HOME:-/nonexistent}/.claude/.credentials.json" ] || die "set JOBS_EVAL_CLAUDE_HOME to a HOME whose Claude login is signed in (a dedicated test login, never your own)"
OUT=$(mkdir -p "$OUT" && cd "$OUT" && pwd -P)
NODE_BIN=$(command -v "${NODE:-node}") || die "no node on PATH"
RUN="$NODE_BIN $REPO/scripts/jobs-eval/run.mjs"
free_port() { "$NODE_BIN" -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})'; }
LAB=""
cleanup() { [ -z "$LAB" ] || crewhouse_remove_lab "$LAB"; }
trap cleanup EXIT

# boot <stub|real> <log>: crewd on the lab's dirs; waits until it answers (the real engine's first start installs, so it waits longer).
boot() {
  local extra=() want='"person"' tries=240 path="$PATH"
  if [ "$1" = stub ]; then extra=(CREWHOUSE_ENGINE=stub); else want='"phase":"ready"'; tries=2400; path="$HOME/.local/bin:$(dirname "$NODE_BIN"):/usr/bin:/bin"; extra=(MISE_OFFLINE=1); fi
  crewd_start "$REPO" "$2" env -i PATH="$path" LANG=C.UTF-8 HOME="$LAB/home" TMPDIR="$LAB" "${extra[@]}" \
    XDG_STATE_HOME="$LAB/home/.local/state" XDG_DATA_HOME="$LAB/home/.local/share" XDG_CONFIG_HOME="$LAB/home/.config" XDG_CACHE_HOME="$LAB/home/.cache" \
    XDG_RUNTIME_DIR="$LAB/run" DBUS_SESSION_BUS_ADDRESS="unix:path=$LAB/no-bus" CREWHOUSE_PORT="$PORT" \
    CREWHOUSE_STATE_DIR="$LAB/state" CREWHOUSE_CREW_DIR="$LAB/crew" CREWHOUSE_TOOLS_DIR="$LAB/tools" "$NODE_BIN" "$REPO/src/main.ts"
  KEY=""
  for _ in $(seq "$tries"); do
    if [ -f "$LAB/state/person.key" ]; then
      KEY=$(cat "$LAB/state/person.key")
      curl -fsS --max-time 10 -H x-crewhouse:1 -H "Authorization: Bearer $KEY" "$B/api/state" 2>/dev/null | grep -q "$want" && return 0
    fi
    sleep 0.25
  done
  cp "$2" "$OUT/crewd-failed.log" 2>/dev/null || true; die "crewd never became ready (log kept in $OUT/crewd-failed.log)"
}

for N in $(seq "$RUNS"); do
  LAB=$(mktemp -d -t jobs-eval.XXXXXX)
  mkdir -p "$LAB/home" "$LAB"/{state,crew,tools,run}
  PORT=$(free_port); FIX=$(free_port); B="http://127.0.0.1:$PORT"
  COMMON=(--url "$B" --state "$LAB/state" --port "$FIX" --cases "$CASES" --wait "$WAIT" --engine "$ENGINE")
  echo "jobs-eval: run $N of $RUNS ($ENGINE engine)"
  boot stub "$LAB/crewd-stub.log"
  $RUN seed --key "$KEY" "${COMMON[@]}" > "$LAB/seed.json"
  if [ "$ENGINE" = real ]; then
    crewd_stop; boot real "$LAB/crewd.log"
    mkdir -p "$LAB/state/openclaw/home/.claude" # the engine's own home: only the dedicated login goes in, by link
    ln -s "$JOBS_EVAL_CLAUDE_HOME/.claude/.credentials.json" "$LAB/state/openclaw/home/.claude/.credentials.json"
  fi
  $RUN helper --key "$KEY" --model "$MODEL" --out "$OUT/helper-$N.json" "${COMMON[@]}" || { cp "$LAB/crewd.log" "$OUT/crewd-$N.log" 2>/dev/null || true; die "the helper arm failed (run $N); its log is $OUT/crewd-$N.log"; }
  crewd_stop # the login has one writer at a time: the engine lets go before the plain model uses it
  if [ "$ENGINE" = real ]; then
    mkdir -p "$LAB/baseline-home/.claude"; ln -s "$JOBS_EVAL_CLAUDE_HOME/.claude/.credentials.json" "$LAB/baseline-home/.claude/.credentials.json"
    BASE_MODEL=$("$NODE_BIN" -p "JSON.parse(require('node:fs').readFileSync('$OUT/helper-$N.json','utf8')).model.id")
  else BASE_MODEL=scripted; fi
  $RUN baseline --model "$BASE_MODEL" --home "$LAB/baseline-home" --out "$OUT/baseline-$N.json" "${COMMON[@]}"
  cleanup; LAB=""
done
$RUN report --dir "$OUT" --engine "$ENGINE" ${LEDGER:+--ledger "$LEDGER"} > /dev/null
echo "jobs-eval: ok, report in $OUT/report.md"
