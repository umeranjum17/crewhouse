# Key sign-in sheet (OpenRouter, MiniMax)

Part of the crewhouse verification map. Source: `docs/verification/key-sheet.md`.

## How to get to it (user POV)

On Home with no AI signed in, "Sign in with OpenRouter" (or MiniMax) opens a sheet: paste your key. The sheet then moves on by itself and says the crew thinks with your own account, naming the model it took (MiniMax's own Flash) with **Pick another model** beside it. No list of engine names, and nothing to pick by hand.

## Driving it

1. Needs a task-named `CHROME_DEVTOOLS_AXI_SESSION` and a built web app (`npm run build:web`).
2. Run `scripts/verify/key-sheet.sh <out>`; it boots its own lab (the kit on its fake Gateway, a stub key) and tears it down. No model call.
3. Capture: `key-sheet-{1-key,2-signed-in}-<account>-{day,night}-{390,1280}.png`; exit 0 means the sheet named the model and `GET /api/accounts/1/<account>/model` answered `picked: null` with `dflt` (MiniMax `MiniMax-M3.1-Flash`, OpenRouter none — its live list carries no default tag, so its line says "the model your OpenRouter key comes with").
