// The installed web app's end of the link, as the phone's (mobile/src/link.ts): @byokit/pair's device side, its grant
// sealed in this browser's IndexedDB. Paired, the link carries every call, the live events and a bot's screen
// (web/src/api.ts `setLink`); with no grant the public shell runs its demo. Loaded only on the public shell.
import { DeviceLink, LinkError, browserDeviceStore, pairWithCode, pairWithOffer, type DeviceGrant } from '@byokit/pair';
import { findHost } from '@byokit/relay/device';
import { NO_HERE, NO_RELAY, readTyped } from './typed.ts';
import { lineSignaling, setLink, type Json } from './api.ts';
import { setBadge, turnOffNotifications } from './pwa.ts';
import { clearKept } from './kept.ts';

const store = browserDeviceStore('crewhouse.grant');
const BUILD = 'p9b'; // what crewd takes as a current app (src/link.ts `currentPhone`)

/** Boot: a grant kept here means paired, so the link carries everything from the first screen. */
export async function resume() {
  const grant = await store.load().catch(() => null);
  if (grant) start(grant);
}

/** The paste box: the computer's 12-letter code or a relay code (`SHORT-CODE@relay`), split by shape (readTyped). Resolves
 *  once the person at the computer says yes, with the grant saved; `onWords` gets the two words to check meanwhile. */
export async function pair(text: string, onWords: (w: string) => void) {
  const t = readTyped(text.trim());
  const o = { name: deviceName(), onWords };
  if (t.kind === 'unknown') throw new Error(t.words);
  let grant: DeviceGrant;
  // A relay that is off fails the fetch itself ('Failed to fetch'), so the person gets the app's words instead.
  if (t.kind === 'relay') grant = await pairWithCode(await findHost(t.base, t.short).catch((e) => {
    throw e instanceof TypeError ? new Error(NO_RELAY) : e;
  }), t.code, o);
  // The 12-letter code dials this page's own address: the computer's link serves the app (`./crewhouse phones web`), and
  // an https page may dial only wss. Off the computer's network that gets through only with the relay's code; a wrong
  // host fails the handshake, so any other page loses nothing.
  else grant = await pairWithCode(`${location.origin.replace(/^http/, 'ws')}/link`, t.code, o).catch((e) => {
    throw e instanceof LinkError && e.code === 'unreachable' ? new Error(NO_HERE) : e;
  });
  await store.save(grant);
}

/** The computer's QR (src/link.ts `offer()`), or the link it opened this page by: the page's address with the offer after `#`
 *  (`offerHere`), through the kit's own scan path. Its ws:// addresses are the computer's
 *  LAN ones, which an https page cannot dial, so they dial this page's address the way the typed code does (`dialHere`). */
export async function scanned(qr: string, onWords: (w: string) => void) {
  await store.save(await pairWithOffer(qr, { name: deviceName(), onWords, resolve: dialHere }));
}

/** The pairing offer this page was opened with, or ''. */
export const offerHere = () => (location.hash.includes('byokit-link:') ? location.hash.slice(1) : '');

/** Back to the demo: tell the computer (briefly; it may be off), forget the grant, clear the icon's count. */
let unpairing = false; // a deliberate Unpair is not "this device was removed"
export async function unpair(link: DeviceLink) {
  unpairing = true;
  const bounded = (step: Promise<unknown>) => Promise.race([step, new Promise((ok) => setTimeout(ok, 2500))]).catch(() => {});
  await bounded(turnOffNotifications());
  await bounded(link.unpair());
  link.stop();
  await store.clear();
  clearKept();
  await leave();
}

/** The computer forgot this browser: clear the grant before the page reloads. The kit clears it only after its own
 *  callback returns, so a reload that began there could boot the new page on the grant still sealed here. */
const forgotten = async () => { try { await store.clear(); } catch { /* the page leaves either way; a grant left behind is cleared next time */ } try { if (!unpairing) sessionStorage.setItem('crewhouse.removed', '1'); } catch { /* the page still leaves */ } await leave(); };

/** The same installed app opens fresh: the grant (or its absence) decides the mode at boot. A deliberate restart
 *  lands Home, never on the last place (a pairing's own landing is Chief's thread, `arrived`), so it flags itself for `resume()` (web/src/resume.ts). */
export async function leave(arrived = false) {
  await setBadge(0);
  try { sessionStorage.setItem(arrived ? 'crewhouse.arrived' : 'crewhouse.home', '1'); } catch { /* no storage: Home is the default anyway */ }
  location.replace(location.pathname === '/share' ? '/share' + location.search : '/'); // a share that waited for pairing opens again, paired
}

/** On an https page a ws:// address the computer named (its LAN address) dials this page's own origin instead: an https
 *  page cannot open ws://, and the computer's https route serves /link. wss (the relay), and anything on an http page,
 *  is dialled as it is: there a plain-http relay is no address of this page. */
const dialHere = (url: string) => (url.startsWith('ws://') && location.protocol === 'https:' ? `${location.origin.replace(/^http/, 'ws')}/link` : url);

function start(grant: DeviceGrant) {
  const listeners = new Set<(e: Json) => void>();
  const link: DeviceLink = new DeviceLink(grant, {
    store,
    resolve: dialHere,
    // The computer says where else it can be reached: remember each one.
    onEvent: (e: any) => { if (e?.kind === 'link.urls') (e.data?.urls ?? []).forEach((u: string) => link.addUrl(u)); else listeners.forEach((f) => f(e)); },
    onStatus: (s) => { if (s === 'online') listeners.forEach((f) => f({ kind: 'connected' })); if (s === 'removed') void forgotten(); },
  });
  setLink({
    name: grant.hostName,
    host: grant.host,
    // A read, the notifications key ask or turning off gives up after 15 s, so a computer that's off shows as out of reach; any other change waits through reconnects.
    call: async (method, path, body) => {
      let r: { status: number; body: Json };
      try { r = await link.request(`${method} ${path}`, { ...body, build: BUILD }, { timeoutMs: method === 'GET' || body?.key === true || body?.off === true ? 15_000 : undefined }) as typeof r; } catch (e) {
        // No status means "can't reach the home computer"; a device that only watches is told it can't, as crewd would.
        throw Object.assign(new Error((e as Error).message), e instanceof LinkError && e.code === 'view-only' ? { status: 403 } : {});
      }
      if (r.status !== 200) throw Object.assign(new Error(r.body?.error ?? `error ${r.status}`), { status: r.status });
      return r.body;
    },
    subscribe: (f) => { listeners.add(f); return () => { listeners.delete(f); }; },
    // A bot's screen rides its own stream (src/link.ts `desktop`): the computer's /ws/desktop messages, one JSON per line.
    desktop: (bot) => lineSignaling(async (hear, lost) => {
      const s = await link.stream('desktop', { bot, build: BUILD });
      let buf = '';
      const utf8 = new TextDecoder();
      s.onData = (chunk) => {
        buf += utf8.decode(chunk, { stream: true });
        for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) hear(JSON.parse(buf.slice(0, i)));
      };
      s.onEnd = lost;
      return { send: (m) => s.write(JSON.stringify(m) + '\n'), close: () => s.end() };
    }),
    unpair: () => unpair(link),
  });
}

/** How the computer's "would like to join" names this browser. */
const deviceName = () => `${['iPhone', 'iPad', 'Android', 'Mac', 'Windows', 'Linux'].find((w) => navigator.userAgent.includes(w)) ?? 'Browser'} web app`;
