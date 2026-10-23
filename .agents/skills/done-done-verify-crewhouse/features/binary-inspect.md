# A helper looks inside a binary

Part of the crewhouse verification map. Source: `docs/verification/binary-inspect.md`.

## How to get to it (user POV)

Byte looks inside a binary the person gave it. The person opens Byte's thread and reads what the inspector found, and
sees that a file from outside Byte's own folder is refused.

## Driving it

1. Needs a task-named `CHROME_DEVTOOLS_AXI_SESSION` and a built web app (`npm run build:web`).
2. Run `scripts/verify/binary-inspect.sh <out>` (it boots its own stub-engine lab, recruits Byte from the `reverse`
   template, builds a tiny static ELF into Byte's own folder and posts the job that looks inside it) — the recipe names
   every command.
3. Capture: `byte-{night,day}-{1440,390}.png`.
4. It proves: the note in Byte's thread is the inspector's own words, byte for byte, and the file from outside the
   helper's own folder is refused.
