# The phone's chat with the keyboard up, one reply per message, and the launcher icon

Part of the crewhouse verification map. Source: `docs/verification/phone-pairing.md`.

## How to get to it (user POV)

On the paired Android app, open Chief (the bar's middle tab), add a PDF with ＋ and tap the box: the keyboard comes up,
the Home | Chief | Crew bar steps aside, and the whole box with its send sits right on the keyboard, the file's chip
above it. Say "Hi": one reply, even when the link to the computer drops while he answers. A helper's chat reads like
Chief's: bubbles with its face, its own words only, never Chief's "From Chief: …" hand-off line. The launcher shows
Chief's face (the blue circle in a captain's cap), round and themed too.

## Driving it

1. An emulator through the memory gate and a release APK of the commit (see phone-first-run.md), paired to a
   stub lab with `scripts/verify/phone-pair-typed.mjs`.
2. Keyboard: `node scripts/verify/phone-keyboard.mjs --serial <emulator> --out <dir>` sets 360, 390 and 445 dp
   widths (`wm density`), day and night, attaches a PDF through the system picker, types, and checks from the
   screen's own layout that send, box and chip sit above the keyboard and the bar is gone; it writes a still per
   case and `keyboard.json`, and exits non-zero on any miss.
3. One reply: `test/link.test.ts` ("one message gives one reply…") cuts the link between a message and its answer
   and counts the computer's messages. On the phone, freeze the lab crewd (`kill -STOP <its pid>`) on Chief's first
   streamed words until the app shows Reconnecting, resume it, and check the thread holds the reply once.
4. Icon: `adb shell cmd package resolve-activity` is not enough; go Home (`input keyevent 3`), open the app drawer
   and capture the launcher; for the themed icon, turn on Wallpaper & style › Themed icons on an emulator image
   that has it.

## Pitfalls

- `scripts/icons.mjs` rewrites `mobile/assets/pals` and the bubble glyph too; keep only the icon outputs a change
  means to ship.
- The stub engine does not stream, so a lingering streamed bubble only shows on the real engine
  (`scripts/verify/native-delegation.ts --scripted`).
