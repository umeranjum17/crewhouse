# The crew list: only Chief says "Needs you"

One install is one person, and the person talks only to Chief. A crew member waiting on
the person reads **Waiting** (the neutral seat word and style); only Chief says **Needs
you**. The ask itself reaches the person through Chief (Home's Needs you rows), so no crew
row wears the red needs style. The crew rail (`SideCrew`, the desk's `Your crew` column)
and the crew page (`#/crew`) both follow this.

## Sub-features

- `rail` — the desk rail beside Chief (`web/src/main.tsx` `SideCrew` → `A.railWord`): a crew row with an ask reads `Waiting`, never `Needs you`.
- `page` — `#/crew` (`web/src/main.tsx` `Crew`): a crew row's status word is neutral (`Waiting`), never `Needs you`; a working row keeps its green dot.
- `office` — the Office view (`web/src/office.tsx` `glowOf`/`TITLES`, `mobile/src/office.tsx`): a crew panel/group/row reads `Waiting`, never `Needs you`; the glow class and colour are kept.
- `chief` — Chief's own word is `Needs you` (rail `.side-status`, `A.chiefWord`, the Office `ChiefPanel` glow), unchanged.

## How to get to it (user POV)

- Home opens on Chat with Chief; the rail is the `Your crew` column on a desk (≥900px wide).
- `#/crew` is Home's `Your crew` page (the `Your crew` label in the rail, or the crew list on a phone).

## Driving it with the browser

Preconditions: `?demo` runs the mixed demo crew whose Tracer waits on the person (no crewd);
`?demo=crew5` is the layout crew. Drive the real crewd to an open ask when proving the live path.

- **Crew page words.** Open `?demo&night#/crew` at 1440; `eval` `[...document.querySelectorAll('.crew-row .status-word')].map((e) => e.textContent)` — no entry is `Needs you`, and a waiting helper (Tracer) is `Waiting`.
- **Rail words.** Open `?demo&night` at 1440 (the rail is desk-only); `eval` `[...document.querySelectorAll('.side-row .side-seat')].map((e) => e.textContent)` — no entry is `Needs you`; and `document.querySelector('.side-status').textContent` is `Needs you` (Chief).
- **Office words.** Open `?demo&night`, tap Office in the bar; `eval` `[...document.querySelectorAll('.office .p-state')].map((e) => e.textContent)` (desk) or `[...document.querySelectorAll('.office .grp')].map((g) => g.getAttribute('aria-label'))` and each row's `.p-state` (phone) — no crew panel/group says `Needs you`; Chief's panel does.
- **Themes/widths.** Repeat at `?day`/`?night` and 1440 (desk) and 390 (phone, the rail is hidden; the crew page is the list).
- **Installed app.** Launch Chrome in app mode (`--app=<url>`, `matchMedia('(display-mode: standalone)')` true) and repeat — no standalone-only code, so the words are identical.

## Gotchas

- The Office view's own grouping (`glowOf`, `TITLES`, the phone's grouped list) is covered too: a crew panel/group reads `Waiting`; only Chief's panel says `Needs you`. Its glow class/colour is unchanged.
- The avatar ring (`h.ring === 'needs'`) is the "this helper has an ask" cue, not the seat word; it stays.
- `?demo` intercepts every API call, so it proves the words, not the live counts; drive the real crewd for the live path.

## Pinned by

`test/office.test.ts`: `office truth` (`A.railWord`/`A.chats`/`A.chiefWord`), `your crew reads whole` (browser, `#/crew` and the rail at 1440, day and night), and `at 1, 5, 12 and 30 crew` (browser, no crew Office panel/group says "Needs you", Chief's does).
