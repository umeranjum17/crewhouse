# The chat never goes quiet: live line, handoff mirror, toasts and the bubble

From the send to the reply a thread changes at least once a second: "Reading your message" at once, then crewd's own
steps ("Starting on it", "Passed to Scout", each tool step in plain words) with a clock counting up, and "Done · 14 s ·
3 steps" at the end. In the thread where the person asked, a job passed to a helper is mirrored live, with a link to
the helper's chat. The rules and their numbers are the bar (ch-chat-live-1 `bar.md`); `adapter.liveLine` builds it from
`/ws` events only (docs/ui-contract.md).

**Gate (stub engine, no account).** `node --test test/chat-live.test.ts`: real crewd, the built web app, headless
Chromium at 1440 and 390, a held Chief turn and a job passed to Scout; it fails if the visible thread sits still for
over a second (one frame of timer jitter allowed). Mutation times are captured before reading `innerText`, whose
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
