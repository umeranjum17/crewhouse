# Chief on this phone with a MiniMax key

Part of the crewhouse verification map. Source: `docs/verification/phone-only-minimax.md`.

## How to get to it (user POV)

On the phone app's first screen, Use this phone only: Chief on this phone offers OpenRouter and MiniMax. Pick MiniMax, paste the key, Connect, then pick which model Chief uses from the list; Chief's chat names it under his name. Sign out removes the key.

## Driving it

1. Needs an emulator (start it through the memory gate, stop it after) and the release APK built from the commit under proof.
2. Run `SERIAL=<serial> PHONE_APK=<apk> PHONE_OTHER=<dir> done-done run phone-only-minimax`; it types a lab key (no provider call), picks MiniMax M3, signs out and checks the key is gone.
3. Capture: `phone-only-minimax-model-{day,night}-390.png` (the claimed model pick) and the step record in the run folder; `phone-only-minimax-{choice,chat}-{day,night}-390.png` in `PHONE_OTHER`. Exit 0 means every state was seen on screen.
