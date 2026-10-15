# A chart in a finished workbook

**What it proves.** `crew_workbook` takes an optional `charts` list (`{type: bar|line|pie, title, sheet, categories,
series: [{name?, values}], at?}`, ranges like `B2:B13` on the named sheet). crewd writes each one as a real DrawingML
chart part in the .xlsx (src/workbooks.ts `withCharts`: chart, drawing, rels, content types), with each series pointing at
the sheet's own cells, so it opens as a chart in Excel or LibreOffice and moves when the person edits the numbers.
`GET /api/workbook` reads each chart back as `{type, title, labels[], series: [{name, values[]}]}` under its sheet,
and the preview panel draws it as SVG over that sheet's table (web/src/parts.tsx `SheetChart`). The app never parses
the file. A chart on a sheet that is not there is a tool error the helper reads, and no file is made.

**Drive and prove** (stub engine, web built with `npm run build:web`):

```bash
bash .agents/skills/verify-crewhouse/scripts/workbook-chart.sh . "$EV/after"                         # full run
PWA=1 bash .agents/skills/verify-crewhouse/scripts/workbook-chart.sh . "$EV/after"                   # plus the installed app
bash .agents/skills/verify-crewhouse/scripts/workbook-chart.sh <main-export> "$EV/before" --before   # the old panel
```

Quill gets one money question ("where my money went since May, with charts") with a `crew_workbook` call carrying a
bar, a line and a pie. The script writes:

- `chart-parts.txt`: `xl/charts/chart1.xml bar 'By month'!$A$2:$A$7 …`, one line per part: three charts, two drawings.
- `libreoffice-render.png`: LibreOffice's own PDF of the file, with the three charts drawn from the cells.
- `workbook.json` / `workbook-charts.txt`: what the app reads: each sheet's charts with their labels and numbers
  (the line's totals are formulas, read as their worked-out values).
- `panel-check.txt`: per look and width, per sheet: the tab, each chart's title, bars/lines/slices drawn, legend words,
  width, and `sideways: false`.
- `screens/chart-panel-{night,day}-{1440,390}.png` (the bar and line sheet) and `screens/chart-panel-pie-…` (the pie).
- `look/`: the mandatory look check at 360 with the largest text, on both sheets. Known and pre-existing: the panel's
  header icon "covers" the chat under the scrim by 5×35 on main too (the `--before` run shows the same hit).
- `pwa/` (PWA=1): `chart-panel-installed-{night,day}-{1440,390}.png` in the installed window
  (`standalone: true` and the chart count per shot in `run.json`).

Open every screen: the bars stand on 0 with round axis numbers, the legend names each series, the pie's legend says
each slice's share, and nothing is cut or covered at 390. The pinned test is `a helper makes one in its own chat: …
carries its chart …` in `test/workbooks.test.ts`.

Not covered: the native phone reader (`mobile/App.tsx` `DocSheet`) shows the sheets' tables only, not their charts.
