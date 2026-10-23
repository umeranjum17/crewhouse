# Chief's profile

Chief's one page (`ChiefProfile` in `web/src/main.tsx`, route `#/h/chief/details`), opened by tapping Chief's
hero (helmet or name) or the desk's "Chief's profile" link. Approved mocks: `chief-profile` (final Stack J09c),
`chief-instructions` (J09d) and `screen-control` (computer) in `scripts/verify/mocks.tsv`; the desktop target is
`J09c-1280-{day,night}.png` beside them. Contract: [ui-contract.md](../ui-contract.md),
"Chief's profile".

## What it proves

- J09c layout: a round back, then Chief's portrait card in his blue (face 112px, "Chief", "Runs your crew"); on a
  computer a header bar ("Chief's profile") with the portrait left and the rows right, no back.
- Routines: the first two of `A.routines`, each with its switch; "See all N" past two; "Add a routine" opens the
  Routines screen, where Talk to Chief takes the routine in plain words.
- Computer (under Instructions, only while a helper has one): a live, watch-only look at the crew member on a
  computer ("Penny is using it" while it works), and the whole **Take control** button. Take control holds the computer and lands on that
  helper's Screen: "You have control", the screen outlined, "Penny is paused until you hand it back.", a note and a
  big **Hand it back**; Hand it back returns the controls (`bot.controls` back to `bot`).
- A computer that stopped any way (idle stop, crewd restarted or killed) starts again with no "Restore pages?"
  bubble: the start path clears the profile's crash mark (`test/desktop.test.ts`, "give back…" pins it).
- "Take control" / "Hand it back" everywhere: helper Details' Screen card, the stuck-helper line, the phone.
- News: "Tell me when Chief finishes or needs me" (`GET`/`PUT /api/notify`); off, no content-free news
  reaches any phone or browser.
- Instructions (`#/h/chief/instructions`): Chief's personality, which the person changes or puts back there
  ([chief-soul.md](chief-soul.md)), and the read-only plain-words limits of his job, no tool names; those change
  only through a card the person approves.
- Things: Files, Links and Pictures rows with counts ("None yet" when empty) open `#/h/chief/files|links|pictures`,
  one switch between the three; each list newest first with who and when ("You sent it", "Penny"), each with its
  own empty state. Approved mock: `chief-things` (things.html). Driver: `scripts/verify/chief-things.sh`
  (`<port> <state> <out> empty|filled`); seed a link and a photo + PDF in Chief's chat (`POST /api/bots/chief/messages`
  with `photos`/`files`) and a helper delivery (a `crew_workbook` call in the helper's message on the stub engine).
- On crew rows (Chats, the desk rail, the phone's chat list) a dot means working; only Chief's row shows unread or
  an ask ([crew-list.md](crew-list.md)).

## How to drive it

A lab crewd on the stub engine ([runbook.md](runbook.md)), the person named Umer, a helper with a computer (the
`scout` template) given a job holding on "ask permission", and a routine or two via `POST /api/routines`. Point
the helper's browser at a page so its screen has something on it.

At 390×844×3 (`chrome-devtools-axi emulate --viewport "390x844x3,mobile,touch"`), `?day` then `?night` with a fresh
query each time so the bundle reloads:

1. `#/chief`, click `.ch-name a`; the first screen is the portrait, Routines and News (J09c); check `scrollWidth`
   equals `innerWidth`; screenshot; scroll `.cp-take` into view, wait for `.peek-live.on`; screenshot.
2. `#/h/<helper>/details`; scroll the Screen card's "Take control" into view; screenshot.
3. Back on the profile, click `.cp-take`; wait for `#/h/<helper>/screen` with `.hand-back` and "You have control";
   screenshot; click Hand it back and read `/api/state` until that bot's `controls` is `bot`.

Restart: stop crewd's group (TERM) while the helper's computer is live, start it again on the same dirs, and repeat
steps 1 and 3: neither shot shows the bubble.

Pair each shot with its mock (mock left, app right) with `magick … +append`. Run the look check:
`node scripts/verify/look-check.mjs web --out <dir> --person <key> --text 1.3 chief-profile=$B/#/h/chief/details …`.
The live screen's 1px "Remote keyboard" field is desklink's own (opacity 0.01) and may report a 4×4 overlap.

Installed app: [pwa-shell.md](pwa-shell.md)'s real install, then the profile at 1440 (`win`, `wshot`) and at a
390 viewport (`out`), with `matchMedia('(display-mode: standalone)').matches` true.

Notifications: `test/link.test.ts` ("phones, push and quiet hold survive a restart…") switches it off over a paired
phone, has Chief reply, and proves that reply's event was never pushed while the next one was.
