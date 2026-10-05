# PR 281 on-device leg: phone captures

The eight web proofs of https://github.com/umeranjum17/crewhouse/pull/281 stay as they are.
This folder holds the **on-device** leg the PR was held for: the same three surfaces, captured
on a real Android phone-width screen, light and dark, from the real app paired to a real crewd.

Media is not committed (the project never commits media). The captures live beside this file, in
`evidence/`, taken on the run described below.

## What was paired, and what was not

**Paired, for real.** A task-owned AVD (`fm-ch-pm-8`, emulator-5556, 1080x2400) ran the app
built from this repo with PR 281's `mobile/App.tsx` change applied on top of `main`. The app
paired to an isolated lab `crewd` over the home network:

- lab crewd on the stub engine (`CREWHOUSE_ENGINE=stub`), throwaway HOME/XDG/state/crew dirs,
  person **Umer**, Chief + Reel + Scout recruited through Chief;
- `POST /api/phones/pair` minted the pairing code, the phone typed it in (the app's own
  "Type a code" box), and `POST /api/phones/approve` said yes at the computer with the phone's
  two words — the real Noise pairing, not a bypass;
- `CREWHOUSE_LINK_PORT=7799` because the default 7712 was already held by another lane's crewd
  on this host (that collision is why the earlier pairing attempt never bound);
- every screen below is real app state fetched over that link: Reel's live task, its trail, the
  crew room message.

**Not proven here.** The model is the scripted stub (`src/stub-runtime.ts`), so the words in the
thread are `stub reel: ...`, not a real model. No sign-in, no push credential, no motion
recording (this is a layout/label leg, not an interaction change). The APK is the self-contained
`assembleRelease` variant rather than `assembleDebug`: a debug build carries no JS bundle and
needs a Metro dev server, which would have made this a Metro capture, not an app capture.

## Captures (1080x2400, phone width)

| file | surface |
|---|---|
| `phone-reel-header-light.png` / `-dark.png` | Reel's chat header: role on one whole line, no task echo |
| `phone-what-happened-collapsed-light.png` / `-dark.png` | Details: seven trail steps + the **What happened** toggle |
| `phone-what-happened-trail-light.png` / `phone-what-happened-trail-expanded-light.png` | the same trail expanded (the toggle reading "Just now") |
| `phone-what-happened-trail-dark.png` | the expanded trail in dark |
| `phone-room-chips-light.png` / `-dark.png` | the crew room: the two helper faces over the box, one message, composer clear |

Dark is the guest's own night mode (`adb shell cmd uimode night yes`); the app follows
`useColorScheme`.

No defect was found on any of the three surfaces, so this PR carries no code change.
