# Settings: AI accounts

Settings' AI-accounts card is where the person sees who is signed in, resting, or
plan-less — per provider, in the product's own words (`expired`, `excluded`, `rests`).
On the stub engine every provider but Grok reports signed in, so the screen is drivable
with no real sign-in anywhere.

## Sub-features

- `list` — the card lists the app's providers with a ready/resting state each.
- `no-machinery` — plain words only: no model ids, ports, tokens or percentages reach the screen.

## How to get to it (user POV)

- Home → gear (top bar, `#/settings`) → AI accounts. The same card states are what a paused task waits on.

## Driving it with the API and browser

Preconditions: stub engine (no real sign-ins touched, ever).

- **API.** `curl -fsS "$B/api/accounts"` → per-provider rows; on the stub, all providers but `grok` are ready, `grok` shows its sign-in state. Response carries no commands, paths, model or engine ids (the plain-words contract, `test/stub.test.ts`).
- **UI.** Browser → settings → AI accounts: the card shows each provider by name with a state; `eval` the card's `innerText` and check it against the machinery-word list (`test/ui.test.ts`'s vocabulary — relay, token, daemon, port… must not appear).
- **Widths.** 1440 and 390 screenshots; at 320 record the card's actual wrap behavior with the longest provider row.

## Gotchas

- Never drive a real sign-in, sign-out or credential store from this feature; sign-in journeys are out of scope for verification runs.
- A task with no usable account waits `paused` — that is the expected state, not a bug, when all accounts were unusable.
