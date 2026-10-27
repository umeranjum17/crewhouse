# The phone's message box at the largest text

The phone's composer (`mobile/App.tsx` `Composer`) is one row. In a chat thread (calm) it is a round `+`, then one pill with
the words, the mic (Chief's box only) and a round send; elsewhere one bordered row of `+`, the words and send.
Android's font scale scales every word but not the buttons, so at the largest text the placeholder ("Ask Chief
anything") wraps onto two lines and the field squashes. The fix is the switch the phone's head already makes
(`PhoneHead`): when `width / fontScale < 360` the field takes the whole row (`flexBasis: '100%'`) and the buttons
wrap to their own row under it; at normal text nothing changes.

## Drive

1. Your own emulator (never the test phone: this changes density, font scale and theme), a lab crewd on the stub
   engine, the release APK installed and paired (see [phone-pairing.md](phone-pairing.md)); a helper (Reel) recruited.
2. `adb -s <serial> shell wm density 480; adb -s <serial> shell settings put system font_scale 2.0; adb -s <serial>
   shell cmd uimode night no|yes`, then a cold start (`am force-stop` + `monkey`) so the app opens on Home.
3. Chief's chat opens from his row in Home's chat list (`phone-ui.mjs tap '^Chief'`); a helper's chat opens from its
   own row (`tap '^Reel'`).

## Prove it

- **Bounds, read from the view tree.** The field is `class="android.widget.EditText"` in a `uiautomator dump`: its
  `bounds` height is one line's worth at both scales, and its `y` is above the buttons' `y` at the largest text.
  Measured on the Pixel 5 AVD (1080px, 440dpi): Chief's field 244px tall at 2.0 before (two lines, 572px wide),
  153px after (one line, 951px wide); 105px at 1.0 both before and after (unchanged); the helper's field is one
  line in all four.
- **Rows of ink.** `magick <shot> -crop <field width>x400+<field x>+<y> +repage -colorspace Gray -depth 8 gray:-`
  and count the bands of dark rows: two text bands before, one after.
- `SERIAL=<serial> look-check.mjs android --out <dir> chief-chat` — the field and the buttons, day and night, at
  360dp and the largest text. The helper's chat needs the taps above:
  `--then '^Reel' helper-chat`.
- Keep the emulator awake first (`adb shell svc power stayon true`): a sleeping display screenshots black, which
  `look-check` reads as the night look and the run then never settles.

## Known

`look-check` cannot see this defect or its fix: a text box whose placeholder wraps passes every check. Only the
bounds, the ink bands or a look at the shot show it.
