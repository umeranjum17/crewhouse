# Key sign-in sheet (OpenRouter, MiniMax)

`PATH=/usr/bin:$PATH CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/key-sheet.sh <out-dir>` (done-done journey `key-sheet`; no model call, no vendor, no real key). It boots real crewd and the built UI with the kit on its own fake Gateway (`scripts/verify/key-sheet.ts`), so the pasted stub key goes through the kit's real `addKey` and the model list through its real `models` (`byokit.catalog`, ids with a colon included). At 390 and 1280, day and night, for each account: Home's "Sign in with <account>" opens the key sheet, the stub key is pasted, the sheet lists the account's live models (OpenRouter: a search box once the list is long), the person picks the free Flash model and `GET /api/accounts/1/<account>/model` must answer it as `picked` (OpenRouter's `minimax/minimax-m3.1-flash:free`, colon kept). It fails on a missing step or a pick the server did not keep, and on a sheet that never names where a key comes
from: a `Get a <account> key` button whose target is the vendor's own key page (OpenRouter `openrouter.ai/keys`,
MiniMax its console's key page) is required before the paste step.

Shots (`key-sheet-1-key`, `-2-models`, `-3-search` (OpenRouter), `-4-signed-in`; 28 in all) land in `<out-dir>`. Look at each: no sheet content cut, the list scrolls inside the sheet, the stepper reads Get your key / Paste it / Done.

Phone app: `PhoneKeySheet` (mobile/App.tsx) lists every `keyEntry` account from `A.AIS` and, once the key is saved, the same live list to pick from. Not driven here; it is the cloud-computer owner's phone path.

OpenRouter's browser sign-in is no longer offered in the app's sheet (the key route replaces it); the API route (`openrouter-signin.md`) is unchanged. The real-key proof of a model run is `chat-real`/`crew-room` with `CREW_ACCOUNT=openrouter`, which spends and needs approval.
