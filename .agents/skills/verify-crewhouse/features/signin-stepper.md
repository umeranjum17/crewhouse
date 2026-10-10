# Sign-in and connect stepper

What the shared `Progress` stepper shows at the top of the SignIn and ConnectApp sheets
(`web/src/flows.tsx`): three steps — `Open <provider>`, `Say yes`, `Done` — marked done,
now, or upcoming.

## What it proves

- The step labels never break mid-word at the narrowest phones: at 320, 360 and 390 CSS px,
  and with the labels at 1.3x text size, every label wraps only between words.
- The page never scrolls sideways at those widths (page overflow is 0).
- At normal text size the 390 and 1440 renders are unchanged by the wrapping rule.

## How to drive it

Start crewd per [Drive](../SKILL.md#drive). The stepper is pure layout, so `?demo` is
enough (the repo's `test/office.test.ts` pins it):

- SignIn sheet: `?demo&sheet=signin&phase=waiting&<theme>#/settings` (`phase=opening|waiting|done`).
- ConnectApp sheet: `?demo=connect&sheet=connect&phase=waiting&<theme>#/h/pip`.
- At 320/360/390 with `Emulation.setDeviceMetricsOverride`, scale the step labels to 1.3x
  (`li.style.fontSize = parseFloat(getComputedStyle(li).fontSize) * 1.3 + 'px'`) and assert
  no word's own Range reports more than one client rect, and
  `documentElement.scrollWidth - clientWidth === 0`.
- The installed PWA: real Chromium install under `xvfb-run` via
  [`pwa-shell.md`](pwa-shell.md) (`scripts/pwa-shell.mjs`), then navigate the standalone
  window to the demo sign-in URL and capture.

## Evidence

Before/after shots of each stepper at 320/360/390, day and night, at 1.3x; the 390/1440
text-1x renders (unchanged); and the installed-PWA standalone shot.
