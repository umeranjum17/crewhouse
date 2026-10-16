// The phone's end of the link: @byokit/pair's device side, its grant in secure storage, and the transport that
// web/src/api.ts calls through. Each call is one request, `METHOD /path`, answered like HTTP (src/link.ts).
import { DeviceLink, LINK_WORDS, LinkError, hostId, pairWithCode, pairWithOffer, secureDeviceStore, migrateGrant, unb64url, type DeviceGrant, type LinkStatus } from '@byokit/pair';
import { findHost } from '@byokit/relay/device';
import { NO_COMPUTER, NO_RELAY, readTyped } from '../../web/src/typed.ts';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { browse, scan, type BrowseService } from '@byokit/discover';
import * as K from '../../web/src/kept.ts';
import { knock } from '../../web/src/adapter.ts';
import { addresses } from '../modules/crewhouse-net';

export type Grant = DeviceGrant;
export type Status = LinkStatus;
/** The link's own failure sentences, for the screens that show one (App.tsx `pairWords`). */
export { LINK_WORDS };
const STORE = 'crewhouse.grant';
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
  const moved = migrateGrant(s, { format: 'crewhouse-v0' });
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

/** Typed instead of scanned: one box takes any code, and the person never types an address. The computer's 12-letter
 *  code is found on this Wi-Fi; a relay code names its relay inside itself (readTyped). */
export async function pairTypedCode(text: string, onWords: (w: string) => void): Promise<Grant> {
  const t = readTyped(text);
  if (t.kind === 'unknown') throw new Error(t.words);
  const o = { name: (Device.deviceName || Device.modelName || 'Phone').slice(0, 40), onWords };
  // Only the relay's own "wrong or has run out" is about the code; any other failed lookup is the relay's, and Expo's
  // fetch fails with its own FetchError there, not the browser's TypeError.
  const g = t.kind === 'code' ? await pairOnWifi(t.code, o) : await pairWithCode(await findHost(t.base, t.short).catch((e) => {
    throw /run out/.test(e?.message) ? e : new Error(NO_RELAY);
  }), t.code, o);
  await store.save(g);
  return g;
}

/** The Crewhouse computers announcing themselves on this Wi-Fi while a code shows (src/link.ts `announce`), each tried
 *  in turn: only the one showing this code finishes the handshake, and an address a firewall drops times out into the
 *  next. A computer that says the code is wrong is not asked again at another of its addresses, since five wrong tries
 *  withdraw its codes. */
async function pairOnWifi(code: string, o: { name: string; onWords: (w: string) => void }): Promise<Grant> {
  const found = await scan({ type: 'crewhouse', protocol: 'tcp', domain: 'local.', ms: 3000 }).catch(() => []);
  let taken = false; // the computer has the code and is asking the person: no other address or computer may answer
  const words = { ...o, onWords: (w: string) => { taken = true; o.onWords(w); } };
  let wrong: LinkError | null = null; // "didn't match" says more than "can't reach"
  for (const s of found) {
    const urls = new Set([s.txt.url, ...s.addresses.filter((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)).map((a) => `ws://${a}:${s.port}/link`)]);
    for (const url of [...urls].filter((u) => u?.startsWith('ws://'))) {
      try { return await pairWithCode(url, code, words); } catch (e) {
        if (taken || !(e instanceof LinkError) || !['unreachable', 'timeout', 'wrong-host', 'wrong-code'].includes(e.code)) throw e; // a dropped address times out
        if (e.code === 'wrong-code') { wrong = e; break; }
      }
    }
  }
  throw wrong ?? new Error(NO_COMPUTER);
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
    const s = await current.stream('desktop', { bot, build: 'p9b' });
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

/** True when this failure is a build with no Android push credential (README, "Phone notifications"): the same
 *  Firebase words the Expo-token fetch fails with on such a build. */
export const noPushCredential = (e: unknown) => {
  const err = e as Error & { code?: string };
  return err?.code === 'ERR_NOTIFICATIONS_NO_EXPERIENCE_ID' || /firebase|fcm|google-services/i.test(String(err?.message ?? ''));
};
/** Whether this build can push at all, without asking the person: the native device token needs no permission,
 *  only the credential. False means asking would be pointless. Anything else that goes wrong (a simulator, a
 *  transient failure) throws, and the caller carries on as today. */
export async function canPush(): Promise<boolean> {
  try {
    await Notifications.getDevicePushTokenAsync();
    return true;
  } catch (e) {
    if (noPushCredential(e)) return false;
    throw e;
  }
};

/** One link frame carries about 1 MB: a bigger body (documents, as base64) rides a stream in pieces instead, its JSON as
 *  one line, answered as one line (src/link.ts `big`). */
const BIG = 256 << 10;
async function big(link: DeviceLink, op: string, body: unknown) {
  const s = await link.stream('request', { op });
  const utf8 = new TextDecoder();
  let out = '';
  const reply = new Promise<{ status: number; body: any }>((resolve, reject) => {
    s.onData = (c) => { out += utf8.decode(c, { stream: true }); };
    s.onEnd = (e) => { try { if (e) throw e === 'too-large' ? new Error('That is too much to send at once. Try fewer files.') : new LinkError('unreachable'); resolve(JSON.parse(out)); } catch (x) { reject(x); } };
  });
  await s.write(JSON.stringify({ ...body as object, build: 'p9b' }) + '\n');
  return reply;
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
  const call = async (method: string, path: string, body?: unknown, o?: { timeoutMs: number }) => {
    let r: { status: number; body: any };
    const bound = o && { timeoutMs: o.timeoutMs, notValidAfter: Date.now() + o.timeoutMs };
    try { r = (await (JSON.stringify(body ?? {}).length > BIG ? big(link, `${method} ${path}`, body) : link.request(`${method} ${path}`, { ...body as object, build: 'p9b' }, bound))) as typeof r; } catch (e) {
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
    // No push credential in this build: say `{missing}` without ever asking the person — the pairing success
    // skips its ask on the same answer (`canPush` above, App.tsx `pushState`).
    if (!(await canPush().catch(() => true))) {
      await call('POST', '/api/push', { missing: true });
      return;
    }
    const { status } = asked ? await Notifications.getPermissionsAsync() : await Notifications.requestPermissionsAsync();
    asked = true;
    if (status !== 'granted') return call('POST', '/api/push', { off: true });
    const token = await Notifications.getExpoPushTokenAsync().then((t) => t.data, (e) => (noPushCredential(e) ? '' : undefined));
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
/** Which route an address is: the person's relay, Tailscale, or the home network. */
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
