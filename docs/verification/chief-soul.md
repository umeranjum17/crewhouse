# Chief's personality

Chief's soul (`templates/chief/soul.md`, the person's copy in `crew/bots/chief/soul.md`) is the engine's own
`SOUL.md`: `OpenClawRuntime.run` writes it into the lane's workspace before a turn, so a saved change reaches
Chief's next reply. The person reads, changes and puts it back in Settings › **Chief's personality**
(`id="chief-soul"`) and on his Instructions page (`#/h/chief/instructions`), with `PUT /api/bots/chief/soul` and
`POST /api/bots/chief/soul/reset`. Contract: [ui-contract.md](../ui-contract.md), "Chief's profile".

## What it proves

- The default reads in the first-mate voice: "Captain" in every message, outcome and evidence first, a pick with a
  recommendation, bad news plainly.
- **Change** opens the soul as text; an edit ("Captain" -> "Skipper") saved there is crewd's soul at once
  (`GET /api/bots/chief`), and the Instructions page shows the same words.
- **Put back how Chief started** (after the app's own confirm) brings the template back.
- The job's limits ("What Chief never does") stay read-only; no bot changes its own soul (`crew_suggest` refuses
  Chief's).
- The next turn gets the saved soul as `SOUL.md`: `test/openclaw-soul.test.ts` (real Gateway, scripted model).

## How to drive it

`done-done run chief-soul` (`scripts/verify/chief-soul.sh <evidence-dir>`): a stub crewd lab, Umer onboarded, and per
look (day, night) and width (390, 1440): `settings-chief-soul-*`, `settings-chief-soul-edit-*` (the edit typed in),
`settings-chief-soul-saved-*`, `chief-instructions-*`; `transcript.txt` records each crewd check. Chief's live voice
needs a real model route: send three messages and read the replies for the address, outcome first and a pick with
a recommendation, then change the address in Settings and check the next reply uses it.
