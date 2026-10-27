# Chief on a real boat.dev computer, set up from the phone

Part of the crewhouse verification map. Source: `docs/verification/where-cloud.md` (Real model).

## How to get to it (user POV)

On the phone app's first screen, In my cloud: paste the boat.dev key, pick the computer, Use this computer, Talk to Chief. Chief asks for a sign-in; Settings › Your AI accounts › Paste your MiniMax key signs the computer in, and Chief answers the waiting question by himself. Asked to look at his own screen, he uses his computer and says what is on it.

## Driving it

1. Spends money: one disposable boat.dev computer under the standing caps (warn 10 USD, stop 15, two computers at most, deleted after). Needs the fleet boat.dev key and a MiniMax key by path, never printed.
2. Candidate artifacts, not the release: the cloud tarball built like `release-cloud-linux.yml` (`set-version-from-tag.mjs cloud-v<next>`, `npm ci`, `npm run build:web`, `node scripts/package.mjs`) and the phone release APK built with only `EXPO_PUBLIC_CREWHOUSE_CLOUD_DOWNLOAD=file:///tmp/crewhouse-candidate.tar.gz`. A task-owned emulator on its own adb server port.
3. Start `BOAT_KEY_FILE=… AI_KEY_FILE=… CANDIDATE=<tarball> node scripts/verify/boat-run.mjs <adb port> <serial> <out>`; `/make`, `/upload`, then drive the phone (the key goes to the clipboard through the pairing-code field; `/deliver` and `/ai` type three letters at a time). `/thread` reads Chief's thread and the engine's model calls off the computer; `/cleanup` deletes it and `/list` shows it gone.
4. Capture: the phone at each step (key card, computer list, setup steps, ready, Chief's reply, the computer-use reply), the driver log with its timings, the `/thread` transcript and `/cost`. A reply counts only when `/thread` shows the model call with `status=200` and the words on the phone match crew.db.
