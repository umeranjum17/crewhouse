# Settings › Chief's computer

Chief's settings page for the one cloud computer the crew shares (`ChiefComputer` in `web/src/main.tsx` and in
`mobile/App.tsx`): Update computer, Reset computer (red) with its sheet "Reset Chief's computer?", the sandbox
caption, Daily snapshots (switch), Disk space, Runs on boat.dev, and More (Undo update, Delete my cloud computer).
The words are `A.computer` in `web/src/adapter.ts`, one source for both. Approved mock: `computer` in
`scripts/verify/mocks.tsv` (data/ch-cloud-onboarding-mock, Main2678).

Behind the same build flag as the cloud row ([where-cloud.md](where-cloud.md)): `EXPO_PUBLIC_CREWHOUSE_CLOUD=1` for
the phone, `CREWHOUSE_CLOUD=1` for `scripts/build-web.mjs`. Without it Settings has no row and `#/computer` opens
Home. Every action goes to `A.computerCall`, which stops at the kit until `@byokit/cloud` is published: the
kit-only values (update state, snapshot time, disk) read "Not connected" or are left out. While nothing is
connected, Reset computer and the Daily snapshots switch stay dimmed and disabled with one muted line under the
group (`A.computer(null).connect`: "Connect Chief's computer first."); a tap on either answers with that reason
(the line flashes and is announced) — the Reset sheet never opens and no toast appears. Other rows keep the
not-ready line.

## What it proves

- Web, installed app and phone: Settings' Chief's computer row opens the page; Reset computer and Daily snapshots
  are dimmed and disabled with the reason line under the group; tapping either flashes and announces the reason,
  with no sheet and no toast. No snapshot time, disk state or "Up to date" is invented.
- At the largest text (look check, 360 wide) no word splits: a row's value drops under its label.
- Flag off: Settings is pixel-identical to main's (web) and has no row (phone).

## How to drive it

Web, from the repo root, on a lab crewd ([pwa-pair.md](pwa-pair.md)'s `pair-lab.sh`; `$B` and the key are in `$LAB`):

```bash
CREWHOUSE_CLOUD=1 node scripts/build-web.mjs
S=scripts/verify; LAB=<scratch> $S/pair-lab.sh up . && . $LAB/env
node $S/look-check.mjs web --out <dir> --person $LAB/state/person.key computer=$B/#/computer
node $S/look-check.mjs web --out <dir> --person $LAB/state/person.key \
  --then "await (async()=>{document.querySelector('.computer-off .row-item')?.click(); await new Promise(r=>setTimeout(r,900))})()" computer-tap=$B/#/computer
# computer-tap proves the answer: the reason line reads "Connect Chief's computer first.", no `.computer-ask`
# sheet opened and no `.toast` appeared (assert both absent with an eval).
node $S/computer-plan.mjs $LAB <dir> > plan.json && xvfb-run -a node $S/pwa-shell.mjs plan.json  # installed app
```

Phone: a release APK built with the flag on a task-owned emulator, paired to the same lab by the typed relay code:

```bash
(cd mobile/android && EXPO_PUBLIC_CREWHOUSE_CLOUD=1 NODE_ENV=production ./gradlew assembleRelease)
LAB=<scratch> node $S/phone-pair-typed.mjs --serial $SERIAL --apk mobile/android/app/build/outputs/apk/release/app-x86_64-release.apk
SERIAL=$SERIAL node $S/look-check.mjs android --out <dir> --then "Settings>>Chief's computer" computer
# Then tap the dimmed Reset and prove the same answer (reason shown, no sheet, no toast) with phone-ui.mjs shot + texts.
```

Flag off: build without the flag (a flag-off APK needs `./gradlew :app:createBundleReleaseJsAndAssets --rerun`
first; Gradle keeps the flag-on bundle otherwise) and compare Settings to a `git archive main` build with
`screens.sh` and `magick compare -metric AE` (0 is unchanged).

## Evidence

Each look check beside its mock (day and night, largest text), the installed app's page at 390 and 1440
day and night, the phone at 390 dp day and night, one recording of tapping the dimmed Reset → the reason answer
with no sheet and no toast, and the flag-off Settings.
