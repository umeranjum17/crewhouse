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
      try {
        return await fetch(req);
      } catch { return (await caches.match(SHELL)) ?? Response.error(); }
    })());
    return;
  }
  // The shell's own files were precached at install: a cache hit answers, anything else goes to the network.
  e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
});

sw.addEventListener('push', (e) => {
  // The relay's push is content-free: only "Crewhouse has news". The words wait on the person's computer.
  e.waitUntil(sw.registration.showNotification('Crewhouse has news', { body: 'Open Crewhouse to see what your crew did.', icon: '/icon-192.png', badge: '/notify-96.png', tag: 'crewhouse' }));
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
