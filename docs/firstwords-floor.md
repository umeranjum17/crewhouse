# First-real-word floor, retained ChatGPT route (2026-09-29)

Measured with `scripts/measure-firstwords.mjs` at 6f8c5bc on the sole retained
signed-in QA home (20 raw turns, one `agent` RPC each, timed off the pinned
Gateway's own assistant-text stream; variants interleaved).

- source: crewhouse `6f8c5bc`; model route: the account's own default
  (signed in: `openai, openai-codex`); prompt: "Plan dinners for the week."
- tiny (23-char system, thinking off): min 3468, **median 3921**, p90 5484, max 5866 ms
- chief (10,068-char system ≈ 2517 tok, thinking low): min 14802, **median 18628**,
  p90 21721, max 26338 ms
- verdict: the route floor alone exceeds the 3000 ms target — the target is not
  reachable on this route by first-turn context or streaming changes.

Two structural reasons, not just milliseconds:

1. Even the trivial prompt's best run (3468 ms) clears 3000 ms, so no
   first-turn shrink can fit a real Chief reply under the target.
2. The Chief prompt never yields early words: in all 10 chief runs the model
   called a tool first (6.5–12 s) and wrote only after the tool result, so there
   is no early streamed reply to "keep" while Scout runs behind — words follow
   action, structurally.

Caveats: machine load sat ~104–141 on 32 cores during the runs (a first gateway
boot attempt handshake-timed-out under the spike; the retry succeeded), so these
are upper bounds and an idle machine would read lower — but not 5x lower, which
is what the chief median would need. The chief tool calls failed (raw turns carry
no crew tool wiring; replies say Scout "couldn't be assigned"), which adds a
failed round-trip to the chief times; with working tools the shape (tools before
words) stays, only the duration changes. Full per-run table was printed to the
console by the harness run; summary above is the durable record.
