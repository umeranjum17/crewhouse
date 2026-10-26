# Jobs loop

Part of the crewhouse verification map. Source: `docs/verification/jobs-loop.md`.

## How to get to it (user POV)

Tell Chief the roles, the places and paste a CV; say yes to the goal card; open Jobs → Your goal (`#/goal`). Draft my application on a Found role; copy the draft; I applied.

## Driving it

1. Needs a built web app (`npm run build:web`) and `/usr/bin/chromium`.
2. Run `NODE=/usr/bin/node scripts/verify/jobs-loop.sh <out>`; it boots its own stub-engine lab and a local posting page and tears both down.
3. Capture: `{goal-card,board,role,draft,applied}-{390,1280}-{day,night}.png` and `pwa-*-390-{day,night}.png`; exit 0 means no gate failed.
