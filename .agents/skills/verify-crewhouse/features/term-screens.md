# Things, routines, helper details and the file panel in Term

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
