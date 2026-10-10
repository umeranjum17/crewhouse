# thread-hygiene: the newest thing first, in the order it happened

The thread reads in the order things happened, and opens where the person last is:

- A thread opens scrolled to its latest line and stays at the bottom when a new line arrives while the person is at
  the bottom (a line arriving while they read up never yanks them down). A card that grows after it lands (a form
  opening, an image loading) keeps the bottom.
- Messages and cards share one time order: a finished notice ("… finished … · it's in Your things") sits before any
  later message, and a proposal card shows after the reply that raised it and before the person's next message.
- The app says "Your things" everywhere, never "tray".
- A "Hand me a job" row names the helper's plain name, never its raw template id ("Reel · …", not "reel · …").
- `#/chief` and `#/` are one screen: the bare `#/chief` link lands on Home's own URL (`#/`), with Chief's chat open;
  an anchored `#/chief/m<id>` keeps its hash and lands the thread on that message.

## Gate

- `node --test test/office.test.ts` (the "thread keeps time" test): a finished note lands before a later message and
  the notice says "Your things"; a proposal card lands after its reply and before the person's next message; a
  hand-me-a-job row shows the plain template name.
- `node --test test/thread-clear.test.ts`: at 390 on `?demo=longthread`, `#/chief` redirects to `#/` and renders
  `.home-chat`, and the thread is already at its newest line when it appears (`.lines` scrollTop at its max).

## Drive (real crewd)

1. Fresh isolated crewd per SKILL.md on the stub engine. `POST /api/onboard {"address":"Umer"}`.
2. Post a workbook job to a helper so a finished note appears in Chief's thread: recruit the helper
   (`[tool crew_recruit {"template":"scribe","name":"Scribe"}]` to Chief, then to Scribe a message carrying
   `[tool crew_workbook {…}]`), wait for its task to reach `done` with a file.
3. Post a `[tool crew_learn {…}]` (or `crew_suggest`) so a proposal card is raised, then post a later plain message
   to Chief.
4. Load `#/` (or `#/chief`) at 1440 and 390, `?day` and `?night`. Eval the DOM order of `.chat .lines` children:
   the finished notice is before the later message, the card after the reply; the notice says "Your things".
5. Eval `{ st, max }` on `.chat .lines`: `st == max` on open. Open a card's `<details>` after scrolling up and
   confirm `st` does not move; confirm it sticks when at the bottom.
6. Home's Office view: read `.jobs .list-row` text for a job whose helper is not hired — the plain name, no raw id.
7. Load `#/chief` and confirm `location.hash` becomes `#/` with `.home-chat` present; load `#/chief/m<id>` and
   confirm the hash stays and `#m<id>` is near the viewport centre.

## Pass

The thread opens at its latest line and keeps the bottom while pinned; notes and cards sit in time order; the app says
"Your things"; job rows carry plain names; and `#/chief` and `#/` are one screen. Captured in dark and light at 390 and
1440 in the PR's evidence folder.
