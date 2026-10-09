# The chat never goes quiet: live line, handoff mirror, toasts and the bubble

From the send to the reply a thread changes at least once a second: "Reading your message" at once, then crewd's own
steps ("Starting on it", "Passed to Scout", each tool step in plain words) under one quiet line with the clock counting
up ("Scout · at work · 12 s · Open chat ›"), and "Done · 14 s · 3 steps" at the end (Chief's own reply done in under a
second shows none). The engine can send nothing for tens of seconds while the model writes a big file, so a working
run with no event for 4 s says so on its live line, beside its one clock ("Chief · at work · 27 s · still working"; streamed
words count as events); the next event clears it. No second clock. In the thread where the person asked, a job passed to a helper is mirrored live, with a link to
the helper's chat. The rules and their numbers are the bar (ch-chat-live-1 `bar.md`); `adapter.liveLine` builds it from
`/ws` events only (docs/ui-contract.md).

**The doing mark (a turning ring).** The live line's doing row carries a small ring that turns while work is in
progress (`web/src/styles.css` `@keyframes spin` on `li.doing .tick`, `mobile/src/motion.ts` `Ring`), not the old
half-filled circle that read as clipped; done (✓) and todo (○) are unchanged. Reduce Motion holds the ring still — a
fixed gap in a ring still says "in progress" — and the web `prefers-reduced-motion` rule stops the spin. Prove the web
side by driving a held run to a doing row, then `scripts/screens.sh "$EV" doing-ring "<url>"` for the four
theme/width captures. Prove the phone side on an Android emulator (`features/phone-pairing.md` for the pairing): build
`mobile/` to a release APK, run the stub crewd, hold a Scout job with an approved plan, and capture the to-do line
collapsed and expanded, day and night, plus the done footer. Real-model words need a signed-in account (SKILL.md);
when no route is usable (expired sign-in, quota), say "not proven" with the cause rather than minting one.

**Gate (stub engine, no account).** `node --test test/chat-live.test.ts`: real crewd, the built web app, headless
Chromium at 1440 and 390, a held Chief turn and a job passed to Scout; it fails if the visible thread sits still for
over a second (one frame of timer jitter allowed). In the Chief turn it also waits for "Chief · at work · N s · still
working" (at least 4 s after the task's last event, in sight inside the thread's scrolling box, one clock in the live
line), emits crewd's own `run.tool` event (`db.event`) and expects "still working" gone. Mutation times are captured before reading `innerText`, whose
forced-layout cost must not be charged to the preceding still stretch. It still requires changed visible words:
slowing the live-line timer to two seconds must fail. For loaded-run qualification, repeat the gate ten times under
the same bounded CPU contention before and after; retain logs and the load command. Prove a regression with it by
checking the old `src`/`web` out over the new and running it again.

**Real engine (the proof that counts).** crewd as SKILL.md says, with Claude's test credential linked into the engine
HOME and the run under `fm-cred-lock.sh` and `fm-mem-gate.sh`; set `chief` and the helper to `{"models":["claude"]}`.
Then per message: `node .agents/skills/verify-crewhouse/scripts/chat-probe.mjs $BASE $EV/<run> "<words>" 390 844 '/?night#/'` (and 1440 900, `?day`).
It writes `changes.json` (every change to the thread, timed in the page: `longestStillMs` until the end line is the
number), `screen.jsonl` (rows carry the 160-character `lines` preview plus `linesFull` with
each of the last four thread lines whole — likewise `asideFull`/`heroFull` beside the capped
`aside`/`hero`), `push.jsonl` and one frame a second named by ms since send. Run one plain question and one
"Ask Scout to …" at each width; stitch the frames into a timestamped recording with ffmpeg (`drawtext` with the ms
from each file name, 1 fps). The probe's own loop is too coarse to judge a 1 s gap; `changes.json` is the measure.
For the long silence on the stub, run crewd in-process (as the test does) with a 100 ms loop that, once Chief holds an
"ask permission" turn, calls `db.event('run.tool', 'chief', {task, words})` 30 s after the task's last event, then
releases the turn: shoot at 20 s ("· still working") and 34 s (gone) at 390 day and night, and record from 4 s to 33 s
with `record.mjs` (its 30 s bound). Use a thread long enough to scroll: the live line must stay in sight above the box.

**Toasts.** One shared toast (`parts.tsx` `Toast`): first in the dock, above the box you type in, or a bar along the
screen's foot where a screen has no box. On the stub: onboard, seed a few About-you lines and chat lines, then
`node scripts/toast-place.mjs $BASE $EV/toast <before|after>`: Settings after Add, then Chief's chat while the same
toast is up, day and night at 390. `toast-<tag>.json` lists the words under the toast: empty in the chat; in Settings
only a row already running off the screen's foot.

**The bubble (Android).** Chief's bubble (56 dp, flush to an edge) sits over every app, this one too, so while it is on
the app keeps that strip free on its edge (`useBubbleEdge`, `mobile/src/bubble.ts`). On a task emulator paired as in
phone-pairing.md: `appops set dev.crewhouse.app SYSTEM_ALERT_WINDOW allow`, switch on Chief on your screen
(`crewhouse://settings`), open `crewhouse://needs`, shoot day and night. The bubble's frame is in
`dumpsys window windows` (`u0 dev.crewhouse.app}` overlay window); no app text node in `uiautomator dump` may reach
past its left edge. Drag him to the left (`input swipe` from his centre; switch the emulator to three-button
navigation first, `cmd overlay enable com.android.internal.systemui.navbar.threebutton`, or the swipe is a back
gesture) and record it: the strip follows.
