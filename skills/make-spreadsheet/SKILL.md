---
name: make-spreadsheet
description: Build a real .xlsx the person can open and use, with crew_workbook. Use for any request for a spreadsheet, workbook, "an excel", a tracker, a log, a roster or a schedule. Never describe a spreadsheet instead of making one.
says: Make a spreadsheet you can use straight away
---

# Make a spreadsheet

1. When the request names a place or a role but not what to track ("for reception", "for the shop", "as a manager"), ask exactly one question offering 2-3 kinds plus "something else", then stop and wait for the answer. Never build in the same turn as the question.
2. Call `crew_workbook` with the whole workbook finished, in this shape: `{name, sheets:[{name, columns:[{header,width?,options?}], rows}]}`. Two to five sheets, each with plain column headings and one example row that looks like a real one, so the person sees how to fill it in.
3. Put what they look at first on the front sheet: a small dashboard of counts and totals, as formulas over the other sheets (`=COUNTIF(...)`, `=SUM(...)`), not numbers you typed in yourself.
4. Turn a column into a dropdown (`options`) wherever the same few words keep coming back: statuses, paid or not, yes or no. Write dates as `YYYY-MM-DD` so they sort and can be counted.
5. Two sheets beat one crowded one; five beat six. Every sheet earns its place or it goes.
6. Deliver it, then say in one line what is inside and what to fill in first. Never stop at describing the workbook, and never write the file yourself — crewd makes it.

## When they answer "reception": hotel guest reception

Build this outline, keeping its sheets, its dropdowns and its one example row per sheet:

```json
{
  "name": "Hotel Guest Reception",
  "sheets": [
    {
      "name": "Dashboard",
      "columns": [{ "header": "Measure" }, { "header": "Number" }, { "header": "Where it comes from" }],
      "rows": [["Rooms ready", "=COUNTIF('Rooms & housekeeping'!B2:B40,\"Ready\")", "Rooms & housekeeping"]]
    },
    {
      "name": "Bookings & check-in",
      "columns": [{ "header": "Guest" }, { "header": "Room" }, { "header": "Check-in" }, { "header": "Status", "options": ["Booked", "Checked in", "Due out"] }],
      "rows": [["Amina Khan", "204", "2026-10-01", "Checked in"]]
    },
    {
      "name": "Rooms & housekeeping",
      "columns": [{ "header": "Room" }, { "header": "State", "options": ["Dirty", "Cleaning", "Ready"] }, { "header": "Checked by" }],
      "rows": [["204", "Ready", "Rani"]]
    },
    {
      "name": "Payments",
      "columns": [{ "header": "Guest" }, { "header": "Amount" }, { "header": "Method", "options": ["Cash", "Card", "Transfer", "Unpaid"] }, { "header": "Paid on" }],
      "rows": [["Amina Khan", 120, "Card", "2026-10-01"]]
    },
    {
      "name": "Setup & guide",
      "columns": [{ "header": "Step" }, { "header": "What to do" }],
      "rows": [["1", "Fill in Bookings & check-in as guests arrive; card payments go on Payments"]]
    }
  ]
}
```
