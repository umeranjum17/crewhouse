# The Office view at every width

Home's Office view is one flat 2D room drawn in the same ink line: five helpers on the
floor in roster order (whoever waits on the person first), a tray box in front, a strip
naming each, and one accent pill only for an actual Needs-you row. Counts on the header,
tray, badge and room all read `A.office` — one state.

## Sub-features

- `switch` — the Chat | Office switch under one bar; Office shows the desk feed, Chat keeps Chief.
- `floor` — five figures in roster order, needs-you first; everyone else counted under `+N`.
- `tray` — the done-page tray travels to the box; its bubble clears every ink, captioned under it.
- `widths` — the room reflows at 1440 (desktop) and 390 (phone); 320 is the narrowest probe.

## How to get to it (user POV)

- Home opens on Chat with Chief; tap Office in the bar. On the phone, the Office list sits below the chats.

## Driving it with the browser

Preconditions: a crew with mixed states. Easiest honest data: drive onboard + recruit +
assign first, so one helper is `working` and one result lands in the tray; `?demo=crew5`
runs a fixed demo crew with no crewd for the pure-layout side.

- **Counts.** `eval` the header count, the tray strip names, and `+N` label; they must agree with `/api/state`'s bots and tasks (`A.office` is computed from it).
- **Labels.** The one Needs-you pill and the tray bubble must sit inside the room, clear of each other and of every figure — `getBoundingClientRect` on both, compare boxes (this is `test/office.test.ts`'s rule).
- **Widths.** `resize 1440 900` then reload; `resize 390 844` then reload (pure CSS, reload after resizing); `resize 320 900` then reload and record actual behavior: wrapped strip, scroll, or overflow — report what you measured, at the longest visible label.
- **Motion.** Calm loops only; with Reduce Motion emulated, none at all (`?demo=calm`).

## Gotchas

- A frame taller than the viewport is cut: scroll the document so the whole room sits inside `innerHeight` before measuring or shooting.
- The room's colors come from `tokens.ts` `room`; the phone's Office list is below the chats — don't measure the chats list as the office.
- `?demo` intercepts every API call, so it can prove layout, never the live counts — for counts drive the real crewd.
