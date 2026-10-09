# PWA resume: reopening where the person was

The installed app's `start_url` is `/` with hash routes, so a cold relaunch from the home screen
would always land on Home and lose the thread or screen the person was on. `web/src/resume.ts`
remembers the current route on the device and reopens it on a home-screen launch.

## What it proves

- Opening a thread (or another screen) and cold-launching the installed app again lands back on it.
- The memory is keyed by mode — `demo`, `paired`, or the local shell — so one mode's place never
  leaks into another. Nothing leaves the device; crewd is unchanged.
- A normal link or a manifest shortcut that names a place (`/#/things`, `/#/routines`, `/#/chief`)
  wins over the remembered one.
- A remembered thread that has since been deleted opens Home, with no error.
- The offline shell still opens on a cold relaunch (the service worker serves the cached shell).
- It holds at 320 px and at 1.3× text, in day and at night.

## How to drive it

`test/resume.test.ts` is the fast gate: browser-driven, serving the built public shell from a
`*.localhost` origin (the published shell's situation, so it boots the demo with no crewd). It
opens Scout's thread, cold-loads `/`, and asserts `location.hash` returns to `#/h/scout`; then a
named link wins; then a stored gone thread opens Home. Run it alone:

```bash
npm run build:web && node --test --test-concurrency=1 test/resume.test.ts
```

For the installed app, follow the Android Chrome install in [pwa-shell.md](pwa-shell.md): serve the
built shell on a `*.localhost` origin, `adb reverse tcp:$PORT tcp:$PORT`, install from Chrome, then
attach to the standalone page (`adb forward tcp:<n> localabstract:chrome_devtools_remote`). Open a
thread, force-stop Chrome, and tap the home-screen icon again; the standalone page returns on the
same `#/h/…`. The browser helper for the installed window is `scripts/` under this skill's own
`pwa-shell.mjs` (headed Chromium install) when no emulator slot is free. The extreme cases ride the
same page: `Emulation.setDeviceMetricsOverride` for 320 px, the system font scale for 1.3×,
`Network.emulateNetworkConditions {offline:true}` for the offline shell, and `?day`/`?night`.

## Read it

- `location.hash` after a cold `Page.navigate` to the origin root equals the remembered place.
- The route's own screen is present (`.page.helper` for a thread, `.page` for another screen).
- A deleted thread leaves `location.hash === '#/'` and no `.page.mute` "left the crew" text.

## Evidence

The cold-relaunch shot pair (thread open, then reopened), the deleted-thread fallback, the offline
shell, 320 px, 1.3×, and day/night, on the installed app, in the folder the PR names. The demo
route note: on the published shell the remembered route is a demo place, since the demo is that
origin's default; paired and local modes behave the same and are keyed separately.
