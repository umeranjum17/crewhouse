# Chief on this phone with a MiniMax key, on the real app

Phone-only mode (`mobile/src/phone-only.ts`, `PhoneSignIn` in `mobile/App.tsx`) offers MiniMax beside OpenRouter. The
key goes through the kit's own key route (`@byokit/accounts`, route `minimax:key`: MiniMax's plain name is its
subscription sign-in), and the phone holds one key at a time (connecting one removes the other). A MiniMax key then
picks its model from the kit's list (`models`), kept as the kit's own default (`setDefaults`); "Use the default for
now" runs the kit's fast model. OpenRouter keeps its pinned DeepSeek and has no pick. Chief's chat header names the
model; Sign out removes the key and the pick.

```bash
cd mobile && npx expo prebuild -p android --clean --no-install && (cd android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64)
SERIAL=<emulator> PHONE_APK=mobile/android/app/build/outputs/apk/release/app-x86_64-release.apk PHONE_OTHER=<dir> done-done run phone-only-minimax
```

The build and the emulator go through the memory gate; the emulator is the caller's. The journey
(`scripts/verify/phone-only-minimax.sh`) clears the app, taps **Use this phone only**, picks **MiniMax**, types a lab
key, **Connect**, picks **MiniMax M3** on "Which model should Chief use?", sees the chat header read MiniMax M3, then
**Sign out** and checks **Use this phone only** asks for a key again. Saving a key and picking never call MiniMax, so
no model is called and nothing is spent. Shots, 390 wide, day and night: `phone-only-minimax-{choice,model,chat}-*`;
the claimed one (`PHONE_CLAIM`, default `model`) lands in the run folder, the rest in `PHONE_OTHER`.

A real answer on a MiniMax key is `test/phone-key-errors.test.ts`'s route check (a refused key, the request's host and
model) plus, when needed, one live turn of `askPhone` on the host with the key read from its file path (never env).
