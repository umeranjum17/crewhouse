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

For the installed app, `scripts/resume-plan.mjs` builds a plan for `scripts/pwa-shell.mjs` (a real,
headed Chromium install in standalone `display-mode`) and drives every case. Serve the built shell on a
`*.localhost` origin, then run the plan:

```bash
npm run build:web
PORT=$(node -e 'require("node:net").createServer().listen(0,"127.0.0.1",function(){console.log(this.address().port);this.close()})')
node .agents/skills/verify-crewhouse/scripts/serve-web.mjs web/dist "$PORT" &
LAB=$(mktemp -d) EV=$PWD/out
node .agents/skills/verify-crewhouse/scripts/resume-plan.mjs "http://crewhouse.localhost:$PORT" "$EV" "$LAB" > "$LAB/plan.json"
xvfb-run -a -s "-screen 0 1920x1200x24" node .agents/skills/verify-crewhouse/scripts/pwa-shell.mjs "$LAB/plan.json"
```

On a real Android Chrome install, the plan's one CDP page also drives the standalone window reached
through `adb reverse tcp:$PORT tcp:$PORT` and `adb forward tcp:<n> localabstract:chrome_devtools_remote`.
This emulator crashes (SwiftShader/Vulkan) when the installed webapp is launched, so the isolated
Chromium standalone window is the installed-PWA proof here; see the PR's evidence note.

### On the iPad simulator (real Safari home-screen app)

The mobile gap is closed on the Mac iOS Simulator (`fm-iPad (A16)`, iOS 26.3): a real Safari
Add to Home Screen of the crewd origin, killed and relaunched from its icon, reopens the thread it
was on. The iOS Simulator shares the Mac's network stack, so a server on the Mac's `127.0.0.1` is
reachable as `http://localhost:<port>/`; when crewd runs on another host, forward it from that host
with `ssh -R 127.0.0.1:<port>:127.0.0.1:<port> <mac>`. `localhost` is a loopback name, so the app
boots the real local shell (not the demo) and crewd's loopback guard accepts the host.

- Install: `xcrun simctl openurl <udid> http://localhost:<port>/`, then Safari ▸ Share ▸ View More
  ▸ Add to Home Screen ▸ Add. The share sheet is a separate process, so `axe describe-ui` bound to
  Safari does not list its items — tap them by point (`axe tap -x… -y…`).
- Relaunch: `xcrun simctl terminate <udid> com.apple.webapp` kills the installed app; tap its icon
  to relaunch. Capture with `xcrun simctl io <udid> screenshot`, record with
  `xcrun simctl io <udid> recordVideo`.
- Theme: the app follows its own look (Settings ▸ LOOK ▸ Day / Night), not the iOS colour scheme,
  so set it in the app for the day/night pair. `xcrun simctl ui <udid> appearance` does nothing here.
- The gone thread: the product has no delete-thread action, so the case is the same "remembered
  place no longer resolves" the browser gate pins by storing `#/h/vanished`. Reach it on the device
  by the helper leaving the crew — restart crewd with a fresh, still-onboarded crew so the
  remembered `#/h/<helper>` names no member; the next home-screen launch lands Home, no error.

## Read it

- `location.hash` after a cold `Page.navigate` to the origin root equals the remembered place.
- The route's own screen is present (`.page.helper` for a thread, `.page` for another screen).
- A deleted thread leaves `location.hash === '#/'` and no `.page.mute` "left the crew" text.

## Evidence

The cold-relaunch shot pair (thread open, then reopened), the deleted-thread fallback, the offline
shell, 320 px, 1.3×, and day/night, on the installed app, in the folder the PR names. The demo
route note: on the published shell the remembered route is a demo place, since the demo is that
origin's default; paired and local modes behave the same and are keyed separately. On the iPad
simulator the set is the Add to Home Screen sheet, the installed launch, and for day and night the
thread open, the relaunch on the same thread, and the gone thread's Home fallback, plus one relaunch
recording (thread → home screen → thread).
