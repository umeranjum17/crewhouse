# The phone's AI accounts row

Part of the crewhouse verification map. Source: `docs/verification/phone-accounts.md`.

## How to get to it (user POV)

Open the paired phone app on Home: under the crew, "Your AI accounts" shows the mark of the account signed in on the computer and says "MiniMax is signed in on the home computer."; with nothing signed in there it says "You sign in on the home computer, in Settings."

## Driving it

1. Needs an emulator (start it through the memory gate, stop it after), a release APK built from the head, and `npm run build:web`.
2. Run `SERIAL=<serial> ACCOUNTS_OTHER=<dir> bash scripts/verify/phone-accounts.sh <out> <apk>` (or `done-done run phone-accounts` with `ACCOUNTS_APK`); it runs the pairing lab on the stub engine, signs every account but MiniMax out through the computer's own call, pairs by the typed relay code, and stops the lab.
3. Capture: `accounts-minimax-{day,night}-390.png` and the step record in the run folder; `accounts-none-{day,night}-390.png` and `crewd.log` in `ACCOUNTS_OTHER`. Exit 0 means both rows were read on screen.
