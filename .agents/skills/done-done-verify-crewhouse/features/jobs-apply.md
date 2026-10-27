# The application form

Part of the crewhouse verification map. Source: `docs/verification/jobs-apply.md`.

## How to get to it (user POV)

From the writer's draft card in Chief's thread (Home's "Chief has 1 thing for you"), tap Fill it in for me. The card that follows lists what was filled and the questions left for him, with Submit; the writer's thread then holds the reading pack (a document).

## Driving it

1. Needs a built web app (`npm run build:web`), `/usr/bin/chromium`, and a tools dir with the browser installed (`CREWHOUSE_TOOLS_DIR=<dir> ./crewhouse tools install browser`).
2. Run `BROWSER_TOOLS=<dir> NODE=/usr/bin/node scripts/verify/jobs-apply.sh <out>` for the local posting, or add `<posting-url> <company> <title>` for a real one (stops at the card).
3. Phone: run `BROWSER_TOOLS=<dir> scripts/verify/phone-apply.sh <out> [apk]` on the release APK (emulator, stub engine).
4. Check: `writer-calls.jsonl` shows the refused submit/consent/visa/salary calls, `form-card.json` has the person's questions blank, and `sent.json` (local only) holds his answers. Captures: `{draft,form,pack,form-answered,applied}-{390,1280}-{day,night}.png` (`pack` is the reading pack's panel: each part's lines with their pages, "Not stated" where none) and `pwa/pwa-form-390-{day,night}.png` from a real install (needs `xvfb-run`).
