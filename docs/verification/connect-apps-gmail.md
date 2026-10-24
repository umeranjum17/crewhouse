# Connect apps: Chief reads one connected app (Gmail) — not proven

**Status: not proven.** No sealed run shows Chief using a connected app for a real read on the merged main.

## What was shown

- Connect apps works: the person taps Connect apps, signs in to Composio with Continue with Google, and the Apps screen turns Connect apps on (`GET /api/composio` answers `"state":"on"`). Seen on five runs of `scripts/verify/connect-apps.sh`.
- One real read happened by hand, not sealed: with the Composio Gmail connection made on the owner's own account, Chief answered with the newest subject line ("Security alert", from Google, a few minutes old) and changed, sent and deleted nothing. That connection was removed in Composio afterwards ("Account disconnected").
- Everything else went into diagnosing why the live runs did not reach that read.

## What was not shown

Nine live runs after the hand read did not reach Composio's consent screen, so none of them is a proof:

| Run | What stopped it |
| --- | --- |
| 20261023T160728Z-d7c3dab5-71c636 | Chief raised the native "Connect Gmail" card instead of Composio's link. |
| 20261023T164532Z-48a2eb59-d536ad | Chief asked to read an engine file (`composio.d.ts`). |
| 20261023T174737Z-705bf671-9fbfd5 | 15 minutes with no ask and no reply; the engine logs were lost with the lab. |
| 20261024T032008Z-9582a7c5-4c6483 | Chief asked to read an engine docs file before Composio's tools were ready (the engine held its lease on Composio's saved sign-in for about a minute). |
| 20261024T035232Z-4461b5c4-d50860 | Chief proposed hiring a helper instead of reading the mail; the kept logs held no tool calls, so the cause could not be read. |
| 20261024T055457Z-1c67ece7-ac973f | Chief made 12 calls in 15 minutes: `crew_connect` for gmail, composio and google (the last two answered "no app called"), then skill and memory reads, `crew_routines` and `crew_import`. He made no Composio tool call and no code-mode exec call, and ignored the Composio note in the first `crew_connect` result. |
| 20261024T072458Z-4e06953b-22c986 | After #724 (the connect step returns one next step): Chief called `crew_status`, `crew_read` (a directory), `crew_connect` for gmail, `crew_roster`, `crew_connect` for google and `crew_read` USER.md over 12 minutes, and again made no Composio tool call and no code-mode exec call. Nothing was connected or granted, so there was no connection to remove. |
| 20261024T075218Z-08d68f8b-b3d68b | Sonnet 5.5 through the Claude config folder by path (`CLAUDE_CONFIG_DIR` in crewd's environment, nothing copied or linked). The engine ran the Claude CLI and Chief answered "Composio isn't reachable in this run" with no tool call; the Claude route did not offer Composio's tools (fixed in #727). |
| 20261024T085749Z-7b20aaa2-9170fe | Same route after #727: Claude signed in at the start, then the task paused 11 seconds after it began with "Waiting for you to sign in with Claude" and the account read signed out. No Claude CLI turn ran, so the Composio tools were never tried. Cause not found: the shared account folder's login may have gone stale, or the engine's check on the lab's own home failed. Logs kept; no connection or grant was made. |

The last run's kept record (`events.json`, `thread.json`, `openclaw-events.log`, `app.mp4`) is in the task evidence folder `final-run/`; the events are also committed as `test/fixtures/connect-apps-run4-events.json`, which the replay test in `test/composio.test.ts` uses.

## Fixes that came out of it

The model on the proof runs (MiniMax M3.1 Flash) did not follow the next step on any of the last two runs; a stronger model for the journey is the next thing to try. Composio reads run without approval cards (#715); Chief offers the Composio link, never the native Gmail card, while Composio is on (#716); the connection-tool call is spelled out for Chief (#718); a failed journey run keeps its engine logs, events and thread (#719, #723); the journey waits for the engine's lease on Composio's sign-in before asking Chief (#721); `crew_connect` for gmail, google or composio returns one next step (#724).

## What a proving run needs

A run on the merged main where Chief reaches Composio's Gmail link, the owner approves the read-only scope on Google's own screen, Chief reads the newest subject through a Composio tool, and the connection is removed afterwards and shown. Composio's Gmail consent asks for full mail access ("Read, compose, send, and permanently delete all your email"); no read-only Gmail scope was offered, so that grant needs the owner's explicit yes each time.
