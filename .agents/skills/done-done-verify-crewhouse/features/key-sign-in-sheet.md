# Key sign-in sheet (OpenRouter, MiniMax)

Part of the crewhouse verification map. Source: `docs/verification/key-sheet.md`.

## How to get to it (user POV)

On Home with no AI signed in, "Sign in with OpenRouter" (or MiniMax) opens a sheet: paste your key, then pick which model your crew uses from the account's own live list (a free Flash model included), and the crew uses it from the next turn.

## Driving it

1. Needs a task-named `CHROME_DEVTOOLS_AXI_SESSION` and a built web app (`npm run build:web`).
2. Run `scripts/verify/key-sheet.sh <out>`; it boots its own lab (the kit on its fake Gateway, a stub key) and tears it down. No model call.
3. Capture: `key-sheet-{1-key,2-models,3-search,4-signed-in}-<account>-{day,night}-{390,1280}.png`; exit 0 means the pick (a colon id for OpenRouter) was kept by `GET /api/accounts/1/<account>/model`.
