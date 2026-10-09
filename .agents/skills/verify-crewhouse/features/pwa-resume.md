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

## Read it

- `location.hash` after a cold `Page.navigate` to the origin root equals the remembered place.
- The route's own screen is present (`.page.helper` for a thread, `.page` for another screen).
- A deleted thread leaves `location.hash === '#/'` and no `.page.mute` "left the crew" text.

## Evidence

The cold-relaunch shot pair (thread open, then reopened), the deleted-thread fallback, the offline
shell, 320 px, 1.3×, and day/night, on the installed app, in the folder the PR names. The demo
route note: on the published shell the remembered route is a demo place, since the demo is that
origin's default; paired and local modes behave the same and are keyed separately.
