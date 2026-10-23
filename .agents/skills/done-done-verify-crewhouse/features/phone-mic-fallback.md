# Speaking with no on-device voice pack

Part of the crewhouse verification map. Source: `docs/verification/voice.md`.

## How to get to it (user POV)

On the Android app's Home, tap the mic in Chief's box on a phone whose on-device speech pack is missing: the phone's
speech service opens the mic (the mic becomes a stop button) instead of the "can't hear yet" toast.

## Driving it

1. Build the x86_64 release APK (`cd mobile/android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64`, through fm-mem-gate) and `npm run build:web`.
2. Run `FM_MEM_GATE=~/firstmate/config/fm-mem-gate.sh bash scripts/verify/phone-mic-fallback.sh <out> [apk]`
   (its own AVD, emulator on port 5586, stub-engine lab, typed-code pairing; everything torn down after).
3. Capture: `mic-listening-no-pack-phone-390.png`, the step record.
4. It proves: the on-device recogniser reports no pack (error 13) and the system service starts the mic. Not proven: spoken words reaching the box (no audio on the emulator).
