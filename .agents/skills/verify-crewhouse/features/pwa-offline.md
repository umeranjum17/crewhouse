# The installed web app: offline shell, web push, and the badge

The web shell ships a service worker (`web/src/sw.ts`, built to `web/dist/sw.js` by
`scripts/build-web.mjs`). It caches the whole shell at install, so a cold OFFLINE reload
serves the app instead of the browser's error page; it carries the `push` handler web push
needs on iOS 16.4+ Home-Screen apps and Android; and the app mirrors its Needs-you count
onto the home-screen icon through the Badging API (`web/src/pwa.ts`).

## Sub-features

- `shell` — first online load registers `/sw.js`; a cold offline reload is answered from the cache.
- `push` — a real push event reaches the worker and shows a content-free notification ("Crewhouse has news"); tapping it focuses or opens the app.
- `badge` — a content-free push sets a plain dot; the open app replaces it with `navigator.setAppBadge(needs)` while work waits, and `clearAppBadge()` when none does.

## How to get to it (user POV)

Open the app once online (the worker installs), then put the browser/device offline and
reload: the app's own "The home computer isn't answering" screen shows, never a browser
error page. Notifications: Settings → Phones → "Notifications on this device: turn on".

## Driving it with the browser

Preconditions: crewd on the stub engine (SKILL.md launch). The worker needs a secure
context; loopback (`http://127.0.0.1:$PORT`) qualifies.

- **Register.** `eval "() => navigator.serviceWorker.getRegistration().then(r => !!r && !!navigator.serviceWorker.controller)"` is true after a second load.
- **Offline cold reload.** `chrome-devtools-axi emulate --network Offline`, then `page.open` the app: it returns 200 and the page renders (the app's offline screen), not `ERR_INTERNET_DISCONNECTED`; capture at 390 and 1440, day and night.
- **Push.** `chrome-devtools-axi` has no push command; deliver one over CDP the way DevTools' Push button does: `ServiceWorker.deliverPushMessage {origin, registrationId, data: '{"title":"Crewhouse has news"}'}` (grant `notifications` first), then `getNotifications()` shows the notification.
- **Badge.** Spy `navigator.setAppBadge`/`clearAppBadge`, create one pending ask (a helper writing a file outside its home), let the app refresh: it calls `setAppBadge(1)`; answer the ask and it calls `clearAppBadge()`.

## Gotchas

- The worker precaches only what the build lists; a new asset type must be in `web/dist` before `sw.js` is written (scripts/build-web.mjs walks the tree).
- Live data is never cached: `/api/`, `/files/` and `/ws` are skipped; a navigation is network-first with the cached shell as the offline floor.
- Web push needs a secure origin and, on iOS, a Home-Screen install and a user gesture for permission. This lane proves the worker side only; the reachable origin is the separate PWA-origin lane.
- `/sw.js` is served revalidated (`no-cache`) so an update ships on the next load; the cache name is content-derived, so a new build drops the old shell.
