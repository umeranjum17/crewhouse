# A bot's read of a file outside its own folder

A bot may read its own folder and the crew's own work (a helper's file, the notes) without asking anyone; the
person's own files still ask them, in one plain sentence; anything else is refused with a reason the bot can act on.
No read of a file the crew owns may park the person's job in "Needs you".

## Drive and witness

`CREW_ACCOUNT=openrouter CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/flash-read.sh <out-dir>` (real
engine, OpenRouter's `minimax/minimax-m3.1-flash:free`; the key comes from `$OPENROUTER_API_KEY`, a variable name,
never a value). It boots its own lab, signs in, puts a helper's finished file in that helper's own folder, asks
Chief to read it, and waits for his job. Exit 0 only when the read ran, no question reached the person, and Chief's
job ended `done`; the job's own record and the crew's events land in `thread.json`, `state.json` and `events.json`.

The same drive on the old code ends in the drift: the ask "Chief wants to look at a file in a folder outside your
home" opens and the job parks in `needs_you` (sealed run `20261021T094629Z-478c854f-9f9283`).

## Capture

`flash-read/screens/chief-{night,day}-{390,1440}.png`: Chief's thread on the real app with his answer and no
question, in both themes at phone and desktop width.

## Limits

The read of a file that is neither the crew's nor the person's is refused, not asked about, so that case is
witnessed by the stub journey (`test/crew-profile.test.ts`) and not by a live model here. A real sign-in (the
person's own account) and the installed app are not part of this drive.
