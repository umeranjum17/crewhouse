# Slide decks: a real .pptx the person can open and present

**What it proves.** A helper asked for a deck gets `crew_slides`, and crewd itself writes the `.pptx`
parts (OOXML DrawingML through the already-pinned jszip, the same route the workbook charts take) into the
bot's `files/` and delivers it like any other finished file. The file is a deck a second implementation opens,
and the app previews it the way it previews the other finished files: one frame per slide in the same panel.

**Drive and prove** (stub engine, web built with `npm run build:web`):

```bash
bash .agents/skills/verify-crewhouse/scripts/slides-deck.sh . "$EV/slides-deck"
```

It has Quill make a 5-slide kick-off deck with `crew_slides`, then writes:

- `deck-file.txt`: `crew_slides` delivered `files/new-shop-kick-off.pptx` as N bytes, `Microsoft PowerPoint 2007+`,
  every part a presentation needs (`ppt/theme/theme1.xml`, master, layout, `slide1..5.xml`), and slide 5's own words.
- `libreoffice.txt`: LibreOffice converts it to PDF, `Pages: 5`; `screens/slides-render-*.png` draw every slide.
- `api-document.txt`: `/api/document` reads it back as 5 slides with lines plus the same words flattened as parts,
  and a path nobody delivered answers **403**.
- `card-words.txt` the chat card ("Deck · 5 slides", Open); `panel-check.txt` 5 `.slide-frame`s, the first slide's
  words, "Deck · 5 slides", and Download handing over the file's own `PK` bytes.
- `screens/`: `deck-card-{day-390,night-1440}.png`, `deck-panel-{day,night}-{1440,390}.png`, beside the `?demo` control.
- `look/`: the look check at 360 with the largest text, deck panel beside the untouched workbook panel control.
- `pwa/`: the same panel in the installed app at 390 and 1440, day and night, with `install-sheet.png`.
  The launcher waits until its private fragment is consumed; the installed window gets its own launcher before capture.
  `run.json` must show standalone mode true for all four panel captures, with no error rows.

Open every screen: each slide frame shows its title over its lines, no clipped text or overlap, no raw markup,
crew counts agreeing with the thread. The pinned tests are the two `deck` tests in `test/documents.test.ts`.
