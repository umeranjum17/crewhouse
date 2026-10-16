# Chief's profile

Chief's one page (`ChiefProfile` in `web/src/main.tsx`, route `#/h/chief/details`), opened by tapping Chief's
hero (helmet or name) or the desk's "Chief's profile" link. Approved mocks: `chief-profile` (profile-b) and
`screen-control` (computer) in `scripts/verify/mocks.tsv`. Contract: [ui-contract.md](../ui-contract.md),
"Chief's profile".

## What it proves

- Routines: the first two of `A.routines`, each with its switch; "See all N" past two; "+ Add routine" opens the
  same `RoutineAsk` as the Routines screen.
- Computer: a live, watch-only look at the crew member on a computer ("Penny is using it" while it works), and the
  whole **Take control** button on the first 390×844 screen. Take control holds the computer and lands on that
  helper's Screen: "You have control", the screen outlined, "Penny is paused until you hand it back.", a note and a
  big **Hand it back**; Hand it back returns the controls (`bot.controls` back to `bot`).
- "Take control" / "Hand it back" everywhere: helper Details' Screen card, the stuck-helper line, the phone.
- Notifications: "Tell me when Chief finishes or needs me" (`GET`/`PUT /api/notify`); off, no content-free news
  reaches any phone or browser.
- Instructions (`#/h/chief/instructions`): read-only, Chief's soul and the plain-words limits of his job, no tool
  names; changes only through a card the person approves.
- On crew rows (Chats, the desk rail, the phone's chat list) a dot means working; only Chief's row shows unread or
  an ask ([crew-list.md](crew-list.md)).

## How to drive it

A lab crewd on the stub engine ([runbook.md](runbook.md)), the person named Umer, a helper with a computer (the
`scout` template) given a job holding on "ask permission", and a routine or two via `POST /api/routines`. Point
the helper's browser at a page so its screen has something on it.

At 390×844×3 (`chrome-devtools-axi emulate --viewport "390x844x3,mobile,touch"`), `?day` then `?night` with a fresh
query each time so the bundle reloads:

1. `#/chief`, click `.ch-name a`; wait for `.peek-live.on`; check `.cp-take`'s bottom is under `innerHeight` and
   `scrollWidth` equals `innerWidth`; screenshot.
2. `#/h/<helper>/details`; scroll the Screen card's "Take control" into view; screenshot.
3. Back on the profile, click `.cp-take`; wait for `#/h/<helper>/screen` with `.hand-back` and "You have control";
   screenshot; click Hand it back and read `/api/state` until that bot's `controls` is `bot`.

Pair each shot with its mock (mock left, app right) with `magick … +append`. Run the look check:
`node scripts/verify/look-check.mjs web --out <dir> --person <key> --text 1.3 chief-profile=$B/#/h/chief/details …`.
The live screen's 1px "Remote keyboard" field is desklink's own (opacity 0.01) and may report a 4×4 overlap.

Installed app: [pwa-shell.md](pwa-shell.md)'s real install, then the profile at 1440 (`win`, `wshot`) and at a
390 viewport (`out`), with `matchMedia('(display-mode: standalone)').matches` true.

Notifications: `test/link.test.ts` ("phones, push and quiet hold survive a restart…") switches it off over a paired
phone, has Chief reply, and proves that reply's event was never pushed while the next one was.
