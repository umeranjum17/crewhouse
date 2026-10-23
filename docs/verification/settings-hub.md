# Settings hub and the hire card's name

Settings (`Settings` in `web/src/main.tsx`, route `#/settings`) on the final Stack J09a, and the hire card's one-line
name (A069). Approved mocks: `settings` (J09a) and `ask-hire` (J04a) in `scripts/verify/mocks.tsv`; the desktop target
is `J09a-1280-{day,night}.png` beside them.

## What it proves

- Phone: a round back, "Settings" in the wide face, the trust card (its bold line, then the plain one), then You, What
  the crew remembers, AI accounts, Apps and Phones as one card (40px tiles, 17px titles over 16px lines), then Look as a
  full-width three-way switch with "Match device" on one line; Install, Getting set up and Google setup follow.
- Computer: a header bar ("Settings"), the trust card across the width, then two columns: You (You, What the crew
  remembers), Look and Install on the left; Connected (AI accounts, Apps, Phones) with Getting set up and Google setup
  on the right.
- A hire card names the helper on one line, shrinking from 26px to fit (20px at the least, "Translator Tess" at 390),
  and its yes says the helper's first name: "Yes, bring Ivy on" (crewd's `detail.yes`, `src/crew.ts`).

## How to drive it

A lab crewd on the stub engine ([runbook.md](runbook.md)) seeded like `scripts/verify/home-states.sh busy` (Chief
asking to bring Invoice Ivy on). At 390×844×3 and 1280×832, `?day` then `?night`: `#/settings`, screenshot; `#/chief`,
scroll the last `.stack-ask` into view, read each `.hire-name`'s `scrollWidth` against its column (equal: one line),
screenshot. Pair each shot with its mock (mock left, app right) with `magick … +append`.
