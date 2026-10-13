# Delivered files: the person's authority, never the loopback

**What it proves.** A helper's sandboxed shell shares the host's loopback, so `GET /files/<bot>/<path>` (src/server.ts)
answers only a caller holding the person's `person.key` as `Authorization: Bearer …`; anything else gets 403 and none of
the file's bytes. The person still sees and opens every delivered file: the web app fetches the bytes with the key and
shows them from a `blob:` address (`fileUrl` in `web/src/api.ts`; `useFileSrc` in `Media` for pictures and videos; one
capture-phase click handler in `web/src/main.tsx` for every `/files/` link — a PDF, picture, video or text opens in its
own tab, anything else downloads under its own name). The phone and paired web app never use `/files` (they read
`/api/photo`, `/api/document`, `/api/workbook`, `/api/video` over the link; `test/link.test.ts`), and `?demo` keeps its
addresses untouched.

**Drive and prove** (stub engine, web built with `npm run build:web`):

```bash
bash .agents/skills/verify-crewhouse/scripts/files-gate.sh . "$EV/files-gate"            # full run
bash .agents/skills/verify-crewhouse/scripts/files-gate.sh <main-export> "$EV/before" --no-browser   # the old build, host half only
```

It has Reel make a PNG, a PDF and an mp4 in its own shell and register them with `crew_deliver`, plus an xlsx from
`crew_workbook`, then writes:

- `curl-matrix.tsv`: per file, no headers / public header only / wrong key / range without a key → **403, no bytes**;
  the person's key → 200 with the file's own bytes.
- `helper-shell-attack.txt`: Tracer's own sandboxed shell curls each of Reel's files → **403** per file, "not leaked"
  (on a build before this gate: 200 and LEAKED).
- `address-check.txt` "address clean" (the launcher fragment left the URL); `picture-check.txt` `src: blob:` with a
  real width at 1440/390 night/day; `video-check.txt` `src: blob:` with a duration after Play; `pdf-tab.txt` a second
  tab on a `blob:` address; `download-check.txt` a `blob:` download named `trip-costs.xlsx` starting `PK`.
- `screens/`: `reel-thread-{night,day}-{1440,390}.png`, `video-night-1440.png`, `pdf-tab-1440.png`,
  `sheet-panel-night-1440.png`, `sheet-panel-day-390.png`, `demo-sheet-{night-390,day-1440}.png`.

Open every screen: the picture and video show (no broken-image icon or bare file name), the PDF renders, the panel's
table reads in full. The pinned test is `raw /files/ only opens delivered files, and only for the person` in
`test/stub.test.ts`.
