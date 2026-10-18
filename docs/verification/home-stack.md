# Home, the crew view (Stack)

Home is the crew view at every launch, web and phone alike: the greeting, then Chief's card
(his latest line, "Chief has N things for you" when anything waits on the person, his box),
then every helper as a card in its own colour, Add a helper, The crew room and the job list.
There is no Chat | Office switch. Chief's card is the one way to his asks and his thread;
crew cards never ask the person. Every word and count reads `A.office` through `useOffice`.

## Sub-features

- `chief-card` — Chief's card (`web/src/main.tsx` `Home` `.sh-chief`, `mobile/App.tsx` `Home`): his Geo face, `A.chiefHas` when `counts.needs` > 0 (no status word beside it), else `Chief` and his `A.chiefStatus` word; his latest line (`A.chats()[0].line`); his box. A tap opens `#/chief` (native: the Chief view) with his hero (back to Home, gear) and the pinned Needs you.
- `crew-cards` — one card per helper in `A.roster` order, background `art.colourOf(kind)`, ink `#0B0B0B`: face, name, the one status pill (`glowOf` → `A.statusOf`), the current line and one meta line. A waiting card is its job over `Waiting for Chief`; no card says `Needs you` or carries a button. Web opens the helper's thread; the phone opens its desk sheet.
- `crew-tiles` — `#/crew` (web `Crew`, native `Crew`): Chief and every helper as tiles in their colour, each with its status pill (Chief's is his real `A.chiefStatus` word, never a role like "Captain"), face, name and role; Add a helper last.
- `faces` — Geo faces (`web/src/art.ts` `critter`): flat shapes on a black disc, one trait each, the same by day and night; the phone draws `scripts/icons.mjs`'s PNGs of the same art.
- `widths` — one column of cards at 390, two at 1440; tiles fill `minmax(160px, 1fr)`. Body text 16px or more (pills and small-caps labels 14px), nothing clipped, nothing under the status bar.

## How to get to it (user POV)

- Open the app: Home. Tap Chief's card for his thread; ‹ goes back. The gear opens Settings; `Your crew` there (or the desk rail's label) opens the tiles.

## Driving it with the browser

Preconditions: a crew with mixed states. Drive onboard + recruit + a held helper job + a draft on Chief's card through the real crewd (stub engine) for live counts; `?demo=crew1|crew5|crew12|crew30|calm|office` runs fixed crews with no crewd for layout.

- **Counts.** `eval` `.st-label span + span` (`N waiting · N at work · N done · N free`); it must equal the cards' `.st-pill` words' groups plus Chief (waiting while he has something for you).
- **Chief's card.** `.sh-chief .sh-top b` reads `Chief has N things for you` with N equal to `#/chief`'s `.needs-pin .count`; click `.sh-chief a[href="#/chief"]` and wait for `.home-chat .lines`.
- **Crew words.** `[...document.querySelectorAll('.st-crew .st-card .st-pill')].map((e) => e.textContent)` — no `Needs you`; a waiting card's `.st-sub` lines are its job, then `Waiting for Chief`.
- **Tiles.** `#/crew`: `.st-tile[href="#/chief"] .st-pill` equals the rail's `.side-status`; every other tile's pill equals its `.side-row .side-seat` word.
- **Widths and themes.** 1440x900 and 390x844, `?day` and `?night`; the installed app (`--app=<url>`) the same.
- **Native.** On an owned emulator paired by relay code (`phone-pairing.md`), Home shows the same cards; capture day and night (`adb -s <serial> shell cmd uimode night yes|no`).

## Gotchas

- `?demo` intercepts every API call: it proves layout, never live counts.
- The phone's crew card opens the desk sheet, not the thread: the thread is one more tap (`Open <name>'s chat`).

## Pinned by

`test/office.test.ts`: `Home keeps the battery budget`, `at 1, 5, 12 and 30 crew … Home's crew cards are clear and whole, Chief's card opens his thread, and counts agree`, `your crew reads whole`, `your crew page reads the rail status`, and `live crew cards keep one status, Chief carries the ask`.
