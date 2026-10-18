// Crewhouse's service worker: the offline app shell, and the notification handler web push needs on a phone.
// Built to web/dist/sw.js by scripts/build-web.mjs, which injects the precache list and the cache name; it bundles
// no app code, and the served shell is the browser's own copy, never crewd's live data (that is uncached, always fresh).
import { SHARE_CACHE, SHARE_KEEP, sharedKey } from './share-in.ts';

declare const __PRECACHE__: string[];
declare const __CACHE__: string;

type Sw = {
  addEventListener(type: string, cb: (e: any) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(o: any): Promise<any[]>; openWindow(url: string): Promise<any> };
  registration: { showNotification(title: string, o?: any): Promise<void>; setAppBadge?(): Promise<void> };
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
  // Drop yesterday's shell, so a new build never has an old index served to it. A share waiting for its page is kept.
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== __CACHE__ && key !== SHARE_CACHE) await caches.delete(key);
    await sw.clients.claim();
  })());
});

/** The Share sheet's POST: the first photos go into the share cache, and the browser lands on /share with the words on
 *  the link, as a GET share does. The page reads the photos and clears them. */
async function takeShare(req: Request): Promise<Response> {
  const form = await req.formData().catch(() => new FormData());
  const photos = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0 && f.type.startsWith('image/'));
  await caches.delete(SHARE_CACHE);
  const cache = await caches.open(SHARE_CACHE);
  for (const [i, f] of photos.slice(0, SHARE_KEEP).entries()) await cache.put(sharedKey(i), new Response(f, { headers: { 'X-Name': encodeURIComponent(f.name) } }));
  const q = new URLSearchParams();
  for (const k of ['title', 'text', 'url']) { const v = form.get(k); if (typeof v === 'string' && v.trim()) q.set(k, v); }
  if (photos.length > SHARE_KEEP) q.set('more', String(photos.length - SHARE_KEEP));
  return Response.redirect(new URL(`/share?${q}`, sw.location.origin).href, 303);
}

sw.addEventListener('fetch', (e) => {
  const req = e.request as Request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === sw.location.origin && url.pathname === '/share') { e.respondWith(takeShare(req)); return; }
  if (req.method !== 'GET') return;
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
  // The relay's push is content-free: only "Crewhouse has news". The words wait on the person's computer. The icon gets a
  // plain dot (no count, which this worker cannot know); the open app replaces it with the real count.
  e.waitUntil(Promise.all([
    sw.registration.showNotification('Crewhouse has news', { body: 'Open Crewhouse to see what your crew did.', icon: '/icon-192.png', badge: '/notify-96.png', tag: 'crewhouse' }),
    sw.registration.setAppBadge?.(),
  ]));
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
