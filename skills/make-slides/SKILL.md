---
name: make-slides
description: Build a real .pptx deck the person can open and present, with crew_slides. Use when the answer is shown or read aloud to other people — a pitch, a training, a review, a kick-off, a plan for a meeting — and never for something the person keeps, sends or reads alone, which is a document.
says: Make a slide deck you can present
---

# Make a slide deck

1. A deck is only right when someone stands up with it. An email, a letter, a report, a handbook or a list to keep is a document: use `crew_document` instead.
2. Ask at most ONE question, and only when the audience or the occasion is genuinely unclear ("who is this for?"). Anything else you can infer, infer — then build.
3. Call `crew_slides` with the whole deck finished, in this shape: `{name, slides: [{title, bullets: ["point", …]}, …]}`. Two to ten slides. The first slide says what the deck is.
4. A slide is a few short lines, not a paragraph. One idea per slide; if a bullet needs a comma and a clause, it is two slides or it belongs in the notes you say out loud.
5. Numbers people will question go on their own slide ("Costs": train, room, food), as plain figures, not a table of figures.
6. Name each slide after what it answers ("What it costs", "Why now", "The first week"), not "Introduction" or "Slide 3".
7. Deliver it, then say in one line what is inside and what to walk through first. Never stop at describing the deck, and never write the file yourself — crewd makes it.

## When they answer "a kick-off for the new shop": launch kick-off

Build this outline, keeping one line per bullet:

```json
{
  "name": "New shop kick-off",
  "slides": [
    { "title": "Opening the new shop", "bullets": ["Doors open Saturday 4 October", "Amina manages the floor"] },
    { "title": "Why now", "bullets": ["The old unit's lease ends in November", "Weekend footfall is three times the weekday"] },
    { "title": "The first week", "bullets": ["Wednesday: stock arrives", "Thursday: staff run-through", "Saturday: opening day"] },
    { "title": "What it costs", "bullets": ["Fit-out £8,400", "First stock £5,200", "Staff £1,900 a week"] },
    { "title": "What we need from you", "bullets": ["Approve the fit-out quote", "Name the weekend team"] }
  ]
}
```
