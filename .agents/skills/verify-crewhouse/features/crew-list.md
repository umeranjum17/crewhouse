# The crew list: only Chief says "Needs you"

One install is one person, and the person talks only to Chief. A crew member waiting on
the person reads **Waiting** (the neutral seat word and style); only Chief says **Needs
you**. The ask itself reaches the person through Chief (Home's Needs you rows), so no crew
row wears the red needs style. The crew rail (`SideCrew`, the desk's `Your crew` column)
and the crew page (`#/crew`) both follow this.

## Sub-features

- `rail` — the desk rail beside Chief (`web/src/main.tsx` `SideCrew` → `A.railWord`): a crew row with an ask reads `Waiting`, never `Needs you`.
- `page` — `#/crew` (`web/src/main.tsx` `Crew`): a crew row's status word is neutral (`Waiting`), never `Needs you`; a working row keeps its green dot.
- `chief` — Chief's own word is `Needs you` (rail `.side-status`, `A.chiefWord`), unchanged.

## How to get to it (user POV)

- Home opens on Chat with Chief; the rail is the `Your crew` column on a desk (≥900px wide).
- `#/crew` is Home's `Your crew` page (the `Your crew` label in the rail, or the crew list on a phone).

## Driving it with the browser

Preconditions: `?demo` runs the mixed demo crew whose Tracer waits on the person (no crewd);
`?demo=crew5` is the layout crew. Drive the real crewd to an open ask when proving the live path.

- **Crew page words.** Open `?demo&night#/crew` at 1440; `eval` `[...document.querySelectorAll('.crew-row .status-word')].map((e) => e.textContent)` — no entry is `Needs you`, and a waiting helper (Tracer) is `Waiting`.
- **Rail words.** Open `?demo&night` at 1440 (the rail is desk-only); `eval` `[...document.querySelectorAll('.side-row .side-seat')].map((e) => e.textContent)` — no entry is `Needs you`; and `document.querySelector('.side-status').textContent` is `Needs you` (Chief).
- **Themes/widths.** Repeat at `?day`/`?night` and 1440 (desk) and 390 (phone, the rail is hidden; the crew page is the list).
- **Installed app.** Launch Chrome in app mode (`--app=<url>`, `matchMedia('(display-mode: standalone)')` true) and repeat — no standalone-only code, so the words are identical.

## Gotchas

- The Office view's own grouping (`glowOf`, the phone's `Needs you` group) is a separate surface, not the crew list; this rule is about the crew rows.
- The avatar ring (`h.ring === 'needs'`) is the "this helper has an ask" cue, not the seat word; it stays.
- `?demo` intercepts every API call, so it proves the words, not the live counts; drive the real crewd for the live path.

## Pinned by

`test/office.test.ts`: `office truth` (`A.railWord`/`A.chats`/`A.chiefWord`) and `your crew reads whole` (browser, `#/crew` and the rail at 1440, day and night).
