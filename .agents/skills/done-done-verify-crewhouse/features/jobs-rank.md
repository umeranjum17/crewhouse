# Role ranking

Part of the crewhouse verification map. Source: `docs/verification/jobs-loop.md` (`ranking`).

## How to get to it (user POV)

Your goal (`#/goal`) → Found column: roles come best-fit first, each with a one-line reason in the page's own words; open a role → Why it ranks here. Chief's look lists the same order in his chat.

## Driving it

1. Needs a built web app (`npm run build:web`), `/usr/bin/chromium` and the network: the posting pages are real public Greenhouse boards.
2. Run `NODE=/usr/bin/node scripts/verify/jobs-rank.sh <out>`; it boots its own stub lab, searches the boards, reads the pages, files the roles with the signals it quotes, checks the order and that every quote is still on its page, then captures.
3. Capture: `{board,role}-{390,1280}-{day,night}.png`, `pwa-{board,role}-390-{day,night}.png`, `thread-demo-*` (the chat's layout on demo data) and `search.json`; exit 0 means the order held and no gate failed.
