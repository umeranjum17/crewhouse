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
- `relay-opening` — a finished helper's answer appears in Chief's thread in its own words: a full short sentence first, otherwise a word-boundary opening marked with `…`, at most 160 characters. Stale progress is excluded; empty or wordless replies retain the generic ready line.

## How to get to it (user POV)

- Ask Chief for a helper ("get me a video maker"), then ask him to hand it a job; watch Chief's thread for the wrap-up.

## Driving it with the API

Preconditions: onboarded person (see onboard-chief-chat.md); the stub engine's tool-call
syntax `[tool <name> <json>]` inside the message text.

- **Recruit.** `curl -fsS -X POST "${H[@]}" -d '{"text":"get me a video maker [tool crew_recruit {\"template\":\"reel\",\"name\":\"Reel\"}]"}' "$B/api/bots/chief/messages"`; poll `/api/bots/chief` until the task settles, then `/api/state` lists `reel`, and `$LAB/crew/bots/reel/` contains `AGENTS.md`, `soul.md`, `skills/make-reel/SKILL.md`.
- **Cross-recruit refused.** Same `crew_recruit` call addressed to `/api/bots/reel/messages` → no `scout` ever appears in `/api/state`.
- **Assign.** `curl -fsS -X POST "${H[@]}" -d '{"text":"please [tool crew_assign {\"bot\":\"reel\",\"task\":\"Make a 10 second demo\"}]"}' "$B/api/bots/chief/messages"`; poll `/api/bots/reel` until the task `Make a 10 second demo` is `done`, and `/api/bots/chief` shows one `author:"bot"` message starting `All done.` whose `task_id` is the Chief task.
- **File card.** A delivered file rides the wrap line: the message object's `files` array names paths under `files/…`. For a real workbook delivered by the helper, drive `[tool crew_workbook …]` per `test/workbooks.test.ts`; the app renders it via `GET /api/workbook?bot=<id>&path=<rel>` (JSON only, never the binary).

## Long and bullet-only helper relays (stub engine)

`test/chat-relay.test.ts` reuses the real-server, isolated stub crew and owned headless
browser setup from `test/chat-live.test.ts`, without measuring its unrelated live-line
timing gate. Run `node --test test/chat-relay.test.ts` in a throwaway HOME with all XDG
dirs isolated and a **short TMPDIR** (a long path makes the browser's singleton socket
exceed the Unix path limit). The test builds and serves this tree's actual web app.

Set `CREWHOUSE_RELAY_EVIDENCE=<absolute evidence directory>` to capture this journey:
onboard Umer, recruit Scout through the API, send Chief `Ask Scout to ask permission
first, then check my long invoice list` from the composer, wait for Scout's held turn,
and release it with the test's >160-character invoice sentence. Repeat for the bullet
invoice list. The replies are scripted model output, not real-model claims.

The test waits for Scout's done row and Chief's persisted message, then proves the same
words are rendered in Chief's thread. It writes `long.json` and `bullets.json` (original
reply, relay, both API pages), eight `long|bullets-day|night-390|1440.png` captures with
matching geometry JSON, and `relay.webm` plus `recording.log` through `../record.mjs`.
It waits for the opening overlay to disappear and fonts to paint; every relay rectangle
must fit the viewport. Open all eight images and require more than one decoded video
frame. The owned browser and server close at test exit. This proves relay wording on
the web app, not the native phone, sign-ins, or timing. On the old rule both cases say
`The result is ready.`; the candidate must show the invoice opening and
`Water bill due Friday…` instead, without changing helper replies or other relay rules.

## Registered crew tool arguments (real engine)

Run `node --test --test-name-pattern='model-visible crew tools' test/openclaw-bridge.test.ts`:
it checks the kit's emitted `openclaw/plugin/tools.json`, not a separate host-only list.
Every registered tool must have object properties, including empty objects for no-argument tools.
Schemas live with the executor helpers in `src/engine.ts`; `src/crew.ts` and the engine port share them.

Under the isolated real-model launch and credential lock below, send one ordinary Chief message:
`Read AGENTS.md in your folder and tell me its first line, then recruit Reel from the reel template. Do not assign any tasks.`
Retain the request, reply, registered tool table and engine session log lines for `crew_read` and
`crew_recruit`. Both must use their named fields and succeed on their first call; prove the returned
file line and the recruited helper through `/api/bots/chief` and `/api/state`. Retain crewd's
`run.call` rows as an independent result witness. A retry, open schema or stub turn does not pass.
This is tool/API proof with no changed screen, so screenshots are unnecessary.

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
- **Campaign facts.** Before a recipe change, run one sparse-profile campaign on the unchanged recipe and retain its actual claims, including implied products, opening availability and policies. On the candidate, run three different sparse businesses with requests inviting embellishment (at least one without hours, prices or address). Retain each About-me record and exact request with line numbers, the assignments' quoted source packs, Scout's sourced document, each helper's delivered claims list, combined TXT and poster. Independently compare every factual/implied claim in BOTH posts and the rendered poster with those sources; write `claims.tsv` (`claim`, `source file:line and quote` or `marked for the person`, `verdict`). Source notes alone do not count: unsourced needed details must be omitted or visibly bracketed on the review card/poster. A writing-kit fit/phrasing pass is not a grounding pass. Require zero untraced claims across all three before calling the fix qualified. Drive the ordinary profile/messages API and capture each campaign with `CHROME_DEVTOOLS_AXI_SESSION=<task> bash .agents/skills/verify-crewhouse/capture-campaign.sh <base> <EV> approval`; inspect every captured PNG and the actual delivered poster. Keep the real engine and credential lock for the complete journey; do not substitute scripted words.
- **One campaign approval (slice 2).** Scribe delivers ONE `files/campaign-<short-name>.txt` with both posts: one channel heading line then its exact post, separated by `\n\n---\n\n`. It calls `crew_draft` once on that file, with no link. Chief never gets a write or draft grant. The web adapter routes helper drafts to Chief; the campaign card waits for the related tasks to settle, finds Reel's delivered PNG by their existing task root and has only Approve / Not now. Confirm the helper panels have no draft Needs-you action and that both exact texts, channel names and poster are on Chief's card.
- Capture the original helper-only screen before the web change using `CHROME_DEVTOOLS_AXI_SESSION=<task> bash .agents/skills/verify-crewhouse/capture-campaign.sh <base> <EV> before`; on the built candidate use the same command with `approval`. Choose Not now through its actual browser button; `declined` captures the closed-card outcome. Clipboard calls, page opens and send/post tool calls must stay zero. Send a second plain campaign request; capture its card, then record the actual Approve click with the recorder below. Use `approved` for the ready-to-copy outcome: Approve itself must copy/send nothing; each Copy button copies only its own post, and Save poster stays on the local delivered file. The approved text is read through `GET /api/document` and SHA-256-checked against the durable draft receipt before copying, not reconstructed from its capped 400-character summary. A changed file shows a fresh-draft request instead of copying different words.
- `capture-campaign.sh` retains the top and action-area views at both widths/themes, plus DOM text, image completeness and geometry. Open every PNG; normal scrolling is not overlap or horizontal clipping. Recent web outcome cards use the existing 80-event snapshot window; the helper's What happened history keeps the durable decision. This is a web phone-width proof, not new native Expo UI. No new store, posting connector or results tracker.
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
