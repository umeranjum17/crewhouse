# Chief's spawned legwork

Chief can start plain web lookups of his own through the engine's native `sessions_spawn`, then wait with
`sessions_yield`. A lookup is a child of Chief's job, not a helper's: it reads the web through Crewhouse's gate and
reports back; nothing else it calls is available.

Automated integration (real Gateway, scripted provider, no account): `node scripts/test.mjs test/openclaw-native-restart.test.ts`
(and `test/openclaw-native.test.ts` for the standing-helper hand-off beside it).

## What the journey proves

1. Chief sends five `sessions_spawn` calls in one job; three are admitted (`run.delegated` on Chief's task), the one with an
   extra `cwd` key and the one for another agent are refused and create nothing. At most 24 lookups run in a job.
2. A lookup's `web_fetch` crosses `Crew.gate` (a `run.tool` "Read example.invalid" row per lookup); its `crew_profile` call is
   unavailable and the person profile stays empty. No helper job is created.
3. Chief's one answer reaches his thread once ("Legwork is in: alpha, beta, gamma."); each admitted lookup ended once, `terminal`.
4. crewd killed under a still-running lookup: the next boot marks Chief's job `unsure` ("Crewhouse restarted during a hand-off"),
   never replays it, admits nothing a second time, and a fresh job admits its lookups normally.

## Limits

- The engine answers a spawn's reports in a turn of its own without Chief's persona; Chief carries tone and format in the
  `sessions_yield` message. Binding that turn to Chief belongs to the BYOKit kit.
- After a kill, the kit still lists the interrupted lookup in `delegatedRuns()`; it never reaches the model or the gate again.
