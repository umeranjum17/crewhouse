# Interview prep

Part of the crewhouse verification map. Source: `docs/verification/jobs-prep.md`.

## How to get to it (user POV)

Your goal (`#/goal`) → Interview column → a role → Prep for this interview; then Open your interview prep (`#/goal/<role>`) → Practice with the interviewer, which opens the writer's chat.

## Driving it

1. Needs a built web app (`npm run build:web`) and `/usr/bin/chromium`.
2. Run `NODE=/usr/bin/node scripts/verify/jobs-prep.sh <out>`; it boots its own stub lab and company page and tears both down.
3. Capture: `{prep-offer,prep-card,prep-brief,prep-questions,practice}-{390,1280}-{day,night}.png` and `pwa-*-390-{day,night}.png`; exit 0 means no gate failed.
4. Voice: `practice-voice`, `practice-speaking` and `practice-turn` (same sizes) run with a stand-in device voice; read `practice-turn-said-*.json`: the question, then the feedback, never the typed answer.
