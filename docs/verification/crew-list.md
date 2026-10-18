# The crew list: only Chief says "Needs you"

One install is one person, and the person talks only to Chief. A crew member waiting on
the person reads **Waiting** (the neutral seat word and style); only Chief says **Needs
you**. The ask itself reaches the person through Chief (his card on Home, his thread's Needs you), so no crew
row wears the red needs style. The crew rail (`SideCrew`, the desk's `Your crew` column)
and the crew page (`#/crew`) both follow this.

## Sub-features

- `rail` — the desk rail beside Chief (`web/src/main.tsx` `SideCrew` → `A.statusOf`): a crew row with an ask reads `Waiting`, never `Needs you`. The count line under Chief (`SideCrew`'s sub) is Home's own count line too (`A.summaryOf`, every member once, Chief too), so its numbers count the same per-member status each row shows — a `Waiting` row is never counted as free (the reported bug: the sub read `1 resting` while the only member showed `Waiting`). No crew rail row carries an unread badge, even with an unread reply (only Chief does); its dot marks working, nothing else.
- `page` — `#/crew` (`web/src/main.tsx` `Crew`, native `Crew`): tiles; a crew tile's status pill is neutral (`Waiting`), never `Needs you`, and Chief's tile reads his own `A.chiefStatus` word.
- `phone` — the native app's `Your crew` tiles and Home's crew cards (`mobile/App.tsx` `Crew`/`CrewCard`): each reads the same word as the desk rail for that member (`A.statusOf` through `glowOf`; Chief's `A.chiefStatus`), never the helper's hero line; while the home computer is out of reach every one reads `Out of reach for now`.
- `home` — Home's crew cards (`web/src/main.tsx` `CrewCard`, `web/src/office.tsx` `glowOf`; native `CrewCard`): a crew card reads `Waiting`, never `Needs you`. A waiting crew member leads with what it is on (job title or step) and `Waiting for Chief`, never the ask's head, and has no answer/approve button.
- `home-chief` — the asks reach the person once, through Chief: his card on Home reads `Chief has N things for you` (`A.chiefHas`, N = Needs you's length) and opens Chief (`#/chief`; the native phone goes to the Chief view). Home pins no Needs you (only Chief's thread does). Only a crew member on a job waits (its job over `Waiting for Chief`); one with an ask but no job rests and Chief carries the ask. A done card's meta is the finished job's title, never a waiting status. One status everywhere (`A.groupOf`): Home's count line, the cards, the rail and the tiles agree; a crew step reads `Asked Chief for an OK`.
- `unread` — a thread's NEW divider precedes the first unread message on opening. `GET /api/bots/:id` includes `bot.last`, `bot.unread` and `bot.firstUnread`, from the same query as state. Crewd's own unseen predicate owns the first message id (`null` when read); the client never reconstructs it from filtered messages or limited task history. On the phone the thread opens scrolled to the end with NEW in view (the scroll waits one frame after the live page's lines grow the content; in the same frame Android ignored it). The opening boundary remains after `/read` clears the count; leaving and reopening a read thread removes it. Completed Chief-assigned tasks in helper threads do not count twice.
- `chief` — Chief's own word is `Needs you` (rail `.side-status`, `A.chiefStatus`, his `#/crew` tile), unchanged.

## How to get to it (user POV)

- Home is the crew view; the rail is the `Your crew` column on a desk (≥900px wide), beside Chief's thread and the other pages.
- `#/crew` is `Your crew` (the label in the rail, or Settings › Your crew on a phone).

## Driving it with the browser

Preconditions: `?demo` runs the mixed demo crew whose Tracer waits on the person (no crewd);
`?demo=crew5` is the layout crew. Drive the real crewd to an open ask when proving the live path.

- **Crew page words.** Open `?demo&night#/crew` at 1440; `eval` `[...document.querySelectorAll('.st-tile:not([href="#/chief"]) .st-pill')].map((e) => e.textContent)` — no entry is `Needs you`, and a waiting helper (Tracer) is `Waiting`; `.st-tile[href="#/chief"] .st-pill` is Chief's `Needs you`.
- **Rail words.** Open `?demo&night` at 1440 (the rail is desk-only); `eval` `[...document.querySelectorAll('.side-row .side-seat')].map((e) => e.textContent)` — no entry is `Needs you`; and `document.querySelector('.side-status').textContent` is `Needs you` (Chief).
- **Rail summary line.** On the same desk rail, `eval` `document.querySelector('.side-sub').textContent` — its `N waiting · N at work · N done · N free` numbers equal the `.side-row .side-seat` words' own groups plus Chief's `.side-status` (unless `Needs you`), never a `resting` count (`A.summaryOf`; drive the real crewd for the live path).
- **Home words.** Open `?demo&night`; `eval` `[...document.querySelectorAll('.st-crew .st-card .st-pill')].map((e) => e.textContent)` — no crew card says `Needs you`; Chief's card title is `Chief has N things for you`.
- **Asks via Chief.** On Home, no crew card holds a button or text with `has a question`, `Review … order`, `needs your OK` or `Answer …`; a waiting card ends `Waiting for Chief`. Tap Chief's card: the hash becomes `#/chief`, which has `.home-chat .needs-pin`; Home has no `.needs-pin`.
- **Live path.** Start isolated crewd with `CREWHOUSE_ENGINE=stub`. Recruit Scout and Reel through `/api/recruit`; hold Reel with a natural request containing `ask permission`. On Home, Reel's card reads `At work`; with Scout gone quiet past `CREWHOUSE_STUCK_MS`, Chief's card reads `Chief has 1 thing for you` and Scout's card keeps its own status with no ask.
- **NEW, live path.** Leave Chief's thread, finish a new Chief turn, then open `#/chief`. Capture `.new-divider` directly before that reply; poll `/api/state` until Chief's unread is zero and verify the divider still exists. Leave and return: no divider until a fresh unread turn. Repeat themes and widths with a fresh turn for each opening. `node --test --test-name-pattern='live crew cards' test/office.test.ts` pins the read/return journey with a real HTTP server and browser.
- **Largest text.** Scale every computed font size and line height 1.3× (read sizes before writing any, as `look-check.mjs` does) on Home and `#/crew` at 360; on native, `look-check.mjs android` Home and Chief's thread at the system's largest `font_scale`.
- **Themes/widths.** Repeat at `?day`/`?night` and 1440 (desk) and 390 (phone, the rail is hidden; the crew page is the list).
- **Installed app.** Launch Chrome in app mode (`--app=<url>`, `matchMedia('(display-mode: standalone)')` true) and repeat — no standalone-only code, so the words are identical.
- **Phone crew (native).** Pair the Android app (`phone-pairing.md`), read each Home crew card's pill and, from Settings › `Your crew`, each tile's (`adb -s <serial> shell uiautomator dump`). Each equals the desk rail's `.side-row .side-seat` word for the same member on the same crewd. Capture day and night (`adb shell cmd uimode night yes|no`).

## Gotchas

- Home's crew cards keep their `glowOf` class on the pill (`needs` for a crew member waiting on a job); the word is still `Waiting`.
- The avatar ring (`h.ring === 'needs'`) is the "this helper has an ask" cue, not the seat word; it stays.
- `?demo` intercepts every API call, so it proves the words, not the live counts; drive the real crewd for the live path.

## Pinned by

`test/office.test.ts`: `live crew cards keep one status, Chief carries the ask, and the opening NEW divider after read` (real stub Crew + HTTP + browser: card statuses, Chief's card count, helper badges absent on Home and the 1440 rail, NEW persists after acknowledgment and disappears on a read revisit), `office truth` (`A.statusOf`/`A.chats`/`A.chiefStatus`), `your crew reads whole` (browser, `#/crew` tiles and the rail at 1440, day and night), `your crew page reads the rail status`, `the desk rail summary under Chief counts the same status its rows show`, and `at 1, 5, 12 and 30 crew` (browser, no crew card says "Needs you" or has a button or the ask's head; Chief's card carries Needs you's count to `#/chief`).

