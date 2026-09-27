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

| Crewhouse account | Provider id | Auth choice (wizard) | Prerequisites | Crewhouse availability | Verification |
|---|---|---|---|---|---|
| ChatGPT (Plus/Pro/Go; Business/Enterprise/Edu flagged as work) | `openai` | `openai` — Codex OAuth (PKCE, redirect to `localhost:1455`, paste fallback) | None: one button in the app; crewd holds 1455 and pastes the redirect into the wizard | **Wired** (sign-in step of this build) | Wizard steps probed live on the pinned version; live-model proof is the QA gate's (spec §7.4) |
| ChatGPT (device pairing: phone, no browser on the computer) | `openai` | `openai-device-code` | None: the code is shown on the card | **Wired** (code path of the one button) | Choice id verified in the pinned provider contract; wizard drive shared with `openai` |
| GitHub Copilot | `github-copilot` | `github-copilot`, `github-copilot-enterprise` | Upstream documents VS Code's client as the sanctioned route; sign-in happens in the engine's own isolated home | Available upstream on this pin; Crewhouse wiring lands with the §12 review of each publisher's terms | Choice ids verified in the tarball; **not yet wired** |
| OpenRouter | `openrouter` | `openrouter-oauth` | OpenRouter documents sign-in for any app; pay-as-you-go credits, not a plan | Available upstream; wiring pending the same review | Choice id verified in the tarball; **not yet wired** |
| Claude (subscription) | `anthropic` | `anthropic-cli` — Claude CLI reuse; `setup-token` | The `claude` CLI installed **and** logged in inside Crewhouse's isolated home (a terminal login — fails the naive bar; disclosed honestly in onboarding) | Available upstream; wiring pending the terms check the spec records for Anthropic | Choice ids verified in the tarball; **not yet wired** |
| MiniMax (CN and global) | `minimax` | `minimax-cn-oauth`, `minimax-global-oauth` | None beyond the provider's own page | Available upstream; wiring pending review | Choice ids verified in the tarball; **not yet wired** |

## API-key routes (not subscriptions; shown, never substituted)

`openai-api-key`, `gemini-api-key`, `openrouter-api-key`, `anthropic` API key via `setup-token`-style manual entry,
`alibaba-model-studio-api-key`, `nvidia-api-key`, `fal-api-key`, `runway-api-key`, `minimax-*-api`,
`microsoft-foundry-apikey` / `microsoft-foundry-entra`, `custom`, `ollama` / `ollama-cloud` (local/hosted
inference), `copilot-proxy` (proxy access). Crewhouse never auto-configures these and never falls back to a paid
key when a subscription route exists; they surface only as explicit "more options" if the owner asks for them.

## Gaps and pin assessment

- The pin (2026.8.1) carries every subscription route OpenClaw documents as of 2026-09-27; nothing supported
  upstream is missing from the pin, so no compatible-tested-pin move is required.
- The gap is Crewhouse-side wiring: ChatGPT (browser + device code) is wired; every other subscription route is
  disclosed here as upstream-available and pending its per-publisher terms review. Wiring a route is a reviewed
  code change on this pin, never an in-app toggle.
- Claude's routes carry a terminal-login prerequisite that fails the naive-user bar; onboarding labels that
  honestly instead of hiding it.
- Not subscriptions and deliberately absent: channels, Control UI, Tailscale serve, cloud workers — unchanged by
  this matrix (spec §4.6).
