# Recruit a helper and hand it a job

Chief is the only one who recruits. A helper's folder is the bot (`$CREW_DIR/bots/<id>/`
with `AGENTS.md`, `soul.md`, skills), an assigned job runs on the helper, and Chief's
thread gets exactly one `All done.` wrap-up line carrying any delivered files as cards.

## Sub-features

- `recruit` — Chief's `crew_recruit` tool creates the bot and its folder.
- `create` — Chief's `crew_create` proposes a new helper with a five-part job; one yes creates its folder and starts its first task. Adapting a recruited helper is a different outcome, not proof of a new hire.
- `refuse-cross-recruit` — a helper asking for a recruit is refused; only Chief recruits.
- `assign` — `crew_assign` queues the helper's task; it settles `done` and reports back.
- `wrapup-card` — one `All done.` line in Chief's thread per Chief job, with delivered-file cards.

## How to get to it (user POV)

- Ask Chief for a helper ("get me a video maker"), then ask him to hand it a job; watch Chief's thread for the wrap-up.

## Driving it with the API

Preconditions: onboarded person (see onboard-chief-chat.md); the stub engine's tool-call
syntax `[tool <name> <json>]` inside the message text.

- **Recruit.** `curl -fsS -X POST $H -d '{"text":"get me a video maker [tool crew_recruit {\"template\":\"reel\",\"name\":\"Reel\"}]"}' "$B/api/bots/chief/messages"`; poll `/api/bots/chief` until the task settles, then `/api/state` lists `reel`, and `$LAB/crew/bots/reel/` contains `AGENTS.md`, `soul.md`, `skills/make-reel/SKILL.md`.
- **Cross-recruit refused.** Same `crew_recruit` call addressed to `/api/bots/reel/messages` → no `scout` ever appears in `/api/state`.
- **Assign.** `curl -fsS -X POST $H -d '{"text":"please [tool crew_assign {\"bot\":\"reel\",\"task\":\"Make a 10 second demo\"}]"}' "$B/api/bots/chief/messages"`; poll `/api/bots/reel` until the task `Make a 10 second demo` is `done`, and `/api/bots/chief` shows one `author:"bot"` message starting `All done.` whose `task_id` is the Chief task.
- **File card.** A delivered file rides the wrap line: the message object's `files` array names paths under `files/…`. For a real workbook delivered by the helper, drive `[tool crew_workbook …]` per `test/workbooks.test.ts`; the app renders it via `GET /api/workbook?bot=<id>&path=<rel>` (JSON only, never the binary).

## A custom helper on the real engine

Use SKILL.md's isolated real-model launch and hold the dedicated credential lock for the
entire engine lifetime. First inspect `$LAB/state/openclaw/plugin/tools.json`: the native
`crew_create` registration must carry `job` as an object with required string fields
`does`, `aim`, `gets`, `how`, `great` (Chief's separate host schema is not that registration).

- Send `Hire a brand-new helper just for my bills - not Scout and not a template. Call it Penny.` to `POST /api/bots/chief/messages`.
- Poll `/api/state` for the open `Shall I take on Penny?` card, with `detail.hire: "Penny"` and `detail.yes: "Yes, take Penny on"`. Penny must not yet be in `bots`. A Scout adaptation does not count.
- Capture the card heading and yes button before approving. Answer once through `POST /api/asks/<id>/answer` with `{ "answer": "allow", "scope": "once" }`.
- Prove `/api/state` now lists Penny, `/api/bots/penny` has all five nonempty job parts, and `bots/penny/AGENTS.md` contains them. Retain crewd's own `run.call` input and approval row, plus the first task.
- Capture the real `#/crew` list showing Penny after approval. This is a web phone-width proof, not an Expo proof.

### Capture without the missing helper scripts

`scripts/screens.sh` and `scripts/record.mjs` are not present at this revision. For this
journey use the native `agent_browser` harness directly (in a fresh task-owned session):
`open <base>/?day`, `set viewport 1440 900`, `wait --text "Yes, take Penny on"`,
`scrollintoview .card.ask`, then `screenshot <EV>/hire-day-1440.png`. Repeat at 390×844
and with `?night`; use `#/crew` after approval and wait for Penny. Verify screenshot
artifact receipts, open all eight captures, and retain a scoped geometry eval proving
the card heading/yes and Penny's crew link are inside the viewport.

With ffmpeg available, `record start <EV>/hire-approval.webm <base>/?night`, refresh
the snapshot and scroll the card into view. Answer through the API, wait for
`Penny has joined the crew`, then open `#/crew` and `record stop`. Verify its artifact
receipt and more than one decoded frame; retain it as interaction evidence, not an
animation-performance measurement. Stop the engine before releasing its credential lock.

## Marketing crew campaign (real engine)

Chief's `run-a-marketing-campaign` skill is copied from the existing skills library,
not a grouped-helper type. Hold the real-model credential lock with `FM_CRED_WAIT=1800`
for the entire isolated daemon lifetime, including capture and cleanup.

- Onboard as Umer; save through `PUT /api/profile`: Morning Loaf bakery, local families,
  warm plain voice and only the offer/address/hours actually supplied. Select the dedicated
  test account for Chief and recruited helpers through their models endpoint.
- Send the plain request `help me market my bakery` to Chief's chat. Do not put tool calls
  or the skill's name in that real-engine request. Inspect crewd's own `run.call` trail:
  Chief must read the campaign skill, use `crew_roster`, recruit only missing Scout,
  Scribe and Reel, state a short plan and assign all three their own parts.
- Retain the request, Chief's reply and every helper's task/results via the HTTP API.
  Each run's supplied context must contain the same About-me record. Research needs
  sources, writing needs reviewable drafts, Reel needs a delivered PNG or silent video.
  A scripted provider proves dispatch/profile plumbing, never skill selection or output.
- Chief has read-only file admission: `crew_read` of its own skill is free; outside
  reads ask through the existing file policy. Writes, edits and shell calls are refused.
  The campaign skill's description directs Chief to `crew_read`, not native Skill/Read.
- Wait for the helper runs to settle before capture. Streaming snapshots invalidate refs;
  use stable visible-text DOM queries through `chrome-devtools-axi eval` for More, never
  stale refs. `CHROME_DEVTOOLS_AXI_SESSION=<task> bash .agents/skills/verify-crewhouse/capture-marketing.sh <base> <EV>`
  captures recruitment and the full plan at 390×844 and 1440×900, day and night, with geometry.
  Read the PNGs and the command logs: any `error:` means that step was not proved.
- For motion, launch that owned browser with `CHROME_DEVTOOLS_AXI_CHROME_ARGS=--remote-debugging-port=<free-port>`.
  Run `node .agents/skills/verify-crewhouse/record.mjs http://127.0.0.1:<free-port> <base>/ <EV>/campaign-review.webm`.
  Once it prints RECORDING, expand the campaign's More button with a stable eval query
  and inspect its rectangle in that same eval. TERM the recorder after the action; its
  30-second timer is only a safety bound. Require more than one captured/decoded frame.
  Open every screenshot; retain geometry and file-delivery evidence. Never send or publish.
- If the plain request does not load the skill, retain the engine trace and report it;
  do not enlarge Chief's frozen base prompt or silently substitute an explicit skill ask.
  Results tracking and native-phone changes are not part of this journey.

## Gotchas

- The wrap line appears only after the helper's task settles — poll the helper's page, not just Chief's.
- Two `crew_assign` calls in one Chief message still close with one wrap line; count them if you drive that path.
- `POST /api/recruit` exists (person-driven hire) but the chat journey is Chief's tool; keep proof on the user path you mean to claim.
