# The phone's AI accounts row

Home on the phone app has a "Your AI accounts" row under the crew. It reads the computer's own account list (`GET /api/accounts`, the list Settings › AI accounts shows; a paired phone may read it, every other `/api/accounts` call from it is refused) and names what is signed in there with that account's mark: "MiniMax is signed in on the home computer." With nothing signed in, or a computer too old to tell the phone, it keeps the ChatGPT mark and "You sign in on the home computer, in Settings." This phone's Settings › Your AI accounts card leads with the same accounts.

## Driving it

Needs an emulator of the task's own (memory gate, stopped after), a release APK built from the head after `npx expo prebuild -p android` (an android folder from an older prebuild lacks the `automatic` interface style, and the app then stays in day colours at night), and a built web app (`npm run build:web`, the pairing lab serves it).

```bash
SERIAL=emulator-5612 ACCOUNTS_OTHER=<dir> bash scripts/verify/phone-accounts.sh <out> <apk>
```

The pairing lab ([pwa-pair.md](pwa-pair.md), stub engine) starts with every account but Grok signed in; the journey signs all but MiniMax out through Settings' own call (`POST /api/accounts/1/<key>/logout`), pairs the emulator by the typed relay code (`phone-pair-typed.mjs`), and captures Home's row at 390 wide, day and night: `accounts-minimax-{day,night}-390.png` in `<out>` with the step record. It then signs MiniMax out too, reopens the app and captures `accounts-none-{day,night}-390.png` and the lab's `crewd.log` in `ACCOUNTS_OTHER`. Exit 0 means both rows were read on screen.
