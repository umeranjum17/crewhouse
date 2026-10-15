# signin-card: one recommended account, the rest one tap away

While no account is ready, Chief's sign-in card (`AccountCard` in `web/src/flows.tsx`) shows one recommended
account as its only primary button and every other provider the kit offers under **Use another account** (a
`<details class="more-ways">`, the same fold Settings uses for "More ways to sign in"). The recommendation is
`A.aiList(accounts)`'s first row: the account this computer was signed in to (it signed out), else ChatGPT.
No provider is dropped: all seven "Sign in with …" buttons stay in the card.

## Gate

- `node --test test/thread-clear.test.ts`: the real card in a browser (`?demo=longthread`, signed out) — every
  provider's "Sign in with" button, and with "Use another account" opened (the card's tallest form) every button
  clears the composer at 390.
- `node --test --test-name-pattern="sign-in" test/unit.test.ts`: a plan-key account waits for the pasted key and the
  card asks for it. `node --test test/ui.test.ts`: `A.AIS`, the card's own list, is the kit's routes, OpenCode Go's
  row included.

## Drive (real crewd, stub engine)

Use the isolated launch contract in `scripts/verify/stub-drive.mjs`: private HOME/XDG/state/crew/tools,
loopback and an OS-assigned port, stub engine, and bounded readiness checks. For a manual proof server,
redirect stdout/stderr to evidence, retain its owned PID, bound commands, and terminate/wait for it on every
exit. Never capture a long-running background server through command substitution with inherited stdout.
Keep these feature captures alongside the `.done-done.yaml` journey evidence; the hermetic stub receipt
alone does not prove browser geometry or installed-app behavior. The old skill is retired;
`B="$B" LAB="$LAB" done-done run signin-card` runs `scripts/verify/signin-card.ts` for the web captures.

1. The stub reports every account but Grok signed in, so sign
   the others out through the app's own API to bring the card up:
   `for k in chatgpt copilot openrouter minimax claude opencode-go; do curl -fsS -X POST "${H[@]}" -d '{}' "$B/api/accounts/1/$k/logout"; done`
   (`POST /api/onboard {"address":"Umer"}` first). All signed out lands ChatGPT first, the first row of `AIS`.
2. In a real browser with a private profile, capture night/day at 1440 and 390: the card
   as shown (`signin-card-<theme>-<w>.png`) and opened (`signin-card-open-<theme>-<w>.png`), one recording of the
   tap each at 390 night and 1440 day (`signin-card-tap-*.webm`), and measured `signin-card-geometry.json`.
3. The installed iPad web app: install from `http://localhost:$PORT/` using Safari's Add to Home Screen,
   capture the card, tap
   "Use another account", capture again; record the tap with `xcrun simctl io <udid> recordVideo`. Night comes
   from Settings ▸ Look ▸ Night inside the installed app.

## Pass

`geometry.json`: `primary` is the expected account, seven buttons, `clippedOrUnder` empty and `sideways` 0 in every
theme and width. Shots: one filled button, the other six marks beside "Use another account", and all six rows
whole once opened.

## Go plan without helpers (published-kit fixture)

Gate: `node --test --test-name-pattern='a Go key without helpers' test/onboard.test.ts`.
It drives the public HTTP login/paste/accounts/retry routes over `test/kit-fake.ts`'s accepted
Gateway seam: the real published kit produces `not_included` from synthetic `unavailable`.
The old consumer leaves `state: waiting` with "That key didn't work"; the candidate ends
that wait, sets `notIncluded`, and recommends Go's existing plan card, not ChatGPT's.
Repeat the paste, return/reopen Chief, tap **I've changed my plan**, then submit again.
Invalid Go keys must still wait with their own error; transient Go failures must finish
with the separate retry words; Grok's wizard failure must remain a wizard error.

For live UI proof, launch `scripts/verify/go-plan.ts <repo> <owned scratch> <ready.json>` under
[runbook.md](runbook.md)'s isolated HOME/XDG/TMPDIR and the memory gate, on Node 24. It starts real crewd
server/crew/SQLite on the stub runtime and replaces only its sign-in method with the
published kit on the same synthetic Gateway. The ready file names the base URL and
owned person-key path. Onboard as Umer through the API, open that private launcher URL,
then Chief → Use another account → Sign in with OpenCode Go. Paste only
`synthetic-no-helpers`. Capture the entry and result in day/night at 390/1440 through
`agent_browser` (the native capture recipe in recruit-assign.md); record submission and
recovery. Reopen Chief and check the provider and recovery words again. Run look-check
on the resulting Chief card at 360 with large text. Install this same origin through
[pwa-shell.md](pwa-shell.md) and prove standalone=true beside its phone-width theme pair;
an ordinary tab or an injected display-mode flag is not installed-PWA proof.

Open every shot. TERM the fixture, await exit, close only the owned browser, and remove
owned scratch, keeping all evidence. This proves the public account/card integration,
not a real vendor plan, real sign-in, model call, native Expo shell or physical phone.

## Gotchas

- `Page.navigate` to the URL the tab is already on is only a hash visit: the fold keeps its open state, so the
  script loads `about:blank` between shots.
- Real sign-ins are out of scope here: the stub proves the card, not a provider's page.
