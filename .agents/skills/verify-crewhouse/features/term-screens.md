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

Fewer things, the whole width. Hello has no wordmark: greeting, the three ideas, Or ask in your own words, then the
four promises as quiet text (no boxed card). Every thread (Home, `#/chief`, a helper's page) drops the name column:
the name sits small above the words, ask cards lose their indent, and a thread page's head is the name alone (its
role is in the hero under it). An ask card's name and status share one line; a routine card shows its lines, not its
headline twice. Sign-in choices are one list of plain rows (`.ai-picks .btn`, no blue primary). A fresh helper shows
at most three starters, and they wrap.

- **Check.** At 360, 390 and 430 over Hello, Home, Office, fresh, first, a helper, Settings, an ask, Apps and Things
  (`?demo` variants): no text box wider than its clip parent, nothing painted past the screen edge, no document
  scroll, and every `pre.art.helmet` has `role="img"` (a screen reader says its name, not hundreds of `%#*`).
  `.page .line .line-by` is a block above `.bubble-text` (its top below the name's bottom).
