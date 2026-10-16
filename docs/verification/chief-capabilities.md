# Chief answers "What can you do?"

Chief's self-description comes from the `## About Crewhouse` section of `templates/chief/AGENTS.md`
(also injected into an installed Chief whose own job file predates it, `systemPrompt` in `src/bots.ts`).
The answer must be short, plain and true: what Chief's crew really does today, "my crew" for handing work on,
buying and sending only on the person's yes, routines, Google only once connected, and one next step from
what Chief knows about the person. It must not claim slides, charts or sending email.

## Gate

`node --test test/golden-chief.test.ts` keeps Chief's whole prompt under its frozen size; re-freeze only with a
note saying what grew and why. The words themselves need real model words: the stub cannot prove them.

## Drive (real engine)

1. Isolated crewd per runbook.md **without** `CREWHOUSE_ENGINE=stub`, on a real non-Claude route through BYOKit
   (OpenCode Go plan key, pasted into its Settings card; see `signin-card.md`). Name the route and model in the evidence.
2. Same seed for every run: `PUT /api/profile {"text":"I am Umer, a solo founder building muxr, a phone app for driving
   coding agents. Its App Store release is due this week."}`, `POST /api/onboard {"address":"Umer"}`,
   `PUT /api/accounts/1/<account>/model {"model":"<id>"}` (an id from `GET /api/accounts/1/<account>/model`). Use a fresh state per run so "Earlier in this chat" is empty.
3. At `390x844x3,mobile,touch`, `?night`, type `What can you do?` in Chief's box and send. Wait on the task row
   (`tasks` for `chief` reaching `done`), not a sleep. Save the last bot message (`GET /api/bots/chief`) as text.
4. Capture: tap More on the reply, use a taller phone viewport (`390x1400x3`) and screenshot the whole bubble.

## Pass

Every claim in the reply maps to a "has" capability (see the crewd tools in `src/crew.ts` `crewTools`); Google work is
conditional on connecting; no slides, charts or email sending; the last line is one personal next step drawn from the
About me record; plain sentences, no headings or links.
