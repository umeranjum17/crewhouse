# thread-clear: phone threads clear their bars

Every phone thread (Home's chat under "Getting set up", Chief's own page `#/chief`, a helper's page, the room)
scrolls in its own `.lines` column: the head and the composer stay put and nothing in the thread runs under
either. The column fades at its top edge, so a line scrolled half past the bar fades rather than shows sliced.

## Gate

`node --test test/thread-clear.test.ts` — on `?demo=longthread` (signed out, long thread) at 390, for `#/` and
`#/chief`: near and at the bottom no "Sign in with …" button is under the composer, the last one is whole and
`elementFromPoint` lands on it; mid-way no line is painted under the top bar. Fails on the old document-scroll layout.

## Drive (real crewd)

1. Fresh isolated crewd per SKILL.md (any engine; a fresh state is signed out, so Chief's sign-in card lists every
   account, Claude included). `POST /api/onboard {"address":"Umer"}`, then post ~14 messages to Chief so the thread
   scrolls.
2. For `#/` and `#/chief`, at `390x844x2,mobile,touch` and `1440x900x1`, `?night` and `?day`: scroll `.chat .lines`
   to its end, capture; scroll it to 0.4, capture. Scroll the column, not the window (the desk never scrolls
   the document for the thread).
3. Eval per capture: sign-in buttons whose painted part meets `.chat .dock` (want none), lines painted under
   `.chat-head`/`.home-top` (want 0), last button's centre hit is that button (at the bottom), and
   `document.documentElement.scrollHeight == innerHeight` at 390 (the page itself no longer scrolls).
4. One recording: `#/chief` at 390 night, `.lines` scrolled from 0 to its end while `scripts/record.mjs` runs.

## Pass

Every sign-in button fully visible above the composer at the bottom, 0 lines under the top bar, a cut line at the
column's top edge only faded, at both widths and in both themes.
