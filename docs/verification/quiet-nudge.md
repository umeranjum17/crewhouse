# Quiet-job nudge

A working job with no run activity for four hours gets one plain line from Chief in his thread (the phone's content-free notice rides the same chat message); at 24 hours crewd stops the run and the job ends `unsure`.

## Drive and witness

`PATH=/usr/bin:$PATH CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/quiet-nudge.sh <out-dir>` (stub engine). It holds Rae's job mid-run, moves its recorded activity back five hours in the lab's SQLite, waits for crewd's tick, checks exactly one nudge and no repeat over later ticks, captures Chief's thread, then moves it to 25 hours and checks the job ends `unsure` (`task-after-stop.json`).

## Capture

`quiet-nudge/chief-{night,day}-{390,1280}.png`: Chief's line, no job ids or internal words. Not covered: the phone's own notice (needs the Android emulator and a push credential).
