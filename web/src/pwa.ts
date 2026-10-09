// The installed-app layer for the web shell: the service worker, web push through the person's own relay, and the
// home-screen badge. Framework-free, and it owns no provider: crewd holds the relay's key and subscription, and the
// app only carries a subscription back to it (src/link.ts, POST /api/push).
import { api, demo } from './api.ts';

type Badging = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
const canServe = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo'));

/** Register the shell worker for an offline cold start; harmless where the browser has none. */
export function startWorker() {
  if (canServe()) void navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/** Mirror the app's unread count onto the home-screen icon (0 clears it). */
export async function setBadge(n: number) {
  if (demo) return;
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as Badging;
  await (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {});
}

/** Whether this browser can be told about news while the app is closed. */
export const pushPossible = () => canServe() && typeof Notification !== 'undefined' && 'PushManager' in window;

// A worker that never activates (a failed install) must not hang the button: the wait is bounded, and the caller's toast says so.
const worker = () => Promise.race([
  navigator.serviceWorker.ready,
  new Promise<never>((_, no) => setTimeout(() => no(new Error('the app is not ready yet')), 10_000)),
]);

/** Ask for notifications and hand the person's relay a Web Push address, through crewd. `relay` is what the page already
 *  holds, so "no relay" never prompts; the permission request is the first await, so it stays inside the tap (iOS). */
export async function turnOnNotifications(relay: boolean): Promise<'on' | 'off' | 'unsupported' | 'norelay' | 'offline'> {
  if (!pushPossible()) return 'unsupported';
  if (!relay) return 'norelay';
  if ((await Notification.requestPermission()) !== 'granted') return 'off';
  const { vapid, ready } = await api.pushKey();
  if (!ready || !vapid) return 'offline';
  const reg = await worker();
  const old = await reg.pushManager.getSubscription();
  if (old) { await old.unsubscribe(); await api.push({ off: true, web: old.toJSON() }).catch(() => {}); }
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapid) });
  await api.push({ web: sub.toJSON() });
  return 'on';
}

/** Stop notifications on this browser and forget its address at the relay. */
export async function turnOffNotifications() {
  if (!canServe()) return;
  const sub = await (await worker()).pushManager.getSubscription();
  if (!sub) return;
  await sub.unsubscribe();
  await api.push({ off: true, web: sub.toJSON() }).catch(() => {});
}

/** What this browser's own notifications are doing right now, for Settings' one-line switch: `denied` is the
 *  browser itself having blocked them (only its own settings page can undo that). */
export async function pushState(): Promise<'unsupported' | 'denied' | 'on' | 'off'> {
  if (!pushPossible()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return (await (await worker()).pushManager.getSubscription()) ? 'on' : 'off';
}

const keyBytes = (base64: string) => {
  const raw = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
