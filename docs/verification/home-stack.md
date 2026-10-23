# Home (Stack J02)

Home opens at every launch. On the web it shows the greeting, Chief's card with his box, Today, Kept and
Hand me a job. A computer adds a header bar, with "Hand Chief a job" and the date, and a column beside the page
for Chief's asks. The native phone app still shows one card per helper; moving it to J02 is its own slice.
There is no Chat | Office switch. Chief's card is the one way to his thread, and crew rows never ask the person.
Every word and count reads `A.office` through `useOffice`.

## Sub-features

- `chief-card` (`web/src/main.tsx` `Home` `.sh-chief`): his Geo face; then either `A.chiefHas` with the heads of what he has (asks, and "<name> has gone quiet") when `counts.needs` > 0, or "Chief is free / at work / waiting" (another word sits beside a plain "Chief") with his latest line. His box sits below. On a phone with asks, the box gives way to Open Jobs and Chat with Chief. The top of the card opens `#/chief`.
- `today` (`.st-today`): one row for each helper that has a job, a held job (resting, or waiting on a sign-in) or a job finished today, in `A.roster` order. The row's background is `art.colourOf(kind)` and its ink `#0B0B0B`. It shows the face, the job's title, the one status pill (`glowOf`) and "<name> · <line>" (a finished row names its first file). A waiting row reads `Waiting for Chief`; no crew row says `Needs you` or has a button. On a phone, Chief's asks lead Today as pink rows ("Chief asks · first job: …" or "· for <helper>"). The pill stays top right on the title's first line; a long title wraps beside it.
- `asks-column` (`.st-asks`, computer only): labelled "Chief has N things for you". It holds one pink `.st-cc` card for each thing Chief has, and none of them repeats in Today. Each card shows the face and the Needs you pill, the head, and one line (a hire: its role, first job and "Nothing changes until you say yes."; a spend: "Anything that costs money asks every time."). Then come the yes, which opens the review sheet, `#/ask/<id>` (Home itself commits nothing), and Not now, which answers deny. A helper gone quiet gets a card that links to Chief's chat.
- `first-day`: with no helpers, Home shows "No helpers yet." and a job list. A computer adds How it works, three steps and a lock line, beside them.
- `resting`: while an account rests, a notice heads Home: a clock, "Your ChatGPT is resting until …", whose job waits, and "Nothing moves to another AI without you." The held job stays in Today.
- `kept` (phone): the fan of three tiles opens `#/things`, worded "N finished jobs and their files".
- `jobs` (`JobList`): up to four `A.jobs` rows, one column on a phone and two on a computer. Tapping a row fills Chief's box; a row that needs an app links to `#/apps`, and a hire row brings that helper on.
- `widths`: 390 and 1280/1440, day and night. Body text is 16px or more (caps labels and pills may be 14px). Nothing is clipped, and nothing scrolls sideways.

## How to get to it (user POV)

- Open the app: Home. Tap Chief's card for his thread; ‹ goes back. The gear (phone) opens Settings.

## Driving it with the browser

- **States, real crewd.** `scripts/verify/home-states.sh <out> first|busy|resting` boots a stub-engine crewd, onboards Umer and seeds the state. In busy, Rae is at work, Will is done with a document (Kept), and Chief asks to bring Ivy on. Resting is the same, except Rae's account rests. The script then captures Home at 390 and 1280, day and night, through `scripts/verify/home-gate.mjs`, which exits 1 on small, clipped or sideways-scrolling text.
- **Chief's card.** `.sh-chief .sh-top b` reads `Chief has N things for you`; on a computer, `.st-asks .st-label` reads the same and `.st-asks .st-cc` counts N.
- **Crew words.** `[...document.querySelectorAll('.st-today .st-card:not(.st-ask) .st-pill')].map((e) => e.textContent)` contains no `Needs you`.
- **Installed app.** The same at `--app=<url>`.
- **Faces move (Little nudge, A097).** Against the busy lab, `node scripts/verify/face-motion.mjs <app-url-with-#person=key> <out> day|night` runs its own headless Chromium at 390: the working helper's face (`data-motion="work"`) changes its pixels over 3 s, and under Reduce Motion every face reads `still` and its pixels hold for 1.5 s. It writes the frames, `face-work-<theme>.webm` and `face-motion-<theme>.json`, and exits 1 otherwise.

## Gotchas

- `?demo` intercepts every API call: it proves layout, never live counts.
- The stub filters its own result text out of things, so a seeded helper counts as done (and Kept) only once it has delivered a file. `home-states.sh` has Will write a `crew_document`.
- A resting account holds Chief's next turn too, so seed what Chief does before a helper hits the limit.

## Pinned by

`test/office.test.ts`: `Home keeps the battery budget`, `at 1, 5, 12 and 30 crew … Home's Today rows and Chief's asks are clear and whole, Chief's card opens his thread, and counts agree`, and `live crew cards keep one status, Chief carries the ask` (a helper gone quiet is Chief's "1 thing", and the page still renders).
