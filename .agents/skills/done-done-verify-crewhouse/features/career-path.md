# Your path to the US

Part of the crewhouse verification map. Source: `docs/verification/career-path.md`.

## How to get to it (user POV)

Open Your goal (`#/goal`) on a job-search goal, tap the row Your path to the US (or the same link beside Open the board on the writer's page); `#/goal/path`.

## Driving it

1. Needs `npm run build:web` (the script builds it) and `/usr/bin/chromium`.
2. Run `scripts/verify/career-path.sh <out>` (stub data, `?demo=goal`, no crewd); exit 0 means every shot passed the 16px, clipping and sideways-scroll gate.
3. Capture: `career-{goal,closed,open,sponsors}-{390,1280}-{day,night}.png` and `pwa-career-*-390-{day,night}.png`. Run `node scripts/check-career-sources.mjs` to check the plan's quotes against the live pages (network).
