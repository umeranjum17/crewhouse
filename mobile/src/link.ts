// The phone's end of the link: @byokit/link's device side, its grant in secure storage, and the transport that
// web/src/api.ts calls through. Each call is one request, `METHOD /path`, answered like HTTP (src/link.ts).
import { DeviceLink, LinkError, hostId, pairWithCode, pairWithOffer, offerText, decodeOffer, secureDeviceStore, unb64url, type DeviceGrant, type LinkStatus } from '@byokit/link';
import { findHost } from '@byokit/relay/device';
import { readTyped } from './typed.ts';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { browse, type BrowseService } from '@byokit/reach';
import * as K from '../../web/src/kept.ts';
import { knock } from '../../web/src/adapter.ts';
import { addresses } from '../modules/crewhouse-net';

export type Grant = DeviceGrant;
export type Status = LinkStatus;
const STORE = 'crewhouse.grant';
const url64 = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Unpaired or removed on the computer: the chats this phone kept go with the grant.
const grants = secureDeviceStore(SecureStore, STORE);
const store = { save: grants.save, clear: () => { kept.clear(); void SecureStore.deleteItemAsync('crewhouse.said'); return grants.clear(); } };

/** Recent chats kept in the app's own files (web/src/kept.ts), readable while the home computer can't be reached. */
const keptFile = () => new File(Paths.document, 'kept.json');
let mine = K.empty('');
const write = () => { try { keptFile().write(JSON.stringify(mine)); } catch {} };
export const kept = {
  load(host: string) { try { const f = keptFile(); mine = K.fresh(f.exists ? JSON.parse(f.textSync()) : null, host); } catch { mine = K.empty(host); } return mine; },
  state(s: unknown) { mine = K.keepState(mine, s); write(); },
  chat(id: string, page: unknown) { mine = K.keepChat(mine, id, page); write(); },
  page: (id: string) => mine.chats[id] ?? null,
  clear() { mine = K.empty(mine.host); try { const f = keptFile(); if (f.exists) f.delete(); } catch {} },
};

export async function loadGrant(): Promise<Grant | null> {
  const grant = await grants.load();
  if (grant) return grant;
  const s = await SecureStore.getItemAsync(STORE);
  if (!s) return null;
  const g = JSON.parse(s);
  if (g.v === 1) return g;
  // Migration debt (G07): link lacks migrateGrant(raw, {format:'crewhouse-v0'}). Keep the old keys and shape migration unchanged.
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

/** Typed instead of scanned: one box takes any code. A direct code is the long envelope; a relay code names its
 *  relay inside itself (readTyped), so the address is never typed by the person. */
export async function pairTypedCode(text: string, onWords: (w: string) => void): Promise<Grant> {
  const t = readTyped(text);
  if (t.kind === 'direct') return pair(offerText(decodeOffer(t.text)), onWords);
  if (t.kind === 'unknown') throw new Error('That code is missing where to look it up. Copy the whole code from your computer, then try again.');
  const name = (Device.deviceName || Device.modelName || 'Phone').slice(0, 40);
  const g = await pairWithCode(await findHost(t.base, t.short), t.code, { name, onWords });
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

const liveListeners = new Set<(e: any) => void>();
export const onLive = (fn: (e: any) => void) => { liveListeners.add(fn); return () => { liveListeners.delete(fn); }; };

type Holder = { onEvent: (e: any) => void; onStatus: (s: Status) => void };
type Open = ReturnType<typeof open> & { holders: Set<Holder>; status?: Status };
let shared: Open | null = null;

/** This phone's one link to its computer, shared by whoever holds it: the app's screens, the bubble while it is on, and
 *  its panel. The first hold dials; each holder hears every event and status; the last `release` hangs up. */
export function connect(grant: Grant, onEvent: (e: any) => void, onStatus: (s: Status) => void) {
  if (shared?.link.grant.secretKey !== grant.secretKey) {
    shared?.link.stop();
    const o = { holders: new Set<Holder>() } as Open;
    shared = Object.assign(o, open(grant, (e) => o.holders.forEach((h) => h.onEvent(e)), (st) => {
      o.status = st;
      if (st === 'removed' && shared === o) shared = null; // the computer let this phone go: a new pairing dials afresh
      o.holders.forEach((h) => h.onStatus(st));
    }));
  }
  const o = shared!, me: Holder = { onEvent, onStatus };
  o.holders.add(me);
  if (o.status) { const st = o.status; queueMicrotask(() => o.holders.has(me) && onStatus(st)); } // joined a live link
  const release = () => { o.holders.delete(me); if (o.holders.size) return; o.link.stop(); if (shared === o) shared = null; };
  return { link: o.link, call: o.call, learn: o.learn, facts: o.facts, push: o.push, release };
}

function open(grant: Grant, onEvent: (e: any) => void, onStatus: (s: Status) => void) {
  // The computer says where else it can be reached (Tailscale came up, its home address moved): remember each one.
  const heard = (e: any) => { if (e?.kind === 'link.urls') (e.data?.urls ?? []).forEach((u: string) => link.addUrl(u)); else { liveListeners.forEach((fn) => fn(e)); onEvent(e); } };
  // Out of touch: look for this phone's own computer on the Wi-Fi (the router may have given it a new address).
  let looking: (() => void) | undefined;
  const status = (st: Status) => {
    if (st === 'offline' && !looking) looking = look(grant, (u) => link.addUrl(u));
    if (st !== 'offline') { looking?.(); looking = undefined; }
    onStatus(st);
  };
  const link: DeviceLink = new DeviceLink(grant, { store, onEvent: heard, onStatus: status });
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
  // A phone paired at home learns every address, so it keeps reaching the computer when it leaves the house. It says
  // which route it came by and its own Tailscale address; what the computer says back (its own Tailscale, whether it has
  // this phone as a Tailscale peer, when this phone last reached it each way) is kept for when it can't be reached.
  const learn = async () => {
    const [via, mine] = [route(link.grant.urls[0]), await addresses()];
    await call('GET', '/api/reach', { via, ip: mine.find(tailnet) }).then((r: { urls: string[] } & Said) => {
      r.urls.forEach((u) => link.addUrl(u));
      said = { anywhere: r.anywhere, peer: r.peer, reached: r.reached };
      void SecureStore.setItemAsync(SAID, JSON.stringify(said));
    }).catch(() => {});
  };
  /** Where to push this phone "Crewhouse has news": its Expo push token once the person allows notifications (asked once
   *  per launch), `{off}` if they said no, `{missing}` when this app build has no Android push credential yet (README,
   *  "Phone notifications"), so the computer's Settings says so instead of pushes going nowhere. A network hiccup says
   *  nothing and tries again on the next reconnect. */
  const push = async () => {
    await Notifications.setNotificationChannelAsync('default', { name: 'Crewhouse', importance: Notifications.AndroidImportance.DEFAULT });
    const { status } = asked ? await Notifications.getPermissionsAsync() : await Notifications.requestPermissionsAsync();
    asked = true;
    if (status !== 'granted') return call('POST', '/api/push', { off: true });
    const token = await Notifications.getExpoPushTokenAsync().then((t) => t.data, (e: Error & { code?: string }) =>
      (e.code === 'ERR_NOTIFICATIONS_NO_EXPERIENCE_ID' || /firebase|fcm|google-services/i.test(e.message) ? '' : undefined));
    if (token !== undefined) await call('POST', '/api/push', token ? { expo: token } : { missing: true });
  };
  /** Out of touch: what this phone can see for itself, and a bounded knock on the computer's address, for `away()` in
   *  web/src/adapter.ts to say what was observed and what to try. */
  // Migration debt (G06): reach lacks nativeAddresses(), routeOf(url), observe({urls,priorEvidence}) and probe(url,{timeout}).
  const facts = async () => {
    const mine = await addresses();
    // ponytail: "the same Wi-Fi" is the same /24 as the computer's home address; most home routers hand out a /24.
    const net = (ip: string) => ip.split('.').slice(0, 3).join('.');
    const home = link.grant.urls.find((u) => route(u) === 'home' && mine.some((m) => !tailnet(m) && net(m) === net(new URL(u).hostname)));
    const away = link.grant.urls.find((u) => route(u) === 'tailscale');
    const vpn = mine.some(tailnet);
    const target = home ?? (vpn ? away : undefined);
    return { ...said, home: !!home, tailnet: !!away, vpn, knock: target ? await knock(target) : undefined };
  };
  return { link, call, learn, facts, push: () => push().catch(() => {}) };
}

let asked = false;

type Said = { anywhere?: string; peer?: boolean; reached?: { tailscale?: number } };
const SAID = 'crewhouse.said';
let said: Said = {};
void SecureStore.getItemAsync(SAID).then((s) => { if (s) said = { ...JSON.parse(s), ...said }; }).catch(() => {});
/** Which route an address is: the family's relay, Tailscale, or the home network. */
const route = (u = '') => (/\/link\/v1\//.test(u) ? 'relay' : tailnet(u.replace(/^\w+:\/\//, '')) ? 'tailscale' : 'home');

const tailnet = (ip: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

/** Browse the Wi-Fi for Crewhouse computers over mDNS; only this phone's own (by the id in its announcement) is dialled,
 *  and its handshake still checks the key. Returns stop. */
function look(grant: Grant, found: (url: string) => void) {
  const id = hostId(unb64url(grant.host));
  const z = browse({ type: 'crewhouse', protocol: 'tcp', domain: 'local.' });
  const resolved = (s: BrowseService) => { if (s.txt.id === id && s.txt.url?.startsWith('ws://')) found(s.txt.url); };
  z.on('found', resolved);
  z.on('updated', resolved);
  z.on('error', () => {}); // no Wi-Fi, or mDNS blocked: the other addresses keep trying
  return () => z.stop();
}
