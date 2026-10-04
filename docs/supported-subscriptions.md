# Supported subscriptions through OpenClaw 2026.8.1 (spec §12 matrix)

Owner directive: "Via OpenClaw we should support all subs that OpenClaw support." This is the pin-bound matrix of
every sign-in route the pinned OpenClaw offers, kept distinct from plain API-key access. Sources: the pinned
tarball's provider contracts (`choiceId` inventory, 2026.8.1, verified in `dist/provider-contract-api-*.js` and the
bundled plugin manifests), upstream docs (`/concepts/oauth`, `/gateway/authentication`), and a live probe of the
`openclaw.setup.auth.start` wizard on an isolated gateway. No sign-in was performed while building this.

Trust and product rules hold throughout: subscriptions run on each member's own account, never shared; no paid API
fallback exists; API keys are never a substitute for a subscription; nothing is copied from the owner's installed
tools.

## Subscription-backed routes (the person's plan pays)

Status vocabulary: **WIRED** = the route is implemented through the gateway's own wizard and usable from the app;
**UNTESTED-no-account** = implemented through the same wizard drive, but no account of that kind exists in this
build’s install, so only the route's presence and choice ids are verified (against the pinned tarball's provider
contracts and a live wizard probe) — never a claim that a login was exercised. The QA gate signs in what the QA
home actually holds.

| Crewhouse account | Provider id | Auth choice (wizard) | Prerequisites | Crewhouse availability | Verification |
|---|---|---|---|---|---|
| ChatGPT (Plus/Pro/Go; Business/Enterprise/Edu flagged as work) | `openai` | `openai` — Codex OAuth (PKCE, redirect to `localhost:1455`, paste fallback) | None: one button in the app; crewd holds 1455 and pastes the redirect into the wizard | **WIRED** | Wizard steps probed live on the pinned version; live-model proof is the QA gate's (spec §7.4) |
| ChatGPT (device pairing: phone, no browser on the computer) | `openai` | `openai-device-code` | None: the code is shown on the card | **WIRED** (code path of the one button) | Choice id verified in the pinned provider contract; wizard drive shared with `openai` |
| Grok | `xai` | `xai-oauth`; `xai-device-code` for the code path | xai's own terms for app sign-in | **WIRED** | Choice ids verified in the tarball; **UNTESTED-no-account** |
| GitHub Copilot | `github-copilot` | `github-copilot` (+ `github-copilot-enterprise` where the plan is enterprise) | Upstream documents VS Code's client as the sanctioned route; sign-in happens in the engine's own isolated home | **WIRED** | Choice ids verified in the tarball; **UNTESTED-no-account** |
| OpenRouter | `openrouter` | `openrouter-oauth` | OpenRouter documents sign-in for any app; pay-as-you-go credits, not a plan | **WIRED** | Choice id verified in the tarball; **UNTESTED-no-account** |
| MiniMax (global / CN) | `minimax` | `minimax-global-oauth` / `minimax-cn-oauth` | None beyond the provider's own page | **WIRED** | Choice ids verified in the tarball; **UNTESTED-no-account** |
| Claude (subscription) | `anthropic` | `anthropic-cli` — Claude CLI reuse; `setup-token` | The `claude` CLI installed **and** logged in inside the engine's own folder — said plainly on the card (`PROVIDERS.claude.cli`), which fails the naive bar until that flow is improved | **WIRED** (route) — **PROVEN-live** (a Chief answer through this route, on a real `claude` CLI login) | Choice ids verified in the tarball; the CLI prerequisite is labelled in the offered-account record; the engine is given the one folder holding the `claude` CLI (`enginePath`), since its own PATH is `/usr/bin:/bin` |

## API-key routes (not subscriptions; shown, never substituted)

`openai-api-key`, `gemini-api-key`, `openrouter-api-key`, `anthropic` API key via `setup-token`-style manual entry,
`alibaba-model-studio-api-key`, `nvidia-api-key`, `fal-api-key`, `runway-api-key`, `minimax-*-api`,
`microsoft-foundry-apikey` / `microsoft-foundry-entra`, `custom`, `ollama` / `ollama-cloud` (local/hosted
inference), `copilot-proxy` (proxy access). Crewhouse never auto-configures these and never falls back to a paid
key when a subscription route exists; they surface only as explicit "more options" if the owner asks for them.

## Gaps and pin assessment

- The pin (2026.8.1) carries every subscription route OpenClaw documents as of 2026-09-27; nothing supported
  upstream is missing from the pin, so no compatible-tested-pin move is required.
- Every route is now reachable through the same sign-in drive (`src/openclaw/runtime.ts` auth-choice table); the
  distinction that remains is verified-login (ChatGPT) versus **UNTESTED-no-account** (the rest), which only the
  QA home's real accounts can close.
- Claude's routes carry a terminal-login prerequisite that fails the naive-user bar; the offered-account record
  labels that honestly instead of hiding it.
- Not subscriptions and deliberately absent: channels, Control UI, Tailscale serve, cloud workers — unchanged by
  this matrix (spec §4.6).
