# Curation round 3 — can the workshop window bind to the CURRENT review?

The capability question main asked (handled inbox 001): **does the pinned 2026.8.1 runtime expose an
authoritative current-review identity that the grant can bind BEFORE any incoming cleanup request
claims it?** A request-supplied key, first-arriving request, timer reset, or re-arm is not that proof.

**Answer: yes — bounded and observational.** The gateway's own event stream (the same one crewd
already consumes for every run) broadcasts an `agent` lifecycle event carrying the review's exact
`sessionKey` and `runId` at run start, **before** the reviewer's first `skill_workshop` call can
exist, because that call requires a full model round trip after the run has started. Binding the
window to that observed exact key — with the window closed until the event arrives — gives the
current review's own key one pass and denies every stale, foreign or replayed key. This is not a
pre-kick prophecy (the key is unknowable before the run mints it); it is an engine-announced
identity learned strictly before any request can claim the grant.

## Why the key cannot be known in advance (pinned source)

`runtime/openclaw/node_modules/openclaw/dist/server-cron-CJl2HfS3.js` (from the 2026.8.1 tarball),
`runSkillCollectionReview`, lines 795–797:

```js
const sessionId = randomUUID();
const runId = `${COLLECTION_REVIEW_SESSION_SEGMENT}:${randomUUID()}`;
const sessionKey = `agent:${params.agentId}:${COLLECTION_REVIEW_SESSION_SEGMENT}:incognito-${sessionId}`;
```

Both uuids are minted inside the engine per run. No RPC returns them before or at kick:

- `cron.run` is enqueue-style and returns the cron execution id (`manual:<jobId>:<ts>:n`), not the
  review's runId — docs/gateway/protocol.md lines 760–761 say clients "read the returned runId and
  poll `cron.runs`"; the handler is `dist/cron-DEtsrllq.js` line 1191 (`enqueueRun`).
- `cron.runs` entries (empirical, `probe-results.json` → `cron.entry`) carry `ts, jobId, action,
  status, completionStatus, error, summary, runId, runAtMs, durationMs, nextRunAtMs,
  deliveryStatus, jobName` — no session identity.
- `sessions.list` never lists the review session, even while it runs (three probe runs, 100 ms
  polling: `sessionsListEverExposedKey: false`). Incognito keys are process-only by design
  (`dist/incognito-session-key-BwpD1Lwd.js` line 2); the probe result is consistent with that.

## The surface that does expose it, with ordering evidence

The pinned gateway broadcasts `agent` events on the WebSocket event bus crewd's
`OpenClawGateway.onEvent` already receives (crewd's own `runtime.run()` filters exactly this event
shape by `payload.runId`). For the review run, the run-start lifecycle event carries both
identities. Probe (real stack: gateway child, crewhouse plugin, bridge socket, engine's own
`skill-collection-review-m1` job kicked `mode:'force'`, scripted loopback model; arming exactly as
`runCollectionReview` does; `data/ch-curation-fix3/probe-review-identity.ts`):

| run | kick → identity event | kick → reviewer's gate frame | event key == frame key | run |
|---|---|---|---|---|
| 1 | t=248 ms | t=273 ms | yes | ok |
| 2 | t=237 ms | t=262 ms | yes | ok |
| 3 | t=241 ms | t=267 ms | yes | ok |

(`probe-results.json` holds run 3 in full; the verdict block is `identityEventBeforeFirstFrame`,
`identityEventKeyEqualsFrameKey`.) The ordering is causal, not luck: the lifecycle event fires at
run admission, and the reviewer's tool call cannot exist until the model turn after it completes —
the 21–31 ms margin above is with a stub model that answers instantly; a real review takes seconds.
Between kick and bind the window is simply closed, so nothing can claim the grant in the gap: any
early frame is denied (fail-closed), and the review prompt orders the model to "Always make the
call" (`buildCollectionReviewPrompt`, same bundle line 954), so the one qualifying call comes after
bind. The plugin/hook side needs no change: the gate frame already carries `ctx.sessionKey`
(`src/openclaw/plugin/index.js`), which is exactly the identity the event announced; the hook ctx
type also has optional `runId`/`sessionId` (`dist/acpx-BnI94i_U.d.ts` line 1936,
`PluginHookToolContext`), but the session key alone is unique per run and is what the frame carries.

## The counterexample (kept as a standing reproduction)

`test/openclaw-curation.test.ts` → "round-3 reproduction: the armed window binds to FIRST arrival,
not the current review", mirroring main's probe order against the round-2 code (PR
https://github.com/umeranjum17/crewhouse/pull/131): arm → a stale same-prefix key arriving FIRST is
admitted; the intended current key is then denied (its slot was consumed); disarm + re-arm admits
the SAME stale key again. The window's binding is first-arrival under a member/review prefix
(`src/openclaw/bridge.ts` `curationAllowed`), which is a substitution rule, not a binding to the
current review. All round-1/2 assertions stay green untouched.

## The bounded correction (design only — not implemented)

In `runCollectionReview` (src/openclaw/runtime.ts), unchanged capture → kick with the window
**closed** (no prefix arming) → on the first post-kick `agent` lifecycle event whose `sessionKey`
starts `agent:m<member>:skill-collection-review:`, arm bound to that **exact key** (same one-call,
one-action, one-timeout window) → disarm in `finally`, unchanged. Bridge change is one field
(exact key instead of prefix + first-arrival). Uses only surfaces crewd already consumes; no new
permission framework, no private-runtime coupling, no pin upgrade, no plugin change.

Preserved invariants: pre-bind stale frame denied; post-bind old-key/different-member/replay
denied; the current review's own reconcile passes exactly once; restore stays byte-faithful;
household curation stays disabled. Residuals, stated plainly: (a) the bind is observational — a
tool call beating the event's delivery is denied once (fail-closed; the model retries per its
prompt); (b) correlation is "first post-kick lifecycle event for the member's review prefix" — an
engine-scheduled firing racing the manual kick is still a genuine same-member review covered by the
pre-kick capture; if main wants that closed too, suspend the job's schedule for the manual run
(`cron.update` enabled=false, restore after) inside the same change.

## The decision (needs main)

- **A. Event-bound exact-key window** — the bounded correction above; recommended.
- **B. Keep round-2 behavior**, documented as "first qualifying session wins" — weaker bound; the
  counterexample stands as its definition.
- **C. Keep household curation disabled** — status quo; accept no weaker bound.

Autonomous merging of curation-correction PRs is suspended; this report is the deliverable and no
correction was implemented or shipped (handled inbox 001). Artifacts: this report,
`probe-review-identity.ts` + `probe-results.json` (run: `node data/ch-curation-fix3/probe-review-identity.ts`),
and the reproduce test in `test/openclaw-curation.test.ts`.
