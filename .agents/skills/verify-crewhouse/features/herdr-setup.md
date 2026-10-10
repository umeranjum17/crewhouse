# Herdr setup row and the CTO's terminal-agent runs

The CTO role holds the `herdr` system tool (user-installed binary, never bundled):
listing and reading panes and agents asks once (a standing answer covers later
looks); every drive names its pane or agent and the command, and asks every time.
The Apps screen carries Herdr's own row under Plugins with three states.

## Sub-features

- `herdr-row` — exercise the three setup states in
  [the UI contract](../../../../docs/ui-contract.md#herdr-setup-today).
- `cto-grant` — only the `cto` template grants `herdr`; the recruit card offers it
  with its asks, and per-bot Tools settings can take it back.
- `cto-look` — a CTO `pane list` / `agent read` opens one ask
  (`CTO wants to look at your terminal agents.`); Always covers later looks.
- `cto-drive` — a CTO `agent prompt` / `pane run` opens one ask naming the pane
  or agent and the command; it asks again next time and is never money
  (`detail.spends` false). An unconfirmed drive ends `unsure`, never `done`.

## Driving it with the API

Preconditions: onboarded person; a `herdr` binary on crewd's PATH answering
`status server --json` (a two-line shell script echoing `{"running":true}` is enough for the stub run).

- **Row.** `curl -fsS "$B/api/herdr"` → `{"ready":true,"connected":true,...}`;
  without the binary → `{"ready":false,...}` with the install line as `howto`.
- **Hire.** `POST /api/bots/chief/messages` with
  `[tool crew_recruit {"template":"cto","name":"CTO"}]`; `/api/state` lists `cto`.
- **Look.** `POST /api/bots/cto/messages` with
  `[tool crew_app {"tool":"herdr","input":{"args":["pane","list"]}}]`; poll
  `/api/state` for the open ask, answer it Always through
  `POST /api/asks/<id>/answer`, and the task result carries the binary's output.
- **Drive.** Same with `args: ["agent","prompt","reviewer","ship it"]`; the ask
  title names `reviewer` and `prompt`. Allow once: crewd's own `run.call` row
  records the original `crew_app` envelope in its JSON-encoded `input` (arguments
  at `.input.args`, subject to the record's 1,000-character cap) and the output's
  first line in `head`; the task ends `unsure` without `crew_outcome`.

## Capture

Drive the real crewd to `#/apps` twice: once with no `herdr` on its PATH
(missing row: install line + Connect + Retry) and once with the fake binary answering
(a setup row when it reports not running, an On row when it reports running).
Connect opens https://herdr.dev in a new tab; Retry re-probes. Four files per state
(day/night × 390/1440). Pair each capture with a
geometry eval proving the row is inside the viewport; open every PNG and require
the install line to read whole (no cut, no raw path). The stub run proves the
cards; screenshots prove the row.
