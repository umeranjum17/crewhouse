// The phone's end of the link: @byokit/link's device side, its grant in secure storage, and the transport that
// web/src/api.ts calls through. Each call is one request, `METHOD /path`, answered like HTTP (src/link.ts).
import { DeviceLink, LinkError, pairWithOffer, type DeviceGrant, type LinkStatus } from '@byokit/link';
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

export function connect(grant: Grant, onEvent: (e: any) => void, onStatus: (s: Status) => void) {
  const link = new DeviceLink(grant, { store, onEvent, onStatus });
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
  return { link, call };
}
