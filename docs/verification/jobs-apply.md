# The application form (fill, stop at Submit, the person's tap)

From a drafted application, the writer opens the posting's real form in its own browser and types in what it can source from Umer's CV and the approved draft. It never presses Submit. crewd reads the page itself and raises one approval card: the site and page, every line filled, the questions only he answers (declarations, right to work, visa or sponsorship, expected salary, notice, consent, equal-opportunity questions) as blank fields marked for him, and Submit. Only his tap on that card sends the form.

## Sub-features

- `fill`: the draft card's **Fill it in for me** (`{fill: true}`) saves the draft (`jobs.draft.<role>`) and starts the writer's fill task (`jobs.fillTask`). While the goal's writer is on a form, `Crew.decide` lets a browser action through only if the gate can read its target in crewd's own whole snapshot (`browserOf().look`, uncapped): `fill <ref> <text>` on a line that is not `jobs.ONLY_YOU`, with words found whole in the CV or draft (`jobs.sourced`); before the first line, a click on a button or link that does not submit, send, accept or agree; nothing else. Refusals are tool results the model reads.
- `card`: `crew_form {role, stop?}` reads the page (`jobs.formOf`) into `form: {role, url, site, page, filled, fields, submit, next, stop}`. A required file field (a CV upload) or a writer's `stop` (sign-in wall, more steps, anti-bot page) is said plainly in the card's note, and that card has no Submit. The browser stays open for the person's answer.
- `pack`: after the card, the same turn's `crew_prep` makes the reading pack: facts tagged `company` (who they are, what they sell), `role` (the day to day, from the posting) or `loop` (interview stages and topics), each checked against the page it names (a script-drawn page such as an Ashby posting is read from its own description), 3 to 5 questions to test himself with, and his own questions. crewd writes it as a .docx (`Reading pack for <company>`) from the checked facts alone, says "Not stated" under a part no page spoke to, and delivers it in the writer's thread; it raises no card. The same prep backs Prep for this interview and practice later.
- `submit`: the person's Submit (`{answer: 'allow', fields}`) runs `Crew.submitForm`: back on the page if it moved, it re-types the filled lines, puts in his answers, presses the form's own Submit once, and moves the role to Applied (with the 7-day follow-up) only when the page shows it went. A field the page no longer takes is a 409 before any press.

## Driving it

- Web and installed app: `BROWSER_TOOLS=<tools-dir> scripts/verify/jobs-apply.sh <out>` serves a local posting (`jobs-apply.mjs serve`), boots a stub-engine crewd, and runs the writer's scripted turn on the real pinned browser tool. It captures `draft`, `form`, `pack` (the reading pack opened from the writer's thread), `form-answered` and `applied` at 390 and 1280, day and night, plus the form card in a real installed app (Chromium's install from Settings, under `xvfb-run`) at 390 as `pwa/pwa-form-390-{day,night}.png`, and keeps `form-card.json`, `writer-calls.jsonl` (every call and the gate's answer), `form-snapshot.txt`, `stages.json` and `sent.json` (what the local posting received). The tools dir comes from `CREWHOUSE_TOOLS_DIR=<dir> ./crewhouse tools install browser`.
- A real posting: `BROWSER_TOOLS=<dir> scripts/verify/jobs-apply.sh <out> <posting-url> <company> <title>` stops at the card. The scripted pack facts for a company are in `scripts/verify/jobs-pack.json` (OpenAI's Forward Deployed Engineer posting, whose openai.com page is behind a Cloudflare check, is filled on its Ashby form). The scripted turn types only the lines its CV and draft cover, and Submit is never tapped.
- The phone: `BROWSER_TOOLS=<dir> scripts/verify/phone-apply.sh <out> [apk]` runs the same journey from the release app on a task-owned emulator. He taps Fill it in for me, answers on the form card and taps Submit, and the clip `phone-apply.mp4` records it.

The model is scripted (stub engine) in all three: the gate, the page reading, the card and the press are real.

## Pinned by

`test/jobs.test.ts` (the journey: the finder has no browser, the writer's refused submit/consent/email/visa/salary/Yes lines, the card's fields, the reading pack's parts with "Not stated", his answers sent, Applied).

## Not built yet

Attaching a CV file, multi-step forms past the first page (the card says so and stops), and answering for react-select style pickers on a real site has only run on the local form.
