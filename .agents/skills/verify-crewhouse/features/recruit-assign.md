# Recruit a helper and hand it a job

Chief is the only one who recruits. A helper's folder is the bot (`$CREW_DIR/bots/<id>/`
with `AGENTS.md`, `soul.md`, skills), an assigned job runs on the helper, and Chief's
thread gets exactly one `All done.` wrap-up line carrying any delivered files as cards.

## Sub-features

- `recruit` — Chief's `crew_recruit` tool creates the bot and its folder.
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

## Gotchas

- The wrap line appears only after the helper's task settles — poll the helper's page, not just Chief's.
- Two `crew_assign` calls in one Chief message still close with one wrap line; count them if you drive that path.
- `POST /api/recruit` exists (person-driven hire) but the chat journey is Chief's tool; keep proof on the user path you mean to claim.
