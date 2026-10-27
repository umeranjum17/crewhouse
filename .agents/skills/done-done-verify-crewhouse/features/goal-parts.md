# Long-goal parts

Part of the crewhouse verification map. Source: `docs/verification/goal-parts.md`.

## How to get to it (user POV)

Tell Chief what to look for and the stage names; say yes; open Jobs -> Your goal (`#/goal`), pick the goal, open an option, Remind me.

## Driving it

1. Needs a built web app (`npm run build:web`) and `/usr/bin/chromium`.
2. Run `NODE=/usr/bin/node scripts/verify/goal-parts.sh <out>`; it boots its own stub-engine lab and a local listing page and tears both down (about 5 minutes: the reminder is set for one minute ahead).
3. Capture: `{goal-card,jobs-board,flat-found,flat-shortlisted,reminder-set,reminder-fired,reminder-chief,reminder-dismissed}-{390,1280}-{day,night}.png` and `pwa-*-390-{day,night}.png`; exit 0 means no gate failed (`reminder-chief` is not gated).
