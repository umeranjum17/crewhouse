# Home (the calm chat list)

Home opens at every launch. On the web it is a chat list (`ChatRows`): Chief first, with "Chief has N things for you"
and N while anything waits (`counts.needs`, a helper gone quiet included), then each helper with its last line or
"<name> is working", then The crew; then the goal row, Hand me a job, and a floating dock (places menu and search).
A computer at `#/` shows three panes: the same list on the left, Chief's thread in the centre, and the details column
only when it has content. The native phone app still shows one card per helper. Crew rows never ask the person and
carry no count. Every word and count reads `A.office` through `useOffice`.

## Sub-features

- `chief-row` (`web/src/main.tsx` `ChatRows`, `.chat-list a.cl-row[href="#/chief"]`): his Geo face, his line or `A.chiefHas`, and `.cl-count` with N while anything waits. It opens `#/chief` (on a computer, the centre pane).
- `helper-rows`: one `.cl-row` per helper in `A.chats` order; `.cl-line.working` exactly when the crew tile says At work. No `.cl-count`, `.cl-dot` or button on a crew row.
- `goal` (`GoalRow`, `a.cl-goal`): "Your goal" and its board count, when a goal exists.
- `first-day`: with no helpers, the list holds Chief and The crew, then the job list.
- `resting`: while an account rests, a notice heads Home: a clock, "Your ChatGPT is resting until …", whether what waits picks up by itself, and "Nothing moves to another AI without you."
- `jobs` (`JobList`): up to four `A.jobs` rows. Tapping a row fills Chief's box; a row that needs an app links to `#/apps`, and a hire row brings that helper on.
- `widths`: 390 and 1280/1440, day and night. Body text is 16px or more (caps labels and counts may be 14px). Nothing is clipped outside a `.clamp1` line, and nothing scrolls sideways.

## How to get to it (user POV)

- Open the app: Home. Tap Chief's row for his thread; ‹ goes back. Your initial at the top opens Settings; + brings a helper on.

## Driving it with the browser

- **States, real crewd.** `scripts/verify/home-states.sh <out> first|busy|resting` boots a stub-engine crewd, onboards Umer and seeds the state. In busy, Rae is at work, Will is done with a document, and Chief asks to bring Ivy on. Resting is the same, except Rae's account rests. The script then captures Home at 390 and 1280, day and night, through `scripts/verify/home-gate.mjs`, which exits 1 on small, clipped or sideways-scrolling text.
- **Chief's row.** `.chat-list a.cl-row[href="#/chief"] .cl-line` reads `Chief has N things for you` and its `.cl-count` reads N, on the phone list and the computer's left pane alike.
- **Crew rows.** `document.querySelectorAll('.chat-list a.cl-row:not([href="#/chief"]) :is(.cl-count, .cl-dot, button)').length` is 0.
- **Installed app.** The same at `--app=<url>`.
- **Faces move (Little nudge, A097).** Against the busy lab, `node scripts/verify/face-motion.mjs <app-url-with-#person=key> <out> day|night` runs its own headless Chromium at 390: the working helper's face (`data-motion="work"`) changes its pixels over 3 s, and under Reduce Motion every face reads `still` and its pixels hold for 1.5 s. It writes the frames, `face-work-<theme>.webm` and `face-motion-<theme>.json`, and exits 1 otherwise.

## Gotchas

- `?demo` intercepts every API call: it proves layout, never live counts.
- The stub filters its own result text out of things, so a seeded helper counts as done only once it has delivered a file. `home-states.sh` has Will write a `crew_document`.
- A resting account holds Chief's next turn too, so seed what Chief does before a helper hits the limit.

## Pinned by

`test/office.test.ts`: `Home keeps the battery budget`, `at 1, 5, 12 and 30 crew … Home's chat list is clear and whole, Chief's row opens his thread …, and counts agree`, and `live crew cards keep one status, Chief carries the ask` (a helper gone quiet is Chief's "1 thing", and the page still renders).
