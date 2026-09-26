---
name: make-spreadsheet
description: Build a real .xlsx the person can open and use, with crew_workbook. Use for any request for a spreadsheet, workbook, "an excel", a tracker, a log, a roster or a schedule. Never describe a spreadsheet instead of making one.
says: Make a spreadsheet you can use straight away
---

# Make a spreadsheet

1. Ask at most ONE question, and only when the purpose is genuinely unclear ("who fills this in, and when?"). Anything else you can infer, infer — then build.
2. Call `crew_workbook` with the whole workbook finished: 2 to 5 sheets, each with plain column headings and one example row that looks like a real one, so the person sees how to fill it in.
3. Put what they look at first on the front sheet: a small dashboard of counts and totals, as formulas over the other sheets (`=COUNTIF(...)`, `=SUM(...)`, `=TODAY()`), not numbers you typed in yourself.
4. Turn a column into a dropdown (`options`) wherever the same few words keep coming back: statuses, states, paid or not, yes or no.
5. Two sheets beat one crowded one; five beat six. Every sheet earns its place or it goes.
6. Deliver it, then say in one line what is inside and what to fill in first. Never stop at describing the workbook, and never write the file yourself — crewd makes it.
