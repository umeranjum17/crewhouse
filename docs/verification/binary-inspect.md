# A helper looks inside a binary

Byte (the `reverse` template) can look inside a binary file the person gave it, without ever running it. The person
must be able to check what the inspector found: the note in Byte's thread holds the inspector's own words, and a file
from outside Byte's own folder is refused.

## Drive and witness

`bash scripts/verify/binary-inspect.sh <out-dir>` (stub engine). The script boots its own isolated crewd (the runbook's
Launch), onboards, recruits Byte from the `reverse` template (it holds `binary-inspect`), builds a tiny static ELF of
its own into Byte's own folder, and posts the job that looks inside it. It waits for the job to settle, hands the person
what the inspector found, and captures Byte's thread. It then asks Byte for a file from outside its own folder and waits
for the refusal.

What it proves, all from the lab's own records:

- The helper's own record of the call (`run.call` in `events.json`): the tool `crew_inspect` ran, `ok: true`, and the head
  is the inspector's own words — "ELF 64-bit LSB executable, x86-64, version 1 (SYSV), statically linked, not stripped".
- The thread (`thread.json`): the note the person reads is that same text, byte for byte, and the file from outside the
  folder came back with "that file is not in your own folder: ask the person to put it there".
- `crewd.log` — the daemon ran on the stub engine with no account and no model call.

The tool itself never runs the file it looks at, never writes and never reaches the network: the check runs in the
helper's own sandbox (`src/binary.ts`), where the folder is read-only and the network is not shared. `test/binary-inspect.test.ts`
covers that: one test per check, and one that holds that the file was never run, that nothing was written, and that a
path out of the folder is refused.

## Capture

`byte-{night,day}-{1440,390}.png`: Byte's thread, with the note that holds what the inspector found, in both themes at
both widths.

Not covered: the native Expo app's own screens (the web app draws this thread), and a real binary the person owns (the
lab's fixture is a tiny program of the journey's own, so no file of the person's is read).
