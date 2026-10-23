# Chief inbox triage: gap against Dot

Baseline: `src/crew.ts` schedule → fire → check, `src/mail.ts`, `crew_case`, and `test/{mail-watch,notice-followup,event-routines}.test.ts` on the launch commit.

| Quality point | Today | Gap / first slice |
| --- | --- | --- |
| Proactive, quiet | Connecting Gmail creates a quiet Chief routine every two hours. ALL-CLEAR suppresses a chat message. | Keep this cadence and existing connector. The watch looks at only the newest 25 threads; bursts can disappear behind its timestamp cursor. Reuse the existing paginated Gmail history reader, with cursor + task committed together. |
| Importance ranking | Prompt says ignore newsletters, receipts and promos; one task receives a batch. | Explicitly compare impact, urgency and personal relevance; read contenders before choosing the single most important actionable change. No keyword score pretends to be judgement. |
| Context across threads | Durable cases match thread or sender for 30 days; the shared profile is already injected. | Different senders (Railway vs Stripe) are invisible to that lookup. Include a bounded recent-case context with source links; require a supported relationship and distinguish separate incidents. |
| What it is / is not | Prompt requests the fact, deadline and what is unconfirmed. | Explicitly distinguish a vendor warning from evidence of compromise and facts from inference; do not invent deadlines or reassurance. |
| Linked evidence | Watch supplies Gmail links. `mail read` returns body text; HTML stripping discards href targets. | Preserve safe HTTP(S) anchor targets and include the Gmail source in reads. Require first-party references to support exact versions and vendor instructions; no guessed versions or links. |
| Fix / next step | Prompt asks for one action. | Require the vendor's order of operations, precise versions only when a read source supports them, and one focused question only if needed. |
| No noise | Silence is supported and unchanged polls cost no model call. | One selected alert per batch, no progress narration, no repeats absent changed facts. Model quality is not established by scripted wording. |
| Read-only watch | Gmail reading uses `gmail.readonly`; drafts/labels are separate approval-gated grants. | Make automatic watch runs unable to call write tools, request connections, or delegate. Existing manual Gmail workflows remain unchanged. |

## Delivery boundary

This is the engine/product-orchestration first slice, not a second connector or agent loop. Reuse the existing Gmail history API, Chief task dispatch, cases, memory, quiet-result handling, and chat/push path. No UI redesign. Migrating timestamp cursors establishes a fresh history baseline (no old-mail flood); Gmail-expired history also rebaselines. Previously unseen mail during either baseline window is a documented limitation.

Tests use synthetic recorded Gmail responses and the existing StubRuntime. They can prove poll coverage, restart/deduplication, context delivery, read-only gates, source preservation and quiet chat delivery. They cannot prove a live model selected the right real email or verified a vendor advisory.

## Still needed for full acceptance

An authorized, isolated, already-connected route to the owner's personal Gmail and a working approved model plan (MiniMax currently returns 402). No login/password/phone-code flow may be attempted. Then perform read-only real-inbox triage, inspect exact source support and ranking, and record Chief's message on the real phone and installed PWA. No sends, replies, labels, archives or drafts. Never use the owner's installed Crewhouse state or credentials. Phone UX polish belongs to the separate lane. Stub proof must not be described as this real-inbox phone acceptance.
