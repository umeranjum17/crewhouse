# Home-screen app shell

What the installed app gets from `web/index.html`, `web/manifest.webmanifest` and the styles: the status bar
and browser bar in the look's own colour, the page clear of the notch and the status bar, an iOS launch
screen per device size, a rich install sheet, and one quiet install row in Settings.

## What it proves

- `meta[name=theme-color]` is `#F3EEE3` in day and `#0C0C0B` at night, and follows a look change
  (`useLook` in `web/src/main.tsx`); at night the iOS status bar style is `black-translucent`.
- With safe-area insets (iPhone 393×852, top 59, bottom 34) `body` pads 59px on top, the header starts
  at 59 and a page-coloured band covers the status bar; landscape pads left and right by the cutout.
- Settings shows one row: Chromium's own offer ("Use Crewhouse like an app" + Install) or, on an iPhone
  or iPad, the Share steps. Not now hides it for good on that device (`crewhouse.install.hide`); an
  installed window never shows it.
- Install opens Chromium's rich sheet (the manifest's description and screenshot) and lands in a
  standalone window; its desktop entry carries the manifest's three shortcuts.
- The built shell links one `apple-touch-startup-image` per file in `web/splash/` (26).

## How to drive it

Start crewd per [Drive](../SKILL.md#drive), name the person Maya (`PUT /api/people/1 {"name":"Maya"}`),
then write a plan for `scripts/pwa-shell.mjs` (its header lists the step keys). Always give it its own
`profile` and `home`: it masks every XDG dir, because an install writes a desktop entry and icons into
`XDG_DATA_HOME` and an inherited one is the owner's own menu.

- Theme and insets (headless): steps with `"w":393,"h":852,"dpr":3,"mobile":true`,
  `"insets":{"top":59,"topMax":59,"bottom":34,"bottomMax":34,"left":0,"leftMax":0,"right":0,"rightMax":0}`,
  `url` `$B/?night#/`, and `eval`
  `({theme:document.querySelector('meta[name=theme-color]').content,top:getComputedStyle(document.body).paddingTop})`.
- iOS row: an iPhone `ua` with `"platform":"iPhone","touch":true`, and `inject`
  `addEventListener('beforeinstallprompt', function (e) { e.stopImmediatePropagation(); }, true);` (Safari
  never fires it; Chromium does even under an iPhone user agent). `record` + `click: ".install .link"` +
  `recwait` films Not now.
- Real install (headed): `xvfb-run -a -s "-screen 0 1920x1200x24"`, `"headless":false`,
  `"args":["--window-size=1400,950","--force-device-scale-factor=1","about:blank"]`, `"xkey":"scripts/xkey.py"`.
  Steps: boot with `#person=`, open `#/settings`, `click: ".install .btn"`, `key: "Tab"` then `key: "Return"`
  (Cancel has focus first), `xshot` the whole screen, `attachApp: "$B"`, then theme/width captures with
  `eval` `matchMedia('(display-mode: standalone)').matches` (true) and `.install` absent.
  Chromium 151 here has no `PWA.install` over CDP, so the app's own button and the real sheet do it.

- Android Chrome install (emulator): a task AVD on `system-images;android-36;google_apis;x86_64` (it ships Chrome
  and is debuggable), booted per the fleet emulator flags. `adb -s <serial> reverse tcp:$PORT tcp:$PORT` makes
  `http://localhost:$PORT` a secure origin; write `_ --disable-fre --no-first-run` to
  `/data/local/tmp/chrome-command-line` and `am set-debug-app --persistent com.android.chrome` first. Open
  `http://localhost:$PORT/?day` (crewd's own origin answers the shell without `#person=`), menu, Add to Home screen,
  Install, Add to home screen, then tap the home-screen icon: `dumpsys activity activities` shows Chrome's
  `WebappActivity`. Without Play services it is a Chrome shortcut (the icon wears a Chrome badge), not a WebAPK.
  `adb forward tcp:<n> localabstract:chrome_devtools_remote` reaches the standalone page: `Page.navigate` to
  `/?night` switches the theme and `matchMedia('(display-mode: standalone)').matches` is true. The slow emulator raises
  "System UI isn't responding": tap Wait.

## Evidence

The four captures of Settings (day/night × 390/1440) in the browser and in the installed window, the
install sheet and the installed window (`xshot`), the iOS-size standalone home with the status-bar band,
and the Not now clip. Not proven here: a real iPhone's status bar and launch screen (no iOS device).
