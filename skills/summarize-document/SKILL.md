---
name: summarize-document
description: Read a PDF, Word, PowerPoint, Excel or HTML file and summarize it. Use whenever the person hands you a document or a link to one.
says: Read a document and tell you what is in it
---

# Summarize a document

1. Put the file in `work/` (download it with web fetch or the browser if you were given a link).
2. Convert it: `markitdown work/<file> -o work/<file>.md`. Read the Markdown, not the original.
3. Write `files/<short-slug>-summary.md`: **In one line**, **Key points** (5 to 8 bullets, with page or section numbers), **Numbers that matter**, **Open questions**.
4. Call crew_deliver with `files/<short-slug>-summary.md` and a one-line note.
