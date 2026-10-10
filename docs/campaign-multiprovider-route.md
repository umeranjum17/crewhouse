# Campaign on a non-Claude provider: scope

Status: design only. Nothing here changes campaign behaviour or ships a route.

Gap: a campaign run (Chief + Scout/Scribe/Reel through `crew_assign`,
`skills/run-a-marketing-campaign/SKILL.md`) has no sign-in route for a
non-Claude provider. The provider-switch preflight found no Crewhouse
Muse/opencode account mapping in `src/accounts.ts` PROVIDERS
(`src/accounts.ts:18-21`) or `src/openclaw/runtime.ts` PROVIDER_OF /
AUTH_CHOICE (`src/openclaw/runtime.ts:18-22`), while the kit advertises an
`opencode-go` sign-in via `plan_key`. So a person whose only plan sits with a
non-Claude provider cannot run a campaign at all: `Crew.usable`
(`src/crew.ts:1493`) finds nothing signed in and the task parks in
`Crew.pause` (`src/crew.ts:1503`). Campaign facts rules (only person-given or
source-given facts) are untouched by this scope.

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

Crewhouse must add (all in-repo, at the producing code):

1. Account mapping — one row per new provider in `PROVIDERS`
   (`src/accounts.ts:18-21`), its engine id in `PROVIDER_OF`
   (`src/openclaw/runtime.ts:18`), and its wizard choice in `AUTH_CHOICE`
   (`src/openclaw/runtime.ts:20-22`, `opencode-go` for the plan-key route).
2. Credential provisioning — `OpenClawRuntime.signIn`
   (`src/openclaw/runtime.ts:96-116`) currently passes only `browser`/`code`
   through to the kit; a `plan_key` route needs the key-entry `via` passed
   through and a key-entry card state in `Accounts.login`
   (`src/accounts.ts:86-113`). The boundary type must widen first:
   `AgentRuntime.signIn` allows only `'browser' | 'code'`
   (`src/runtime.ts:29`). Credentials stay engine-held throughout; nothing
   here mints or touches one.
3. Run path — `run()`    (`src/openclaw/runtime.ts:147-157`) maps account to
   `provider/model`; the non-Claude default needs the same treatment the
   Claude branch already has (`src/openclaw/runtime.ts:150`). No crew change:
   `usable` (`src/crew.ts:1493`), `run` (`src/crew.ts:1294`) and `pause`
   (`src/crew.ts:1504`) are provider-generic and work once `signedIn`
   answers true. Campaign brains default to `['chatgpt']`
   (`src/bots.ts:63-65`); the new provider joins the bot's `models` list.
4. UI — one row per account in `AIS` (`web/src/adapter.ts:1352-1359`) and the
   sign-in rows (`web/src/adapter.ts:1398`); `test/ui.test.ts:134` pins the
   `AIS` keys against `PROVIDERS`, so both change together; one matrix row in
   `docs/supported-subscriptions.md` marking the route WIRED or
   UNTESTED-no-account.

## (c) Engine-side gaps (BYOKit/OpenClaw — named, never built here)

- The `plan_key` wizard views themselves: key-entry screens, error words
  (`key.invalid`, `key.notIncluded`), and expiry/retry copy belong to the
  kit's wizard, not to a Crewhouse card.
- Whether the pinned engine (2026.8.1) ships the `opencode-go` plugin and its
  model catalog, and which models a campaign brain may name — a pin question
  for BYOKit.
- Multi-account choice on `plan_key` routes: the catalogue marks every
  provider's multi-account terms grey, so account-picking UX is upstream's.
- Any missing or renamed `authChoice` ids surface at the pin bump through the
  kit's own `prepare()` installer, not as Crewhouse patches.

## (d) Sliced build plan (each slice about one hour)

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
