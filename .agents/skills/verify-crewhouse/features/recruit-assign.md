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

## Gotchas

- The wrap line appears only after the helper's task settles — poll the helper's page, not just Chief's.
- Two `crew_assign` calls in one Chief message still close with one wrap line; count them if you drive that path.
- `POST /api/recruit` exists (person-driven hire) but the chat journey is Chief's tool; keep proof on the user path you mean to claim.
