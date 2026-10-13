# Delivered files: the person's authority, never the loopback

**What it proves.** A helper's sandboxed shell shares the host's loopback, so `GET /files/<bot>/<path>` (src/server.ts)
answers only a caller holding the person's authority: the `person.key` as `Authorization: Bearer …`, or the
`crewhouse-files` cookie. The web app mints that cookie once at start with `POST /api/files/session` (bearer +
`x-crewhouse`; HttpOnly, SameSite=Strict, `Path=/files`; its value is an HMAC of the key, never the key). Anything else
gets 403 and none of the file's bytes. The person opens every delivered file at its plain `/files/` address: pictures
and videos in `<img>`/`<video>` (video seeks with Range), PDFs and text in their own tab, the spreadsheet's Download
link. The phone and paired web app never use `/files` (they read `/api/photo`, `/api/document`, `/api/workbook`,
`/api/video` over the link; `test/link.test.ts`), and `?demo` keeps its addresses untouched.

**Drive and prove** (stub engine, web built with `npm run build:web`):

```bash
bash .agents/skills/verify-crewhouse/scripts/files-gate.sh . "$EV/files-gate"            # full run
bash .agents/skills/verify-crewhouse/scripts/files-gate.sh <main-export> "$EV/before" --no-browser   # the old build, host half only
```

It has Reel make a PNG, a PDF and an mp4 in its own shell and register them with `crew_deliver`, plus an xlsx from
`crew_workbook`, then writes:

- `curl-matrix.tsv`: per file, no headers / public header only / wrong key / wrong cookie / range without a key → **403,
  no bytes**; the person's browser cookie → 200 and its range → 206 with the file's own bytes; the person's key → 200.
- `helper-shell-attack.txt`: Tracer's own sandboxed shell curls each of Reel's files → **403** per file, "not leaked"
  (on a build before this gate: 200 and LEAKED).
- `address-check.txt` "address clean" (the launcher fragment left the URL); `picture-check.txt` `src: /files/` with a
  real width at 1440/390 night/day; `video-check.txt` `src: /files/` with a duration after Play; `pdf-tab.txt` a second
  tab on a `/files/` address; `download-check.txt` the Download link's bytes, named `trip-costs.xlsx`, starting `PK`.
- `screens/`: `reel-thread-{night,day}-{1440,390}.png`, `video-night-1440.png`, `pdf-tab-1440.png`,
  `sheet-panel-night-1440.png`, `sheet-panel-day-390.png`, `demo-sheet-{night-390,day-1440}.png`.

Open every screen: the picture and video show (no broken-image icon or bare file name), the PDF renders, the panel's
table reads in full. The pinned test is `raw /files/ only opens delivered files, and only for the person` in
`test/stub.test.ts`.
