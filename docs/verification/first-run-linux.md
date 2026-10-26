# First run on Linux, timed (done-done journey `first-run-linux`)

`bash <this checkout>/scripts/verify/first-run-linux.sh <out-dir> <deb> <key-file>` (done-done journey
`first-run-linux`; the key file names a live account, so a run spends one model plan's own turn and needs
approval first). It unpacks a released `.deb` into `/opt/crewhouse` the way `dpkg -i` lays it down, starts
it the way the desktop menu does (`launch.mjs --no-open` under `env -i`, a throwaway `HOME`, no session
bus, an OS port), opens the launcher's own URL in a real browser at 1440×900 and drives the first run end
to end: Chief asks the person's name, they answer and pick one of the ideas he offers, the job waits for a
sign-in, the key sheet opens, a key is pasted from a file, a model is picked, and the waiting job runs to
his first real answer in the thread.

Every step is timestamped from T0 by the script that performs it and leaves a frame beside it:
`steps.tsv` is the record (`step`, seconds from T0, wall clock, note), `steps.json` the same path in the
step record done-done reads.

What it proves: the seconds each step of a real install-and-first-answer path costs, and that the path has
no dead end between the app opening and a first answer. What it cannot prove: a `dpkg -i` half of the
install (a host without `dpkg-deb` starts at the unpack), a person's own typing speed, or the time a model
plan takes — the first answer is waited on with a bound, and it is the model's turn, not the app's, that
dominates the total.

Labs live under `~/.cache/fm-scratch/chfr` on purpose: a deeper path pushes the engine's `bridge.sock`
past the 108-byte Unix socket limit and the app fails to start. The script kills only the daemon it started
and `chmod`s its lab writable before removing it (the engine set installs read-only).
