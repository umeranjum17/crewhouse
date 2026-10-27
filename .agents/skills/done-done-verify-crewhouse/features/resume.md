# The resume

Part of the crewhouse verification map. Source: `docs/verification/resume.md`.

## How to get to it (user POV)

Paste a CV into Chief's chat and ask for a resume; open the resume card. Edit, change a line, Save; tap PDF or Word.

## Driving it

1. Needs a built web app (`npm run build:web`), `/usr/bin/chromium`, poppler (`pdftoppm`, `pdftotext`) and LibreOffice (`soffice`).
2. Run `NODE=/usr/bin/node scripts/verify/resume.sh <out>` (or `done-done run resume`); it boots its own stub-engine lab and tears it down.
3. Capture: `{resume,edit,saved}-{390,1280}-{day,night}.png`, `pwa-{resume,saved}-390-{day,night}.png`, `chat-*.png`, `refusal.json`, `export-pdf.png`, `export-word.png`, `export-text.txt`; exit 0 means no gate failed and both saved files hold the edit.
