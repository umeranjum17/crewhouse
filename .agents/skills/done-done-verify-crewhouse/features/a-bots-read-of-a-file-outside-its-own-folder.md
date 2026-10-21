# A bot's read of a file outside its own folder

Part of the crewhouse verification map. Source: `docs/verification/flash-read.md`.

## How to get to it (user POV)

Ask Chief to read the file a helper wrote; the crew reads its own work without interrupting you, and Chief answers
with what the file says instead of a question about a folder that is not yours.

## Driving it

1. Needs an OpenRouter key in `OPENROUTER_API_KEY` (a variable name, never a value) and a task-named
   `CHROME_DEVTOOLS_AXI_SESSION`.
2. Run `done-done verify flash-read --outcome "<claim>"` (or `scripts/verify/flash-read.sh <out-dir>`); it boots its
   own lab on the real engine, puts a helper's file in that helper's folder, asks Chief to read it, and tears down.
   The journey spends model calls, so `done-done run` refuses it until the person approves the spend.
3. Capture: `flash-read/screens/chief-{night,day}-{390,1440}.png` (Chief's thread with his answer and no question);
   `thread.json`, `state.json` and `events.json` carry the job's own record; the exit code says the read ran, no
   question reached the person, and the job ended `done`.
