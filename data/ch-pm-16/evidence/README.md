# ch-pm-16 evidence — a reminder actually reminds

Real `crewd` on the stub engine (`.agents/skills/verify-crewhouse`), loopback only, throwaway HOME.
Media is never committed; the files below are produced by the run that the PR names.

## The loop, driven as a person drives it

1. In Chief's thread: "Remind me in 2 minutes to water the plants" → Chief's `crew_routine`
   with `once`, on the card: `A reminder` / `At 11:16 am` / `water the plants` / `Remind me` ·
   `Change time` · `Not now`. Nothing is set until the person presses **Remind me** (pressed in the
   browser, not by curl).
2. crewd is killed and started again (the app closed and reopened) before the moment arrives.
3. At the moment, one line lands in Chief's thread: `Reminder: water the plants.`
4. `curl -X DELETE /api/routines/5` on a reminder set for 4 minutes later — the app's own path —
   and past that moment nothing arrives.

Fastest schedule the engine supports: **one minute**, `"in 1 minute"` (`reminderAt` in
`src/routines.ts`). Repeating routines floor at 15 minutes; a reminder is a moment, not a repeat.

Every reminder fired exactly once, and only these three lines exist in the thread:

```
Reminder: pack the sports kit.
Reminder: take the bins out.
Reminder: water the plants.
```

## Files

- `screens/reminder-arrived-{night,day}-{1440,390}.png` — the reminder in Chief's chat.
- `screens/routines-{night,day}-{1440,390}.png` — it afterwards, in Routines:
  `One time · reminded 11:07 am`, `Already reminded`, `Remove` — still cancellable.
- `motion/reminder-arrives-after-restart.webm` — the plants reminder arriving across a crewd
  restart, 19 frames over 102 s, phone width.
- `chat-lines.json` — the three reminder lines the run produced, and nothing else.

## Not proven here

- Real model words and a real sign-in: this run is the stub engine, so Chief's own sentences
  around the card are stubbed. The reminder line itself is crewd's, not the model's.
- The native Expo app: this skill drives the shipped web app on loopback; a phone capture needs
  an emulator build (out of scope for this lane).
- Browser notification on the reminder: notification-channel work is explicitly out of scope for
  ch-pm-16; the line in the thread is the whole delivery.