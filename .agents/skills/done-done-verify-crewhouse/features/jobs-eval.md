# Jobs eval

Part of the crewhouse verification map. Source: `docs/jobs-eval.md`. Not a screen: a command that scores the jobs helper.

## How to get to it (user POV)

There is no screen. A person runs `scripts/jobs-eval.sh` (documented in `docs/jobs-eval.md`) and reads `report.md`: the helper's score beside two plain-model baselines, the checks where the helper loses, and what the helper did (tool calls, calls crewd refused).

## Driving it

1. Harness alone, no account: `NODE=/usr/bin/node scripts/jobs-eval.sh --engine stub --out <dir> --no-ledger` (about 20 s). Scripted answers; the report says it is not a result.
2. Real model: `NODE=/usr/bin/node JOBS_EVAL_CLAUDE_HOME=<home of the dedicated test Claude login> flock <that login's lock file> scripts/jobs-eval.sh --out <dir> --no-ledger` behind `fm-mem-gate.sh`. Minutes to an hour on a loaded host; run it in the background.
3. Capture: `done-done run jobs-eval` (`scripts/verify/jobs-eval.sh`): the stub run's `report.html` at 1280 and 390, with its steps.json. Files: `report.md`, `report.html`, `results.json`, `helper-1.json`, `baseline-1.json`; exit 0 means every arm produced a score.
