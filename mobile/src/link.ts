// The phone's end of the link: @byokit/link's device side, its grant in secure storage, and the transport that
// web/src/api.ts calls through. Each call is one request, `METHOD /path`, answered like HTTP (src/link.ts).
import { DeviceLink, LinkError, pairWithCode, pairWithOffer, type DeviceGrant, type LinkStatus } from '@byokit/link';
import { findHost } from '@byokit/relay/device';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';

export type Grant = DeviceGrant;
export type Status = LinkStatus;
const STORE = 'crewhouse.grant';
const url64 = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const store = { save: (g: Grant) => SecureStore.setItemAsync(STORE, JSON.stringify(g)), clear: () => SecureStore.deleteItemAsync(STORE) };

export async function loadGrant(): Promise<Grant | null> {
  const s = await SecureStore.getItemAsync(STORE);
  if (!s) return null;
  const g = JSON.parse(s);
  if (g.v === 1) return g;
  // Paired before @byokit/link: the same keys, stored in the old shape. The computer kept this phone's grant too.
  const moved: Grant = { v: 1, secretKey: url64(g.sk), host: url64(g.crewdPk), hostName: 'your computer', urls: g.urls, device: g.device };
  await store.save(moved);
  return moved;
}
export const forgetGrant = store.clear;

/** Scan result in, grant out, once the person at the computer says yes. `onWords`: the two words to show meanwhile. */
export async function pair(scanned: string, onWords: (w: string) => void): Promise<Grant> {
  const name = (Device.deviceName || Device.modelName || 'Phone').slice(0, 40);
  const g = await pairWithOffer(scanned, { name, onWords });
  await store.save(g);
  return g;
}

/** Typed instead of scanned, through the family's relay: its address, the relay's short code, then the pairing code. */
export async function pairTyped(relay: string, short: string, code: string, onWords: (w: string) => void): Promise<Grant> {
  const name = (Device.deviceName || Device.modelName || 'Phone').slice(0, 40);
  const base = /^[a-z]+:\/\//i.test(relay.trim()) ? relay.trim() : `https://${relay.trim()}`;
  const g = await pairWithCode(await findHost(base, short.toUpperCase()), code.toUpperCase(), { name, onWords });
  await store.save(g);
  return g;
}

/** The live link, for a bot's screen: its signaling rides a stream on it (src/link.ts `desktop`). */
let current: DeviceLink | null = null;

/** desklink's Signaling for one bot's screen, over the encrypted link: the computer's /ws/desktop messages, one JSON per line. */
export function desktopSignaling(bot: string) {
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const handlers = new Set<(e: any) => void>();
  let next = 1;
  let buf = '';
  const opened = (async () => {
    if (!current) throw new Error("Can't reach the home computer");
    const s = await current.stream('desktop', { bot });
    s.onData = (chunk) => {
      buf += new TextDecoder().decode(chunk);
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
        const msg = JSON.parse(buf.slice(0, i));
        if (msg.event) { handlers.forEach((h) => h(msg.event)); continue; }
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p?.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
        else p?.resolve(msg.result);
      }
    };
    s.onEnd = () => { for (const p of pending.values()) p.reject(new Error('Lost touch with the home computer')); pending.clear(); };
    return s;
  })();
  return {
    async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
      const s = await opened;
      const id = next++;
      return new Promise<T>((resolve, reject) => { pending.set(id, { resolve, reject }); s.write(JSON.stringify({ id, method, params }) + '\n').catch(reject); });
    },
    subscribe(handler: (e: any) => void) { handlers.add(handler); return () => { handlers.delete(handler); }; },
    close() { void opened.then((s) => s.end(), () => {}); },
  };
}

export function connect(grant: Grant, onEvent: (e: any) => void, onStatus: (s: Status) => void) {
  // The computer says where else it can be reached (Tailscale came up, its home address moved): remember each one.
  const heard = (e: any) => { if (e?.kind === 'link.urls') (e.data?.urls ?? []).forEach((u: string) => link.addUrl(u)); else onEvent(e); };
  const link: DeviceLink = new DeviceLink(grant, { store, onEvent: heard, onStatus });
  current = link;
  /** The Transport for web/src/api.ts: crewd's answer, or an error with the HTTP status the screens understand. */
  const call = async (method: string, path: string, body?: unknown) => {
    let r: { status: number; body: any };
    try { r = (await link.request(`${method} ${path}`, body)) as typeof r; } catch (e) {
      // No status means "can't reach the home computer"; a view-only phone is told it can't, as crewd would.
      throw Object.assign(new Error((e as Error).message), e instanceof LinkError && e.code === 'view-only' ? { status: 403 } : {});
    }
    if (r.status !== 200) throw Object.assign(new Error(r.body?.error ?? `error ${r.status}`), { status: r.status });
    return r.body;
  };
  // A phone paired at home learns the relay's address, so it keeps reaching the computer when it leaves the house.
  const learn = () => call('GET', '/api/reach').then((r: { urls: string[] }) => r.urls.forEach((u) => link.addUrl(u))).catch(() => {});
  return { link, call, learn };
}
