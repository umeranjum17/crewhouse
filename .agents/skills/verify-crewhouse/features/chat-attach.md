# Attach a file in Chief's chat

The paperclip (the round + on a phone) takes a PDF or a common document (pdf, docx, xlsx, csv, txt, md) or a
photo. crewd saves a document to the helper's `files/inbox/<task>-<n>.<ext>` under its own name (the person's
file name is a display label only), adds the inbox path to the task body for the documents tool, and the thread
shows a file card above the person's words: the name on one line with an ellipsis, then kind and size, and Open.

## Drive

1. Onboard (`PUT /api/people/1 {"name":"Umer"}`, `POST /api/onboard {"address":"Umer"}`), open `#/chief`.
2. Pick a file on the app's own picker: headless Chromium has no file dialog, so stage it on
   `.composer input[type=file]` (a `DataTransfer` `File`, then a `change` event). The composer shows its chip
   (`.c-file`: name, `PDF · 1 KB`, ✕). Type the words, press Enter.
3. SQLite: the person's line reads `[file scribe] files/inbox/1-1.pdf <bytes>B <name>`; the task body ends
   `Files attached (in files/inbox; read them with the documents tool): files/inbox/1-1.pdf`; `cmp` the inbox
   file with the sent one.
4. Captures with the card and words in view (`--then` waits for `.line.me .doc` and scrolls its `.line-wrap` to
   the top): `look-check.mjs web --text 1 --width 390 --height 844` and `--width 1440 --height 900` for the
   plain shots, the default (360, 1.3x) with slug `chief-attach` for the largest text beside mock 3A, and the
   installed app at 390 per [pwa-shell.md](pwa-shell.md).

## Refusals

`node --test test/unit.test.ts` covers allow, a refused type, a refused size and a hostile file name.

## Known

A long name at 1.3x text shows under half before its ellipsis; look-check reports it as clipped. The cut is the
requested design (one line, never hyphen-broken); the full name is the card's tooltip and the file opens on tap.
