# Which Crewhouse runs

Each surface says which Crewhouse it is, in small low-contrast print, read from that side's own version data
(`adapter.versions()`): crewd's `state.version` is its package version, with `-dev` when it is not the downloaded app
(`CREWHOUSE_PACKAGED`, or the download's own `node/bin/node` beside it, as on a cloud computer); the web app's is the package version `scripts/build-web.mjs` bundles; the phone's is
`mobile/app.json`'s (a preview build says `preview`, a Metro dev build adds `-dev`) beside the release it was built
from (the repo's package version, passed in by `mobile/metro.config.js`). Where the two sides agree the web app says
"Crewhouse 0.1.1-dev"; the phone always says "App … · Host …". When they come from different releases the web app says
both too, and Settings adds which side to update.

- CLI: `./crewhouse --version` (also `-v`, `version`), and the first line of the usage a mistyped command prints.
- Web and installed app: the foot of Settings.
- Phone: the foot of Home (the line only) and of This phone settings (with the hint).

## Driving it

Needs a built web app (the journey builds it), Xvfb for the installed app, and for the phone an emulator of the task's
own (memory gate, stopped after) with a release APK built from the head (`cd mobile && npx expo prebuild -p android
--clean --no-install && cd android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64`).

```bash
[SERIAL=emulator-5672 APK=<apk>] bash scripts/verify/versions.sh <out>
```

It saves `cli-version.txt` and `cli-help.txt`, then runs two pairing labs on the stub engine: this checkout (`same`)
and a lab copy of it with the package version one release on and the same built web app (`next`). For each it captures
Settings' foot at 390 and 1280, day and night (`web-<lab>-<theme>-<width>.png`, with the line read in `web-<lab>.json`);
for `same`, the installed app's Settings (`pwa-same-<theme>-<width>.png`); and with `SERIAL` and `APK`, the phone's Home
and This phone settings, day and night at 390 (`phone-home-<lab>-<theme>-390.png`, `phone-settings-<lab>-<theme>-390.png`).
Every page waits for its own words, so exit 0 means each line was read on screen.
