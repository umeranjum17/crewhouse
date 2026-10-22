# Second helper checks the scout's answer

When Research Rae (the scout) finishes a job Chief handed her, her answer is held while Verifier Vera (`templates/verifier`, hidden, seated by crewd on first use) challenges it and cites what she checked. Chief's thread then carries one line: the answer, then `Research Rae's answer was checked by Verifier Vera. <her verdict>`. A check that cannot finish says the answer is unchecked; the answer is never lost. The person stays the only decision maker: nothing is acted on by either helper.

## Drive and witness

`CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/answer-check.sh <out-dir>` (stub engine; no model, no account). Chief offers Rae a job on a card, the script says yes, and the stub's check says `Does not hold` (its `[bad-figure]` marker). It fails unless the card line names the checked answer and the finding, and the answer reached Chief's thread only once. `check-events.json` holds crewd's own `check.started` / `check.result` events.

## Capture

`answer-check/chief-{night,day}-390.png`: Chief's thread with the checked line.

Not covered: a live model run (whether the second opinion ever changes an answer), and a hand-off Chief makes natively through `sessions_send` (a team job): that answer reaches Chief's own turn, not a held relay, so it is not checked yet.
