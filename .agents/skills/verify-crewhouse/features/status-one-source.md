# status-one-source: one status per member, the same word and count on every screen

Every crew member has one status, and Chief has his own; every screen reads it from `web/src/adapter.ts`
(`statusOf` per helper, `chiefStatus` for Chief, `summaryOf` for the count line, `GROUP_TITLES` for the Office
groups). No screen keeps a word table of its own. The words (`A.WORDS`):

| Status | Word | Counted as |
|--------|------|------------|
| Chief has a card needing your yes | `Needs you` (Chief only) | waiting (Chief counted once) |
| waiting on Chief, or queued | `Waiting` / `Up next` | waiting |
| on a job | `At work` / `Gone quiet` | at work |
| finished something today | `Done` | done |
| nothing to do, or a failed job | `Free` / `Didn't finish` / `Not sure` | free |

"Resting" is only ever an account's word (`A.resting`: "Your ChatGPT is resting until …"), never a member's.
Chief's status is his own job's: idle he is `Free`, never the green `At work`. Waiting means any card needing the
person's yes in Chief's thread (draft, routine, hire, a stuck helper's Stop card), counted once, on Chief
(`counts.needs`). A helper's result Chief relayed in his thread never badges that helper unread (`Crew.UNSEEN`).

## Surfaces that must agree

Chief's header (`.ch-status`, the phone/iPad hero), the desk rail (`.side-status`, `.side-seat`, `.side-sub`), the live
line (`.live-word`), Office (`.p-state`, `.office-counts`, the phone groups), Chats (`.chat-row` lines and badges),
`#/crew`, and the native app (`mobile/src/crew-status.ts`, `mobile/src/office.tsx`, `mobile/App.tsx`).

## Drive (real crewd, stub engine)

Launch per SKILL.md with `CREWHOUSE_STUCK_MS=15000`; `POST /api/onboard {"address":"Umer"}`,
`POST /api/recruit {"template":"scout","name":"Scout"}`. Capture `#/chief` and Office (`[data-mode=office]`) at each
moment with `scripts/screens.sh`, and read the words above from the DOM at 1440 and 390:

1. Idle: Chief `Free` in the header and on the rail; Scout `Free`; the count line `0 waiting · 0 at work · 0 done · 2 free`.
2. `hi` to Chief, finished: Chief's panel `Free`, never `Resting`.
3. "Ask Scout to find flights for next week": the result in Chief's thread; Scout `Done`, no unread badge on Scout's chat.
4. `[tool crew_routine {"bot":"scout","when":"every day 9:00","task":"…"}]` to Chief: the routine card makes Chief
   `Needs you` (header, rail, badge, Chats ring) and the count line counts him as 1 waiting; deny it.
5. "ask permission to find hotels for next week" to Scout, wait 15 s (`Gone quiet`, Chief `Needs you` for the Stop
   card), then `POST /api/bots/scout/reset`: Scout `Free` on the rail and in the count line, never `1 resting`.
6. "Compare the two phone plans, hit every limit" to Chief: the job pauses; Chief `Waiting`, the strip "All your AI
   accounts are resting until …", and the count line counts Chief as waiting.

iPad: the same crewd through the reverse tunnel (pwa-resume.md, "On the iPad simulator"), the installed web app at
moments 1, 3 and 4.

## Gate

`test/office.test.ts` (`office truth`: `statusOf`/`chiefStatus`/`summaryOf`/`chats` on one fixture, routine card on
Chief, Chief idle `Free`; the browser checks count the header from the panels' own words at 1, 5, 12 and 30 crew;
the rail summary equals its rows plus Chief), `test/ui.test.ts` (the phone pills and hero read `A.statusOf` /
`A.chiefStatus`), and `test/task-ceiling.test.ts` (Stop leaves Scout `Free`, group `free`).
