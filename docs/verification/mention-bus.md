# The @mention bus between helpers

A helper asks another helper for something with `crew_mention {to, text}`. The words stay in `crew.db`; the bus carries
only the mention's id. `src/bus.ts` is the gate and the row: one `bus` row is the outbox and, by its state (`open`,
`taken`, `done`, `missed`), the inbox's seen-mark. `src/nats.ts` is the broker: the pinned NATS server
(2.15.2, fetched and sha256-checked, never a server found on PATH), run as one supervised child on `127.0.0.1` behind a
token only crewd holds, plus the JetStream publish and the durable reader with explicit acks.

A published mention lands on the target's durable reader (`bot-<id>`, subject `crew.mention.<bot>.<chain>`), which claims
the row in the task's own transaction and starts one task; a repeated delivery finds it taken and starts nothing. When
that task ends, its words go back to the helper that asked. The SQLite row is the truth, so a mention written while the
broker is down is published on crewd's next tick (a down broker is retried every 30 s), and a restart loses nothing.

Loop and cost control are in `Bus.refusal`, from SQLite alone so they hold with the broker down: three hops or twelve
mentions on one chain stop with a card in both chats, a helper may not answer the helper that handed it the job, an
identical ask is refused, and one helper gets twenty asks an hour. Mentions older than seven days are dropped as
`missed`, and the stream keeps at most twelve messages per subject.

## Proof

`done-done run mention-bus` (`node scripts/verify/mention-bus.mjs <out>`) runs a real crewd on the stub engine, driven
through the API the app uses, and writes:

- `api-transcript.jsonl`, `threads.txt`, `summary.json`: the person asks Scout for the board, Scout's `crew_mention`
  names Scribe, Scribe's thread shows the hand-off and its job under Scout's task, and Scribe's answer comes back into
  Scout's chat with its job `done`.
- `broker.txt`: one NATS child, its config (loopback, a token, the state dir's store), and a connection with no token or
  a wrong one refused as `Authorization Violation`.
- `nats-binary.txt`: the fetched server's path, its `--version`, and the sha256 stamp beside it.
- `steps.json`: the run's step record. `crewd.log` is crewd's own log.

`node scripts/test.mjs test/mention.test.ts` holds the same loop on the lab's Crew: the hand-off, one job per delivery, a
ring of mentions stopping at the hop cap with the card in both chats, and a repeated JetStream delivery starting nothing.
