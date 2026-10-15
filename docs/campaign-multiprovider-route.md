# Campaign on a non-Claude provider: scope

Status: the OpenCode Go account route ships (kit route
`opencode:plan_key:opencode-go`: a key-paste sign-in card, runs on the kit's
saved model; see `docs/supported-subscriptions.md`). The campaign on it is not
yet proven: the run-brain default, the stub campaign smoke and the QA slice
below are open. Campaign behaviour is unchanged.

Gap: a campaign run (Chief + Scout/Scribe/Reel through `crew_assign`,
`skills/run-a-marketing-campaign/SKILL.md`) needs a signed-in account. Before
the OpenCode Go route, no Crewhouse account mapped the kit's `opencode-go`
sign-in (`PROVIDERS` in `src/accounts.ts`, `PROVIDER_OF` / `AUTH_CHOICE` in
`src/openclaw/runtime.ts`), so a person whose only plan was OpenCode Go had
nothing signed in: `Crew.usable` found no account and the task parked in
`Crew.pause`. Campaign facts rules (only person-given or source-given facts)
are untouched by this scope.

## (a) User outcome

- Entry point: the person's Chat with Chief. They ask to market their
  business; Chief states the one-goal plan and assigns Scout, Scribe and Reel.
- User action: a person whose only AI plan is a non-Claude subscription
  (for example OpenCode Go) opens Settings, signs in on that account's card,
  and taps the campaign idea.
- Visible result: the campaign runs on that account — research, two post
  drafts and the poster come back on the one Needs-you card in Chief's thread,
  with Copy and Save actions. No screen ever names a provider the person does
  not have, and nothing posts, sends or buys.
- Extreme case: all three helpers plus a `crew_batch` fan-out (24 items) on
  the non-Claude account; Scribe's `files/campaign-<name>.txt` at the draft
  cap with the longest channel names; the sign-in card and the Needs-you card
  at 390 px phone width in both themes, nothing clipped or overlapped. Facts
rule holds throughout: every post word is a person-given or source-given
fact (`skills/run-a-marketing-campaign/SKILL.md:13,26`); a provider switch
never rewords a claim.

## (b) What BYOKit already offers, and what Crewhouse must add

BYOKit already offers (nothing to build there):

- The provider catalogue: `chatgpt`, `openrouter`, `grok`, `copilot`,
  `anthropic` (API key, `offer: false`), `claude` (subscription OAuth) —
  `node_modules/@byokit/accounts/dist/catalogue.json`; `offered()` in
  `node_modules/@byokit/accounts/dist/catalogue.d.ts`.
- The `opencode-go` sign-in route: choice `opencode-go`, provider
  `opencode-go`, `via: plan_key`, `offer: true`, `keyEntry: true`,
  subscription billing —
  `node_modules/@byokit/openclaw/dist/routes.json`.
- The drive surface: `kit.signIn(member, { authChoice, via }, cb)` in
  `node_modules/@byokit/openclaw/dist/kit.d.ts`, whose `via` union already
  includes `'plan_key'` (`node_modules/@byokit/openclaw/dist/types.d.ts`),
  plus `kit.signedIn` / `kit.signOut` for status and `kit.addKey` for an
  explicitly supplied key.

Crewhouse must add (all in-repo, at the producing code). Done for OpenCode Go
and noted per item; the rest is for the next provider:

1. Account mapping — done: `PROVIDERS` (from the kit's route row),
   `PROVIDER_OF`, `AUTH_CHOICE`. Each new provider needs its own row.
2. Credential provisioning — done: `AgentRuntime.signIn` takes `'key'`,
   `OpenClawRuntime.keyIn` pastes through the kit's `addKey`, and
   `Accounts.login` takes `via: 'key'`. Credentials stay engine-held
   throughout; nothing here mints or touches one.
3. Run path — done for OpenCode Go: `run()` sends it `auth: 'apiKey'` with the
   model the run names as `opencode-go/<model>`, else the kit's saved default.
   Open: the bot's `models` entry
   (campaign brains still default to `['chatgpt']` in `src/bots.ts`). No crew
   change: `usable`, `run` and `pause` are provider-generic.
4. UI — done: the `AIS` row and its key-entry card in `web/src/adapter.ts`,
   the `AIS` keys pinned by `test/ui.test.ts`, and the matrix row in
   `docs/supported-subscriptions.md`.

## (c) Engine-side gaps (BYOKit/OpenClaw — named, never built here)

- The `plan_key` error ids (`key.invalid`, `key.notIncluded`) are the kit's.
  `keyIn` in `src/openclaw/runtime.ts` keeps the card waiting with "That key
  didn't work" on any failed paste but a transport failure (which asks for
  another tap); a plan without helpers has no card state of its own yet.
- Which models a campaign brain may name on the shipped `opencode-go` plugin
  (the pin's catalogue offers the route; an in-app model picker waits for the
  kit) — a pin question for BYOKit.
- Multi-account choice on `plan_key` routes: the catalogue marks every
  provider's multi-account terms grey, so account-picking UX is upstream's.
- Any missing or renamed `authChoice` ids surface at the pin bump through the
  kit's own `prepare()` installer, not as Crewhouse patches.

## (d) Sliced build plan (each slice about one hour)

(Slices 1–2 and slice 3's run mapping are in for OpenCode Go; see (b). Open:
the bot `models` entry, the stub-engine campaign smoke and slice 4's QA.)

1. Mapping slice: `PROVIDERS` + `PROVIDER_OF` + `AUTH_CHOICE` + `AIS` + matrix
   row. Proof: the sign-in card lists the account, `signedIn` false, no route
   yet — card-only change.
2. Key-entry slice: widen `AgentRuntime.signIn`, pass the `plan_key` via
   through, key-entry card state in `login`. Proof: isolated-engine sign-in
   attempt reaches the kit's key entry; no real credential (batteries rule).
3. Run slice: `run()` model mapping for the new provider + bot `models`
   entry. Proof: stub-engine campaign smoke (Chief assigns, helpers finish,
   one Needs-you card).
4. Docs/QA slice: matrix status, `ui.test` pin, verify-crewhouse feature
   entry for the new sign-in card.

## (e) Out of scope

- Any engine, provider, agent-loop or session code (batteries-included rule:
  engine parts go to BYOKit, never built here).
- Minting or touching any credential, real or test, beyond the isolated
  sign-in attempt in slice 2.
- Changing campaign behaviour: the skill recipe, cards, facts rules,
  `crew_batch`/`crew_draft`/`crew_verify` semantics.
- Implementing this scope: this doc only.
- API-key fallback as a subscription substitute
  (`docs/supported-subscriptions.md` product rule).
- Providers the kit does not offer a subscription route for.
