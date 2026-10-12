# Phone-only sign-out, on the real app

Phone-only mode (`mobile/src/phone-only.ts`, the `PhoneOnly`/`PhoneChat` screens in `mobile/App.tsx`)
runs Chief on the phone alone, with the person's own account key kept in the device-only secure store
and a marker (`crewhouse.phone-only.mode`) so a relaunch opens straight into the chat. This feature
proves the way out: the chat header carries a plain **Sign out** beside **Use a computer**; one
confirm removes the saved key, the kept chat and every document Chief made here, and returns to the first chooser, and a relaunch stays on the chooser.

The Android app (`mobile/`) has its own surface and build, so the loopback crewd run proves nothing
about it. Drive the release APK on a task-owned emulator (or a lab phone under its lock):

```bash
cd mobile && npx expo prebuild -p android && (cd android && ./gradlew assembleRelease)
adb -s <serial> install -r mobile/android/app/build/outputs/apk/release/app-release.apk
adb -s <serial> shell am start -n dev.crewhouse.app/.MainActivity
```

Drive by what is on screen (`SERIAL=<serial> node .agents/skills/verify-crewhouse/scripts/phone-ui.mjs
texts | tap '<regex>' | shot <file>`):

1. chooser → **Use this phone only** → sign-in screen;
2. paste the test key (clipboard/`input text` from `/home/umer/.config/openrouter/api_key`, never
   printed, logged or captured) and **Connect** → the chat header reads Chief / DeepSeek;
3. **Sign out** → the native confirm ("Sign out of Chief?" / "Your key will be removed from this
   phone." / Cancel / Sign out) → **Sign out** → the first chooser is back;
4. force-stop and relaunch → still the chooser, not the chat;
5. **Use this phone only** again → the sign-in screen (proves no key remains).

**"Use a computer" keeps the key on purpose.** Tapping **Use a computer** (no confirm) leaves
phone-only mode but keeps the saved key, so returning with **Use this phone only** opens the chat
again directly, never the sign-in screen. Only **Sign out** removes the key, with the kept chat, the hidden archive of a chat moved to the computer, and every document Chief made here (`features/phone-chat-keep.md` owns the keeping, `features/phone-continue.md` the archive); do not route that exit
through the sign-out path, or a plain mode switch would silently delete the person's sign-in.

**The message step can be skipped.** Signing in only saves the key (no provider call); when the
OpenRouter test account is exhausted (requests answer HTTP 402, shown to the person as "Could not
finish on this phone…"), the "send one message" leg of the journey is skipped and said so in the PR.

**Extreme cases.** Narrow width and 1.3× text: set `adb shell wm density <d>` (e.g. 480 → 360 dp,
540 → 320 dp) and `adb shell settings put system font_scale 1.3`. Below 360 dp the two header
controls stack so "Chief" is not squeezed into a per-character column; the confirm dialog's words
wrap and its buttons stay reachable. Reset with `wm density reset` and `font_scale 1.0`.

**Cleanup erases the key.** `adb -s <serial> uninstall dev.crewhouse.app` removes the app and its
secure store (so the key is gone), then `adb -s <serial> emu kill` stops the emulator.
