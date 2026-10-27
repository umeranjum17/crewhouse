# The resume (made from his own words, edited, saved as PDF or Word)

Umer pastes his CV, LinkedIn and GitHub lines into Chief's chat and asks for a resume. Chief asks for what is missing, then calls `crew_resume` with sections of Umer's own lines. crewd checks every line and every heading that is not a plain section name against what Umer wrote in Chief's chat (`jobs.traced`): a piece of one of his lines, case and punctuation aside, and never a line he marked `Private:` or `(private)`. The request's own tool text never counts as his material. The resume is Chief's `files/resume.docx`, written by `buildDocument` like every document and delivered as a card in Chief's chat.

## Sub-features

- `guard`: a line he never wrote, a line he marked private, or a made-up heading is refused with the line quoted, and no resume is made.
- `sources`: the record (`settings` `jobs.resume`) keeps, for each part, when Umer wrote it to Chief; the panel shows it under each part (`From what you told Chief on 27 Oct`).
- `edit`: Edit in the panel turns each part into a box, one line per line; Save sends his words with `PUT /api/resume`, rewrites the same file and marks the part `Edited by you`. Nothing he types there is checked against the chat: it is his own.
- `export`: the panel's PDF and Word buttons (every delivered `.docx` has them) fetch `GET /api/document?…&as=pdf|docx` and save the file. The PDF is written by crewd from the parts it reads back out of the .docx (`pdfOf`), so it says what the document says. It uses Helvetica, the PDF's own font: Latin text only (English and Western European accents); another script needs a TrueType font embedded there.

## Driving it

`NODE=/usr/bin/node scripts/verify/resume.sh <out>` (with `/usr/bin` first on `PATH` on a host whose `node` is a mise shim) boots a stub crewd, drives the chat with `scripts/verify/resume.mjs` (the invented AWS line refused: `refusal.json`), and captures `resume`, `edit` and `saved` at 390 and 1280, day and night, plus `pwa-resume` and `pwa-saved` at 390 in standalone display mode, through `home-gate.mjs` (16px text, no clipping, no sideways scroll). `chat` is captured with its gate recorded but not held (the thread's own small labels). Then it clicks PDF and Word in the app at 1280 and opens what they saved: `export-pdf.png` (poppler), `export-word.png` (LibreOffice), `export-text.txt`, both checked for the edited line. Needs `/usr/bin/chromium`, poppler and LibreOffice.

## Pinned by

`test/resume-document.test.ts` (the guard's three refusals, the source record, the PDF and Word round trip over HTTP, edit-then-export).

## Not built yet

A CV sent as a file (Chief asks for it pasted), reading a public GitHub page as a source, the native phone app's PDF and Word buttons (the phone reads the resume through `/api/document` like any document), and filling an application from the resume (the jobs loop still uses the goal's CV).
