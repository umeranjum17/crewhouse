# Look check: the defects a person sees, measured

The mandatory UI-change step in [SKILL.md](../SKILL.md#mandatory-look-check-360-wide-largest-text-light-and-dark).
`scripts/look-check.mjs` captures each changed screen at 360 wide with the largest text, light and dark, runs
machine checks on it and puts it next to its approved mock. It found the two defects the captain caught by eye:
the phone's squashed Chief helmet and the black strip down the left of a phone shot.

## Running it

**Web/PWA.** Against the run's own crewd (`--person "$LAB/state/person.key"` opens the person's link first) or
the static demo shell (`scripts/serve-web.mjs web/dist`, then `?demo=<variant>`). Each `<slug>=<url>` runs in
`?day` and `?night`; the theme rides before the route's hash. A screen behind an in-memory switch takes
`--then '<js expression>'`, run in the page after it loads (Office: `document.querySelector('[data-mode=office]')?.click()`).
The script starts its own headless Chromium with a throwaway profile and removes it on exit.

**Android.** Your own emulator (SKILL.md's rules: your serial on every `adb` call), the app installed and on the
screen. The script sets `wm density` for 360 dp, `font_scale` to the system's largest (2.0 from SDK 34, else
1.3; `--text` overrides) and `cmd uimode night`, then puts all three back. A theme change may recreate the
activity and drop the app back to its first screen. `--then 'Settings>>Your crew'` lists, in order, what to tap
by text or label to reach the screen (`phone-ui.mjs tap`). The taps run again in the second theme only when the
screen's words differ from what the first theme reached. A frame counts once the app's words are on screen, its
view tree reads the same twice and the shot is in the requested look, within 90 s. An app that misses the theme
change is flipped away and back once after 20 s. Exit 2 means it never settled; it never saves a half-drawn frame.

**Someone's shot** (a phone photo, a bug report): `shot <slug>=<file>` runs the strip check and the mock pairing.
The theme comes from the file name (`day|light`, `night|dark`), or from the page colour nearest the shot's middle.

**Bundled phone fonts.** `fonts --out <dir>` (no emulator, no screenshot) guards the Android bold-weight
mechanism: every weight the phone asks for (`...fw()` in `mobile/`) must resolve to a static family in
`mobile/src/font.ts` that `useFonts` loads from a bundled file, and no bare `fontWeight` may remain outside that
map — Android draws a bare weight on a custom family as regular. Exit 0 clean, 1 a hit, 2 could not run.
A raster weight check is deliberately not attempted: uiautomator carries no size or weight per node, and at the
largest text the titles and the body differ in size per style, so a stroke ratio needs a per-node em that the
pixels cannot recover (tried on ch-android-bold-weight: band merges, baseline contamination, core fragmentation
across themes).

Outputs in `--out`: `<slug>-<theme>.png` (and `.xml` on Android), `<slug>-<theme>-vs-mock.png`,
`hits/<slug>-<theme>-<n>-<kind>.png` and `look-check.json` (every hit's element, words, box and detail).

## Proven on main (2026-10-13, 319c6f92)

- Release APK v1.0.0-preview.20261012.18, paired to a stub crewd. Chief's header fails in day and night:
  `stretched: a 302-dot picture — stretched wide 60%: cells 5.6×5.6px, the art's own cell is 0.625:1`. The phone's
  `Dots` draw art.helmetDots on square cells, while the art's cell is 10:16. The same hit shows on Office,
  Your crew and Routines; Settings and Your things pass.
- The captain's phone shot: `strip: left edge — a 132px band of rgb(22,24,21)`. On the emulator,
  letterboxing (`wm set-ignore-orientation-request true` with the device turned) draws black bands beside the
  portrait-locked app. The day look fails on them (`left 169px`, `right 85px` of rgb(0,0,0); a band is measured up to the first thing drawn on it, here the status-bar clock). The night look cannot
  see them, since black sits within 10 of night's bg #0C0C0B.
- Web, 21 screens × 2 looks clean: the real crewd's chief-chat, crew, things, routines, settings, apps, skills and
  crew/add, plus the demo's Home, crew5, calm, nophone, connect, things, settings, crew, apps, routines and the
  Office at office/crew12/crew30. Of 20 more demo variants, only `?demo=plan` fails, and that is a real defect:
  its card's second button, "I've changed my plan", runs off the right edge at 1.3× text.

## Tuning, with the evidence for each rule

- An SVG `<img>` with a viewBox fits itself inside its box (`meet`), so it cannot stretch. `Face` draws a 1.25:1
  helmet in a 2:1 box, and it rendered round. Only `preserveAspectRatio="none"` counts.
- A designed ellipsis or line clamp passes at half shown or more. The demo's Office rows cut long sentences on
  purpose. A hard cut, or a cut leaving less than half, fails.
- Only what is on screen counts. A chat bubble scrolled above the fold is not clipped.
- Overlap compares a box's own ink (text line boxes, pictures, field text) with what covers it. Covering
  padding is layout (the mic inside the composer's padding, the helmet over its name pill). A sticky dock
  over a page that still scrolls is content passing under it.
- Phone dot pictures: a helmet is at least 12 dots wide. The 9×9 icons (art.TABS, Settings' rows) are square on
  purpose.
- Strips compare against the look's own page colours, never the shot's middle. The captain's (21,23,21) sits
  inside night's surface #131312, so only the look the screen is in counts.
- Text scaling reads every size before writing any, because computed styles are live and em sizes would
  compound.
- The off-screen width is the layout viewport. A phone zooms out to fit a too-wide page, so `innerWidth`
  grows with the defect.

## Limits (say them in the report)

- On Android, uiautomator still reports a node's full text, so the tree alone cannot see a drawn cut.
The pixel check (`nativeCut`) covers it instead: a last line ending in the native "…" dots while the node
reports the whole string fails, as does ink sliced through the node's own edge where the node reaches its
container's edge (proved on the pre-#475 phone header: `DeepSeek` drawn `DeepS…`, fail before, pass after).
- Overlap compares siblings only, and on Android only nodes with words. A box over a cousin's words passes.
- A solid black band always fails, in every look: (near-)pure black is never the app's page, even though
night's sunken sits near it. The app's own night page colours (bg, sunken) at a padded edge still pass.
- Background images check the first layer only.
- A sticky bar is excused only while the page itself scrolls. A bar over an inner scroller still fails;
  confirm by eye that the content can scroll out.
