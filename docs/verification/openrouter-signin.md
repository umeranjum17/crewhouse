# OpenRouter: explicitly offered sign-in

Real-engine recipe: launch with the runbook's env mask but **omit `CREWHOUSE_ENGINE=stub`** (the stub cannot prove provider-plugin admission), an owned state/crew/tools dir, `CREWHOUSE_LINK_HOST=127.0.0.1`, `CREWHOUSE_LINK_PORT=0`, and an OS-assigned `CREWHOUSE_CALLBACK_PORT`. Sign-in tests reuse one retained test HOME; keep all XDG dirs task-private and D-Bus inaccessible. Wait for `crewd engine ready` before driving the API. Never open the external authorize page, supply a person's credentials, or request a model answer for this routing proof.

1. Read the task-owned `person.key` and use the HTTP authority headers from [Drive](runbook.md#drive). `POST /api/onboard {"address":"Umer"}`, then `GET /api/accounts`: OpenRouter is offered but signed out.
2. `POST /api/accounts/1/openrouter/login {"via":"browser"}` is the existing sign-in card's action. Poll `GET /api/accounts` with a bound until OpenRouter's `signIn.url` or a terminal failure appears. Expect `state: "waiting"` and a URL whose origin is `https://openrouter.ai`, never `blocked by allowlist`. Do not navigate to that URL.
3. `POST /api/accounts/1/openrouter/cancel {}`. Expect `signIn: null`, `signedIn: false`. Cancellation must never mark the account ready. A successful observed reoffer is not a guarantee of immediate readmission after cancellation.
4. Retain redacted HTTP results, the engine log, source HEAD, installed package version and the published tarball integrity matching `package-lock.json`. `test/openclaw.test.ts` extends the existing real-Gateway journey with the same URL/cancel boundary; run it through the isolated test runner.

The published kit needs `KitOptions.offered`: Crewhouse passes its mapped provider IDs in `src/openclaw/runtime.ts`. The causal control is the published artifact's `reconcileConfig` with identical app config: omitting `offered` excludes the explicit OpenRouter plugin, supplying it includes that plugin. Do not patch the engine/plugin or manually add OpenRouter to the app's allow list.

This is routing/cancellation evidence, not completed OAuth, accepted credentials, a funded account, or a model answer. Invalid credentials and live auth are not proven without a separately authorized dedicated fixture. No screen/layout/motion changes: API evidence needs no screenshot matrix, native phone or installed-PWA capture.
