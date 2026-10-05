# Parked on BYOKit kit fixes — steer 009 (Main423 / corr 5b8085927dc1c31f)

Date: relaunch session (this worker).
Worktree: /home/umer/.treehouse/crewhouse-0ec48b/19/crewhouse (treehouse pool slot 19), isolated from the primary checkout (`pwd -P` and `git rev-parse --show-toplevel` both resolve here).

## Steer 009 content (verbatim from inbox)
Main423 (corr 5b8085927dc1c31f, resent as Main428/59404696bee71d30): safe-source-publication
parks on two BYOKit kit fixes (safe pid-only process shutdown for the CI npm-test route; narrow
one-key config get/set) - BYOKit has the order as priority 1. Keep commit b41816a as-is; do NOT
skip or weaken the CI gate; open its PR only when the published kit lands. No final heavy attempt
meanwhile. Record parked-on-BYOKit in your status and idle.

## Actions taken this session
1. Verified isolation (above) before any edit or job. No edits, no tests, no signals.
2. Read inbox 009 and all prior receipts; acknowledged by moving 009.msg to handled/.
3. Confirmed the committed source cut is intact and unchanged:
   - HEAD = b41816a7888f54b944bb0982bb1e18a19bef69b4 "Close task test browsers over owned CDP pipes"
   - branch fm/ch-safe-suite-source; working tree clean except untracked .task-evidence/
   - diff: test/browser.ts +104, test/office.test.ts 30 changed, test/teach.test.ts 13 changed
     (124 insertions / 23 deletions; src net 0).
4. Confirmed no leftover browser processes of this task are running (pgrep hits were firstmate's
   own lavish board pollers, unrelated).

## No-group proof already retained (unchanged)
test/browser.ts closes the exact spawned task browser over its owned CDP pipe
(`Browser.close`) with a bounded wait; the only fallback signal is an individual verified-owned
PID. No cwd/session/group matching anywhere in the cut. Main415 final try: exit 0 in 30.15 s,
8/8 journey tests PASS, 55/55 recorded identities accounted absent, 0 survivors, 0 unknown,
0 signals, four observed CDP closes at 168/143/255/171 ms. Evidence:
.task-evidence/main415-final-outcome.md

## Prior receipts preserved (unchanged)
- Main406 attempt1: exit 1, 53 identities durable, 0 survivors, no signals; Office first-close
  exceeded the 5000 ms bound — a real recorded failure, not relabelled.
- Main406 admission breach (006) recorded without retrospective waiver.
- Reconciliations 003 and Main406 inventory: recorded identities absent; unrecorded
  descendants/ports remain UNKNOWN (never guessed, never signalled).

## Why parked
CI (`npm test`) still reaches the kit's normal negative-PID group kills on other suites, and the
kit needs two published fixes first (safe pid-only process shutdown on the CI npm-test route;
narrow one-key config get/set). Weakening or skipping the CI gate is forbidden. The PR opens only
when the published kit lands.

## Limitations
No PR exists yet. No CI run was started. No no-mistakes run was started. Chief qualification
remains unblocked per Main415 but is not performed by this lane. Not verified on the real app
beyond the isolated lab-home Office/teach journeys recorded above.
