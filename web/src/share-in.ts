// The installed app's Share target (web/manifest.webmanifest, a POST): the service worker (sw.ts) holds the photos a
// Share sheet sent in this cache until the /share view takes them. The worker and the page both name it from here.
export const SHARE_CACHE = 'crewhouse-share';
export const SHARE_KEEP = 4; // the most photos one share keeps, as the phone's Share sheet does
export const sharedKey = (i: number) => `/share-in/${i}`;
