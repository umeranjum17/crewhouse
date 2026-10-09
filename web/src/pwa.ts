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
export function setBadge(n: number) {
  if (demo) return;
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as Badging;
  void (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {});
}

/** Whether this browser can be told about news while the app is closed. */
export const pushPossible = () => canServe() && typeof Notification !== 'undefined' && 'PushManager' in window;

/** Ask for notifications and hand the person's relay a Web Push address, through crewd. */
export async function turnOnNotifications(): Promise<'on' | 'off' | 'unsupported' | 'norelay'> {
  if (!pushPossible()) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.ready;
  const { vapid, ready } = await api.pushKey();
  if (!vapid || !ready) return 'norelay';
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapid) });
  await api.push({ web: sub.toJSON() });
  return 'on';
}

/** Stop notifications on this browser and forget its address at the relay. */
export async function turnOffNotifications() {
  if (!canServe()) return;
  try { await (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.unsubscribe(); } catch { /* already gone */ }
  await api.push({ off: true });
}

const keyBytes = (base64: string) => {
  const raw = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
