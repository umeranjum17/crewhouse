# Which Crewhouse runs

Part of the crewhouse verification map. Source: `docs/verification/versions.md`.

## How to get to it (user POV)

`./crewhouse --version`; the foot of Settings on the web and in the installed app; on the phone, the foot of Home and of This phone settings. Matching sides read "Crewhouse 0.1.4-dev"; the phone, or sides from different releases, read "App … · Host …", and Settings says which one to update.

## Driving it

1. For the phone: an emulator (memory gate, stopped after) and a release APK built from the head.
2. Run `[SERIAL=<serial> APK=<apk>] bash scripts/verify/versions.sh <out>` (or `done-done run versions`); it runs this checkout and a lab copy one release ahead on the stub engine.
3. Capture: `cli-version.txt`, `cli-version-tag.txt`, `cli-help.txt`, `web-tag-{day,night}-{390,1280}.png` (a `cloud-v<next>` tag build says plain "Crewhouse <next>"), `web-{same,next}-{day,night}-{390,1280}.png`, `pwa-same-{day,night}-{390,1280}.png`, and with the phone `phone-{home,settings}-{same,next}-{day,night}-390.png`. Exit 0 means every line was read on screen.
