# Your things

Your things (`Things` in `web/src/main.tsx`, route `#/things`) on the final Stack J07a, and a file opened from it
(J07b, `PreviewPanel` in `web/src/parts.tsx`). Approved mocks: `things` (J07a) and `things-file` (J07b) in
`scripts/verify/mocks.tsv`; the desktop targets are `J07a-1280-{day,night}.png` and `J07b-1280-{day,night}.png`.
Contract: [ui-contract.md](../ui-contract.md), "Chief's profile" (the Your things sentence).

## What it proves

- Phone: a round back, "Your things" in the wide face and "Everything the crew has made for you.", then Today,
  Yesterday and Earlier, each finished file as its maker's colour card: face, name, "Spreadsheet · Invoice Ivy ·
  10:04 am", a sheet's top-left corner as a cream table, and a black Open. A page's card has no peek on a phone.
- Computer: a header bar with "Search your things", two cards a row (a page's card shows its first lines), and the
  newest sheet or page open in the column beside: its file row, its first three columns, and Download.
- Search: one word ("letter") leaves only the thing whose title, maker or file holds it; no match says so.
- Open on a sheet: the read-only page (`#/f/<helper>/<file>/<title>`): Back, the name, "By Invoice Ivy",
  Download, the table and its sheet pills ("Invoices", "Paid"); on a computer it covers Your things with "About
  this file" and "Ask about it" beside, and the side menu stays on Your things.

## How to drive it

`done-done run stack-design` (`scripts/verify/stack-design.sh <evidence-dir>`, `EVIDENCE_HOME` set for the mock
pairs): the stub-engine crewd, a yes to Chief's Invoice Ivy card and a `crew_workbook` call in Ivy's thread for
"Your invoices" (two sheets), Writer Will's Heating letter. Captures `things-*`, `things-file-*` (a click on the first
card) and `things-search-day-1280` at 390 and 1280, day and night, through `pwa-shell.mjs`; the installed window
adds `pwa-things-*`. The run fails when a file opened from Your things is not Ivy's sheet or the search leaves more
than one card.
