# The crew list: only Chief says "Needs you"

One install is one person, and the person talks only to Chief. A crew member waiting on
the person reads **Waiting** (the neutral seat word and style); only Chief says **Needs
you**. The ask itself reaches the person through Chief (Home's Needs you rows), so no crew
row wears the red needs style. The crew rail (`SideCrew`, the desk's `Your crew` column)
and the crew page (`#/crew`) both follow this.

## Sub-features

- `rail` — the desk rail beside Chief (`web/src/main.tsx` `SideCrew` → `A.statusOf`): a crew row with an ask reads `Waiting`, never `Needs you`. The count line under Chief (`SideCrew`'s sub) is the Office's own summary (`A.summaryOf`, every member once, Chief too), so its numbers count the same per-member status each row shows — a `Waiting` row is never counted as free (the reported bug: the sub read `1 resting` while the only member showed `Waiting`).
- `page` — `#/crew` (`web/src/main.tsx` `Crew`): a crew row's status word is neutral (`Waiting`), never `Needs you`; a working row keeps its green dot.
- `phone` — the native app's `Your crew` screen (`mobile/App.tsx` `HelperPill`/`Pill` → `mobile/src/crew-status.ts` `crewPill`/`chiefPill`, the web rail's own `A.statusOf`/`A.chiefStatus`): each helper pill reads the same word **and dot colour** as the desk rail for that member (a working helper is a hollow ink ring, a quiet/failed one red, a free one `Free` grey, not `Free to help`), and Chief's own row reads `A.chiefStatus` (`Free`/`At work`/`Waiting`/`Needs you`) with the rail's own dot (grey, pink only for `Needs you`) — never the helper's hero line. A member missing from the office view across a refresh falls back to the helper's own words, never a second status rule.
- `office` — the Office view (`web/src/office.tsx` `glowOf`/`TITLES`, `mobile/src/office.tsx`): a crew panel/group/row reads `Waiting`, never `Needs you`; the glow class and colour are kept. A waiting crew member leads with what it is on (job title or step) and `Waiting for Chief`, never the ask's head, and has no answer/approve button.
- `office-chief` — the asks reach the person once, through Chief: Chief's panel (desk) or the top of the grouped list (phone) carries one action, `Chief has N things for you` (`A.chiefHas`, N = Needs you's length), opening Chief (`#/chief`; the native phone goes to the Chief view). The Office pins no Needs you (only Chief's thread does), and only its bar stays put while the rows scroll. Only a crew member on a job waits (its job over `Waiting for Chief`); one with an ask but no job rests and Chief carries the ask. A done row's meta is the finished job's title, never a waiting status. One status everywhere (`A.groupOf`): the header counts, the rows, On it now (`Nobody is working: N waiting for Chief.`) and Chats agree, and only Chief's chat row carries a dot for an ask; Chief's panel says `N waiting for Chief`, and a crew step reads `Asked Chief for an OK`.
- `chief` — Chief's own word is `Needs you` (rail `.side-status`, `A.chiefStatus`, the Office `ChiefPanel` glow), unchanged.

## How to get to it (user POV)

- Home opens on Chat with Chief; the rail is the `Your crew` column on a desk (≥900px wide).
- `#/crew` is Home's `Your crew` page (the `Your crew` label in the rail, or the crew list on a phone).

## Driving it with the browser

Preconditions: `?demo` runs the mixed demo crew whose Tracer waits on the person (no crewd);
`?demo=crew5` is the layout crew. Drive the real crewd to an open ask when proving the live path.

- **Crew page words.** Open `?demo&night#/crew` at 1440; `eval` `[...document.querySelectorAll('.crew-row .status-word')].map((e) => e.textContent)` — no entry is `Needs you`, and a waiting helper (Tracer) is `Waiting`.
- **Rail words.** Open `?demo&night` at 1440 (the rail is desk-only); `eval` `[...document.querySelectorAll('.side-row .side-seat')].map((e) => e.textContent)` — no entry is `Needs you`; and `document.querySelector('.side-status').textContent` is `Needs you` (Chief).
- **Rail summary line.** On the same desk rail, `eval` `document.querySelector('.side-sub').textContent` — its `N waiting · N at work · N done · N free` numbers equal the `.side-row .side-seat` words' own groups plus Chief's `.side-status` (unless `Needs you`), never a `resting` count (`A.summaryOf`; drive the real crewd for the live path).
- **Office words.** Open `?demo&night`, tap Office in the bar; `eval` `[...document.querySelectorAll('.office .p-state')].map((e) => e.textContent)` (desk) or `[...document.querySelectorAll('.office .grp')].map((g) => g.getAttribute('aria-label'))` and each row's `.p-state` (phone) — no crew panel/group says `Needs you`; Chief's panel does.
- **Office asks via Chief.** In the same Office, `eval` `[...document.querySelectorAll('.office .btn')].map((e) => [e.textContent, e.getAttribute('href')])` — exactly one entry, `Chief has N things for you` → `#/chief`, and no panel/row text has `has a question`, `Review … order`, `needs your OK` or `Answer …`; a waiting row ends `Waiting for Chief` (its meta, or its line when it has no job or step). Tap it: the hash becomes `#/chief`. Also `document.querySelectorAll('.needs-pin').length` is 0 in Office and the Chief view still has `.home-chat .needs-pin`; scroll to the bottom at 390 and check no `Needs you` card and no half row under the bar.
- **Themes/widths.** Repeat at `?day`/`?night` and 1440 (desk) and 390 (phone, the rail is hidden; the crew page is the list).
- **Installed app.** Launch Chrome in app mode (`--app=<url>`, `matchMedia('(display-mode: standalone)')` true) and repeat — no standalone-only code, so the words are identical.
- **Phone crew list (native).** The Android app is its own surface: pair it (`features/phone-pairing.md`), open Settings (the gear) then `Your crew`, and read each helper's pill (`adb -s <serial> shell uiautomator dump` → the pill text). It must equal the desk rail's `.side-row .side-seat` word for the same member on the same crewd — a working helper `At work`, a quiet one `Gone quiet`, a free one `Free` — not the helper's job title. Capture day and night (`adb shell cmd uimode night yes|no`).

## Gotchas

- The Office view's own grouping (`glowOf`, `TITLES`, the phone's grouped list) is covered too: a crew panel/group reads `Waiting`; only Chief's panel says `Needs you`. Its glow class/colour is unchanged.
- The avatar ring (`h.ring === 'needs'`) is the "this helper has an ask" cue, not the seat word; it stays.
- `?demo` intercepts every API call, so it proves the words, not the live counts; drive the real crewd for the live path.

## Pinned by

`test/office.test.ts`: `office truth` (`A.statusOf`/`A.chats`/`A.chiefStatus`), `your crew reads whole` (browser, `#/crew` and the rail at 1440, day and night), `the desk rail summary under Chief counts the same status its rows show` (browser, the rail's `.side-sub` numbers equal the rows' words' own groups, Chief included across the demos), and `at 1, 5, 12 and 30 crew` (browser, no crew Office panel/group says "Needs you", Chief's does; no crew panel/row has a button or the ask's head; the one Office button is Chief's, with Needs you's count, to `#/chief`).

`test/ui.test.ts`: `the phone crew list reads the rail status: one rule for every pill` — `crewPill` (`A.statusOf`) is the phone pill's own word and dot for every helper, a missing member falls back to its own words, and `HelperPill` calls `crewPill`, never `h.status`.
