# Chief on this phone with a MiniMax key

Part of the crewhouse verification map. Source: `docs/verification/phone-only-minimax.md`.

## How to get to it (user POV)

On the phone app's first screen, Use this phone only: Chief on this phone offers OpenRouter and MiniMax. Pick MiniMax, paste the key, Connect, then tap a model from every model MiniMax's live list gives (one tagged Recommended, first; a search box when long) and confirm it; Chief's chat names it under his name. Sign out removes the key.

## Driving it

1. Needs an emulator (start it through the memory gate, stop it after) and the lab release APK built from the commit under proof with `EXPO_PUBLIC_CREWHOUSE_MINIMAX_API=http://127.0.0.1:7412/anthropic` (the journey serves that fake live list).
2. Run `SERIAL=<serial> PHONE_APK=<apk> PHONE_OTHER=<dir> done-done verify phone-only-minimax --outcome "…"`; it types a lab key, sees all 9 listed models (no model call), selects and confirms MiniMax M3, signs out and checks the key is gone.
3. Capture: `phone-only-minimax-model-{day,night}-390.png` (the full list, the claim) and the step record in the run folder; `phone-only-minimax-{choice,picked,chat}-{day,night}-390.png` in `PHONE_OTHER`. Exit 0 means every state was seen on screen.
