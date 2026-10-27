# Your path to the US (cited career plan)

A plan from a job like the person's, to a gateway employer, to a US role. It is information, never legal advice, and it works without asking anything about the person: no citizenship, visa status, pay or notice period is asked for or kept. The same four stages show for every job goal that has a writer: Know the routes, Pick a gateway employer, Check who really sponsors, Build what each route rewards. A stage opens on a tap; an item under it opens to its claims.

## Sub-features

- `entry`: a row on Your goal (`#/goal`, job goals only) and a link beside Open the board on the writer's page; `#/goal/path` opens the plan. The phone app has the same row and screen (`mobile/App.tsx` `Career`).
- `claims`: every claim shows what it says, the source's own words (a data row shows a plain reading of the row), who published it, the page, and the date that page shows (`updated`, `current as of`, or `checked` for a company's own page). A fact that could not be cited is left out.
- `no-asks`: no input, no request, nothing stored. The plan is static data in `web/src/career.ts`, so it needs no crewd change.

## Driving it

`scripts/verify/career-path.sh <out>` builds and serves the web app and captures `career-{goal,closed,open,sponsors}-{390,1280}-{day,night}.png` and `pwa-career-*-390-{day,night}.png` on `?demo=goal`, gated by `home-gate.mjs` (16px text, no clipping, no sideways scroll).

`node scripts/check-career-sources.mjs [--json <file>]` opens every source and fails when a quote is not on its page or the page does not show the date the plan gives. It needs the network, so it is a release check; run it before a release and whenever `career.ts` changes.

## Pinned by

`test/career.test.ts` (shape: every claim has an https page, a real date, its words; no advice wording; the screen has no input), `test/office.test.ts` (the journey at 390 and 1440, day and night) and `test/plain-words.test.ts` (the plan's own copy).
