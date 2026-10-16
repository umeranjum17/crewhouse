# Settings: AI accounts

Settings' AI-accounts card is where the person sees who is signed in, resting, or
plan-less — per provider, in the product's own words (`expired`, `excluded`, `rests`).
On the stub engine every provider but Grok reports signed in, so the screen is drivable
with no real sign-in anywhere.

## Sub-features

- `list` — the card lists the app's providers with a ready/resting state each.
- `no-machinery` — plain words only: no model ids, ports, tokens or percentages reach the screen.
- `model-pick` — a signed-in row opens `#/settings/ai/<account>` (`AiAccount` in `web/src/main.tsx`, approved mock
  `model-pick` in `scripts/verify/mocks.tsv`): the account's live catalog as radio rows (names only, never ids), the
  person's pick outlined, then Other accounts with each one's pick. A pick leads Chief and every helper from the next
  turn. OpenCode Go offers no list (the kit runs its saved model) and says so. No "quicker one for small jobs":
  Chief never picks a model.

## How to get to it (user POV)

- Home → gear (top bar, `#/settings`) → AI accounts. The same card states are what a paused task waits on.

## Driving it with the API and browser

Preconditions: stub engine (no real sign-ins touched), except the explicitly authorized real-account check below.

- **API.** `curl -fsS "${H[@]}" "$B/api/accounts"` → per-provider rows; on the stub, all providers but `grok` are ready, `grok` shows its sign-in state. Response carries no commands, paths, model or engine ids (the plain-words contract, `test/stub.test.ts`).
- **UI.** Browser → settings → AI accounts: the card shows each provider by name with a state; `eval` the card's `innerText` and check it against the machinery-word list (`test/ui.test.ts`'s vocabulary — relay, token, daemon, port… must not appear).
- **Model pick.** `GET /api/accounts/1/chatgpt/model` → `{models: [{id, name}], picked}` (stub: Strong 1, Quick 1;
  Grok and OpenCode Go empty). Tap a row on `#/settings/ai/chatgpt`; `.pick.on` reads its name and every
  `bots/*/bot.json` leads with `chatgpt:<id>`. A `PUT` with an id not on the list answers 400.
- **Limit.** Send Chief `Compare the two phone plans, hit the limit`: the task pauses (no run on another account),
  Chief says once "Your ChatGPT reached its limit and rests until …", and the account page shows "Resting until …".
  Picking a model there lifts that rest and the same task resumes on it.
- **Widths.** 1440 and 390 screenshots; at 320 record the card's actual wrap behavior with the longest provider row.

## Gotchas

- Never drive a real sign-in or sign-out from this feature. For an explicitly authorized Claude status proof, use runbook.md's locked real-engine launch and dedicated credential symlink, then check `kit.signedIn('m1', 'claude-cli')` and `GET /api/accounts` (`claude.signedIn === true`). Match the kit's route by `choice === 'anthropic-cli'` or `provider === 'claude-cli'`, never its deprecated provider. Capture the real Settings card in day/night at 390/1440; a CLI login alone does not prove the card.
- A task with no usable account waits `paused` — that is the expected state, not a bug, when all accounts were unusable.
