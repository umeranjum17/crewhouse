# A helper chat's header at the largest text

A helper's chat head (`mobile/App.tsx` `HelperPage` and its `Head`) is one row: back, the face, the name over the
role, and Stop/Details at the right. Android's font scale scales every word but not the controls, so at the largest
text the name's column had no room left beside them: the role wrapped to one or two words a line and Details took a
third of the header. The fix is the switch the phone's head already makes (`PhoneHead`): when the window is narrow
for its text (`width / fontScale < 360`) the header wraps, the controls take their own row under the name, and the
name and role keep the full width. At normal text the boxes and the header's height are the same as before.

## Drive

1. Your own emulator (never the test phone: this changes density, font scale and theme), a lab crewd on the stub
   engine, the release APK installed and paired ([phone-pairing.md](phone-pairing.md)); a helper (Reel) recruited.
2. `SERIAL=<serial> node scripts/verify/look-check.mjs android --out <dir> --then
   '^Reel$>>^Open Reel.s chat$' helper-chat` — exit 0 clean, day and night, no hits. The density and font scale
   it sets recreate the activity, so the taps drive that fresh start to the helper's chat. How to reach the screen
   by hand is in [phone-composer.md](phone-composer.md).

## Prove it

- **Boxes, read from the view tree** (`uiautomator dump`, the helper's chat): the name and role `TextView`s and the
  `Button` "Details". Measured on the Pixel 5 AVD (1080px, 440dpi), helper "Reel": at font scale 1.0 the name box is
  557×61, the role 557×100, Details at x 818 and the head 219px tall — the same before and after. At 2.0 the role is
  441×332 (four lines) with the head 487px tall before, and 806×166 (two lines) with the head 507px tall after,
  Details on its own row at x 710.
- `look-check.mjs android` (above) is the mandatory 360-wide largest-text read: `hits: []` in both themes.
- A look at the shot: at 2.0 the role reads on whole lines under the name, nothing is clipped or overlapping, and
  the message list still scrolls above the composer.

## Known

At the largest text the head is 20px taller (507 against 487) on this device — the wrapped row of controls costs
more than the two lines of role it saves. A narrower screen or a longer role adds lines; the boundary is
`width / fontScale`.
