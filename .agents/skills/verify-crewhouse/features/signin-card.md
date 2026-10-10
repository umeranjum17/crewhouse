# signin-card: one recommended account, the rest one tap away

While no account is ready, Chief's sign-in card (`AccountCard` in `web/src/flows.tsx`) shows one recommended
account as its only primary button and every other provider the kit offers under **Use another account** (a
`<details class="more-ways">`, the same fold Settings uses for "More ways to sign in"). The recommendation is
`A.aiList(accounts)`'s first row: the account this computer was signed in to (it signed out), else ChatGPT.
No provider is dropped: all six "Sign in with …" buttons stay in the card.

## Gate

- `node --test --test-name-pattern="sign-in card" test/ui.test.ts`: one `btn go`, six "Sign in with", ChatGPT first
  on a fresh install, Claude first when Claude is the account that signed out.
- `node --test test/thread-clear.test.ts`: with "Use another account" opened (the card's tallest form), every
  button clears the composer at 390.

## Drive (real crewd, stub engine)

1. Isolated crewd per [SKILL.md](../SKILL.md#launch). The stub reports every account but Grok signed in, so sign
   the others out through the app's own API to bring the card up:
   `for k in chatgpt copilot openrouter minimax claude; do curl -fsS -X POST "${H[@]}" -d '{}' "$B/api/accounts/1/$k/logout"; done`
   (`POST /api/onboard {"address":"Umer"}` first). All signed out lands ChatGPT first, the first row of `AIS`.
2. `node .agents/skills/verify-crewhouse/scripts/signin-card.ts "$PWD" "http://127.0.0.1:$PORT" "$LAB/state/person.key" "$EV/screens"`
   runs its own headless Chromium (private profile and port) and writes, for night/day at 1440 and 390, the card
   as shown (`signin-card-<theme>-<w>.png`) and opened (`signin-card-open-<theme>-<w>.png`), one recording of the
   tap each at 390 night and 1440 day (`signin-card-tap-*.webm`), and `signin-card-geometry.json`.
3. The installed iPad web app: install from `http://localhost:$PORT/` per
   [pwa-resume.md](pwa-resume.md#on-the-ipad-simulator-real-safari-home-screen-app), capture the card, tap
   "Use another account", capture again; record the tap with `xcrun simctl io <udid> recordVideo`. Night comes
   from Settings ▸ Look ▸ Night inside the installed app.

## Pass

`geometry.json`: `primary` is the expected account, six buttons, `clippedOrUnder` empty and `sideways` 0 in every
theme and width. Shots: one filled button, the other five marks beside "Use another account", and all five rows
whole once opened.

## Gotchas

- `Page.navigate` to the URL the tab is already on is only a hash visit: the fold keeps its open state, so the
  script loads `about:blank` between shots.
- Real sign-ins are out of scope here: the stub proves the card, not a provider's page.
