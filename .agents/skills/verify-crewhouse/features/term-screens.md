# Things, routines, helper details, the file panel, first run and Share in Term

These screens wear the same Term look as Home and Your crew: a file row carries the shared
`o-ic` extension tile (never the old pastel `file-chip`), names and titles read in full and
wrap, each routine has one filled-blue primary (`btn go`, Do it now), its See result link is
a plain `link` (never the coral `link pink`), and the file panel's Download is the blue primary.

## How to get to it (user POV)

- Things: `#/things` (a thing deep link is `#/things/t<id>`).
- Routines: `#/routines`.
- Helper details: a helper's page, Details tab — `#/h/<id>/details` (What it made, Routines).
- File panel: tap a workbook card in a helper's chat or Things — `#/f/<helper>/<file>`.

## Driving it with the browser

Preconditions (real crewd, stub engine started with `CREWHOUSE_STUB_GOLDEN=1` for the scripted replies): onboard, then message Chief
`[tool crew_recruit {"template":"reel","name":"Reel"}]`, then message Reel
`Sort out my invoices` (the stub's scripted reply delivers the workbook `Your invoices`), and add a routine with
`POST /api/routines` (`{"bot":"reel","name":"Check the invoice sheet","schedule":"weekdays 9:00","task":"Check the invoice sheet"}`).
The stub cannot deliver image or document-kind files; `?demo` covers those rows for pure layout.

- **Markers.** `eval` `document.querySelectorAll('.file-chip, .link.pink').length` — 0 on every screen.
- **Primary.** `.routine .btn.go` reads Do it now on each routine row; `.wb-panel .btn.go` reads Download.
- **Full names.** For every row `b`, `scrollWidth <= clientWidth + 1`; no child box crosses a sibling or the row.
- **Widths and themes.** 390 and 1440, `?day` and `?night` — the four captures per screen.

The same checks run headless in `test/office.test.ts` ("things, routines and helper details read Term").

## First run (Hello) and the Share sheet

Hello: Chief's greeting is plain words under his helmet (`.speech` has no border or fill, no bubble arrow), and each
idea wears the shared `o-ic` tile. Share: what came in reads in full (`.said`, no clamp), Chief speaks with his drawn
helmet face in the name column on a desk, beside his name on a phone (`.line-by .face img.ink`), and the three choices are buttons with one blue primary
(`.share-acts .btn.go`), never the old `chip`s.

- **Get there.** A fresh crewd opens on Hello at `/`. After `POST /api/onboard`, open
  `/share?title=…&text=…&url=…` (what the phone's Share target sends).
- **Check.** `eval` `document.querySelectorAll('.idea > .o-ic').length` equals the idea count; on Share,
  `.share .chip` is 0, `.share .btn.go` is 1, and `.said` has `scrollHeight <= clientHeight + 1`.
- **Motion.** Tap Something else…: the composer appears under the buttons.

Headless: `test/office.test.ts` ("first run and the Share sheet read Term").

## On a phone (under 900 wide)

Fewer things, the whole width. Hello has no wordmark: greeting, then "What shall I call you?" as a small inline box
(`.name-ask input`, or a Call me something else link once named), the three ideas, How it works, and Chief's normal
box pinned at the foot (`.hello-ask .composer`). A thread is a conversation, not a transcript: no name on any turn
(`.chat .line-by` is clipped for screen readers only), Chief's turns in grey bubbles that hug their words and the
person's in ink ones on the right (`.line.me`); cards share Chief's grey. Ink is the one accent, the chat screen's
visible type is 17/24 and 13/18 only, and turns sit 6px apart within a speaker and 22px when it changes. An ask card is
one block: its title, one quiet grey line, the evidence with no inner box, then one ink primary and a "⋯" pill of
the same 44px height and radius (`.more-dots`); the rest (`.more-act`) wait in a bottom sheet with the card's title
on top and one full-width row each (`.more-sheet .more-row`). The live to-do's head is one quiet 13px line, "Scout ·
at work · 12 s · Open chat ›", and its steps share that size: a 9px mark on each step's first baseline, a check for
done, a spinner (a faint full ring with an ink half turning on it) for doing, a closed grey ring for to do. Chief's own reply done in under
a second leaves no "Done · 0 s" row. The composer is a round +, a grey pill with the mic inside and a round ink send.
The Home header is Muse's, compact: the helmet as a soft 3D figure (`.ch-art img.helmet`, `art.helmetSoft`: a lit
ceramic shell, a glass visor, glowing eyes and a soft contact shadow on the pill; the same white shell in day and night, no
disc, its left rounded to a whole pixel) at the top centre, overlapping a one-line pill with Chief and his status, the round gear on
its line, then the Chief | Office switch as a borderless pill track across the column, and the day line right under
it (no band). A thread page's head is the name alone. Sign-in choices are one list of plain rows
(`.ai-picks .btn`). A fresh helper shows at most three starters. A desk keeps the named transcript and the card's
buttons in a row (`.more-dots` hidden).

- **Check.** At 360, 390 and 430 over Hello, Home, Office, fresh, first, a helper, Settings, an ask, Apps and Things
  (`?demo` variants): no text box wider than its clip parent, nothing painted past the screen edge, no document
  scroll, and every `pre.art.helmet` has `role="img"`. In `?demo` Chief's thread at 390, `.chat .card.ask .more-act`
  is not displayed and each card shows one `.btn.go` and one `.more-dots` (`test/office.test.ts` "a phone card is one
  primary and ⋯" runs this and the sheet at 390 and 1440, day and night).
- **Motion.** Tap a card's "⋯": the sheet rises with the card's title on top; tap Change time: the sheet closes and
  the card's time box opens (`.routine-edit`). Escape or a tap on the scrim closes it.
