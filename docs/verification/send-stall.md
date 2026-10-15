# A stalled send says so, a failed one offers Retry, and Retry sends once

When the person sends a message the computer doesn't answer, the box must not sit there as a dead button. After a few
seconds with no answer the composer shows a plain muted line above the held words — "Reconnecting… your words stay
here until the home computer answers." — and the words stay in the box. If the request fails (the connection drops),
the line becomes "Not sent — it's kept here." with a **Retry** button. Retry sends the same words; it is offered only
after the first request has settled, so a held request that later succeeds is never sent twice. When the computer
answers again the line goes and the message shows as normal. The words are the person's own and are never thrown away
(`web/src/draft.ts`). Web only (`web/src/parts.tsx` `Composer`, `HOLD_MS = 4000`; the settled `failed` line and the
global `away` line were already there).

**Gate (stub engine, no account).** `node --test test/send-stall.test.ts`: real crewd, the built web app, headless
Chromium at 1440; the browser's own network is paused on the send POST (CDP `Fetch`) to hold it, then the request is
failed (`Fetch.failRequest`). It asserts the "Reconnecting…" line appears with the words kept, the "Not sent" line and
a Retry appear on failure with the words still kept, and after Retry with the request let through the line goes, the
box clears, and exactly one person message reached the crew (never two from the held request).

**Real-product proof (the copy that counts).** `bash data/evidence/ch-ux-send-stall-words/run.sh` (in the supervising
home): starts the real crewd on the stub engine and the real built web app in Chromium, then per case — 1440 and 390,
day and night — types a message, `kill -STOP`s crewd while the words are in flight (the disk-stall case; the
"Reconnecting…" line appears), `kill -KILL`s crewd so the held request fails (the "Not sent" + Retry line), restarts
crewd on the same port and state dir, and clicks Retry (the words go once and the message shows). It writes
`screens/held-<w>-<theme>.png`, `screens/notsent-<w>-<theme>.png`, `screens/sent-<w>-<theme>.png`, a machine-checkable
`screens/probe-*.json` for each state (line text, whether the line wraps above the words, no overflow, no sideways
scroll, the words kept), `motion/send-stall-cycle-1440-day.webm` (one cycle), and `crewd.log`. It ends by reading the
SQLite `messages` rows and asserting exactly one person message per case.

**Layout.** The line is its own row above the words at every width; the phone chat's one-row composer and the feed
boxes get `flex-wrap: wrap` back while the line is shown (`web/src/styles.css`, the appended `:has(.send-away)` /
`:has(.send-failed)` rule), or the words and the line squeeze side by side at 390.
