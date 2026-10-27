# Jobs loop

Part of the crewhouse verification map. Source: `docs/verification/jobs-loop.md`.

## How to get to it (user POV)

Tell Chief you want a job and send a CV (pasted, or a PDF); Chief's chat shows the first look live and the roles it found as cards; say yes to the goal card; open Jobs → Your goal (`#/goal`). Draft my application on a Found role; copy the draft; I applied.

## Driving it

1. Needs a built web app (`npm run build:web`) and `/usr/bin/chromium`.
2. Run `NODE=/usr/bin/node scripts/verify/jobs-loop.sh <out>`; it boots its own stub-engine lab and a local posting page and tears both down.
3. The phone's first hour on the real engine: `bash scripts/verify/first-hour.sh <out> [apk]` (emulator, OpenClaw with the scripted provider `first-hour-model.ts`, network for Ashby's public boards): `first-hour.mp4`, `screens/01-home … 11-rae.png`, `first-hour.json`.
4. Capture: `{goal-card,board,role,draft,applied}-{390,1280}-{day,night}.png` and `pwa-*-390-{day,night}.png`; exit 0 means no gate failed.
