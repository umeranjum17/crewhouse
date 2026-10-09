// Crewhouse's service worker: the offline app shell, and the notification handler web push needs on a phone.
// Built to web/dist/sw.js by scripts/build-web.mjs, which injects the precache list and the cache name; it bundles
// no app code, and the served shell is the browser's own copy, never crewd's live data (that is uncached, always fresh).
declare const __PRECACHE__: string[];
declare const __CACHE__: string;

type Sw = {
  addEventListener(type: string, cb: (e: any) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(o: any): Promise<any[]>; openWindow(url: string): Promise<any> };
  registration: { showNotification(title: string, o?: any): Promise<void> };
  location: { origin: string };
  navigator: { setAppBadge?: (n?: number) => Promise<void> };
};
const sw = self as unknown as Sw;

const SHELL = '/'; // every navigation, deep link and all, is answered by the cached index
const LIVE = /^\/(?:api|files|ws)(?:\/|$)/; // the person's live data and sockets: never cached

sw.addEventListener('install', (e) => {
  // One whole shell, offline-ready, before this worker can take over the tab.
  e.waitUntil((async () => { await (await caches.open(__CACHE__)).addAll(__PRECACHE__); await sw.skipWaiting(); })());
});

sw.addEventListener('activate', (e) => {
  // Drop yesterday's shell, so a new build never has an old index served to it.
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== __CACHE__) await caches.delete(key);
    await sw.clients.claim();
  })());
});

sw.addEventListener('fetch', (e) => {
  const req = e.request as Request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin || LIVE.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    // A reachable computer always wins, so an update shows on the next visit; the cached shell is the offline floor.
    e.respondWith((async () => {
      try { const fresh = await fetch(req); void (await caches.open(__CACHE__)).put(SHELL, fresh.clone()); return fresh; }
      catch { return (await caches.match(SHELL)) ?? Response.error(); }
    })());
    return;
  }
  // Shell assets are content-hashed or the icons and fonts beside them: cache-first, filled in as the app loads.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const fresh = await fetch(req);
    if (fresh.ok && fresh.type === 'basic') void (await caches.open(__CACHE__)).put(req, fresh.clone());
    return fresh;
  })());
});

sw.addEventListener('push', (e) => {
  // The relay's push is content-free: only "Crewhouse has news". The words wait on the person's computer.
  let title = 'Crewhouse has news', url = SHELL;
  try { const d = e.data?.json(); if (d?.title) title = d.title; if (d?.url) url = d.url; } catch { /* a bare push still shows the default */ }
  e.waitUntil((async () => {
    await sw.registration.showNotification(title, { body: 'Open Crewhouse to see what your crew did.', icon: '/icon-192.png', badge: '/notify-96.png', tag: 'crewhouse', data: { url } });
    await sw.navigator.setAppBadge?.(); // the icon gets a dot; the app sets the real count when it is open
  })());
});

sw.addEventListener('notificationclick', (e) => {
  e.notification?.close?.();
  e.waitUntil((async () => {
    const all = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const here = all.find((c) => String(c.url).startsWith(sw.location.origin));
    if (here) { await here.focus?.(); await here.navigate?.(SHELL); return; }
    await sw.clients.openWindow(SHELL);
  })());
});
