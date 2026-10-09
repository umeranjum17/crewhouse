// The installed web app's end of the link, as the phone's (mobile/src/link.ts): @byokit/link's device side, its grant
// sealed in this browser's IndexedDB. Paired, the link carries every call, the live events and a bot's screen
// (web/src/api.ts `setLink`); with no grant the public shell runs its demo. Loaded only on the public shell.
import { DeviceLink, LinkError, browserDeviceStore, decodeOffer, offerText, pairWithCode, pairWithOffer, type DeviceGrant } from '@byokit/link';
import { findHost } from '@byokit/relay/device';
import { readTyped } from './typed.ts';
import { lineSignaling, setLink, type Json } from './api.ts';
import { setBadge, turnOffNotifications } from './pwa.ts';

const store = browserDeviceStore('crewhouse.grant');
const BUILD = 'p9b'; // what crewd takes as a current app (src/link.ts `currentPhone`)

/** Boot: a grant kept here means paired, so the link carries everything from the first screen. */
export async function resume() {
  const grant = await store.load().catch(() => null);
  if (grant) start(grant);
}

/** The paste box: a relay code (`SHORT-CODE@relay`) or a direct envelope, split by shape (readTyped). Resolves once the
 *  person at the computer says yes, with the grant saved; `onWords` gets the two words to check meanwhile. */
export async function pair(text: string, onWords: (w: string) => void) {
  const t = readTyped(text.trim());
  const o = { name: deviceName(), onWords };
  if (t.kind === 'unknown') throw new Error('That code is missing a part. Copy the whole code from your computer, then try again.');
  let grant: DeviceGrant;
  // A relay that is off fails the fetch itself ('Failed to fetch'), so the person gets the app's words instead.
  if (t.kind === 'relay') grant = await pairWithCode(await findHost(t.base, t.short).catch((e) => {
    throw e instanceof TypeError ? new Error("Could not reach your computer's relay. Check it is on and try again.") : e;
  }), t.code, o);
  // A direct code dials the computer's own addresses, so off its network it can't get through; the relay's code can.
  else grant = await pairWithOffer(offerText(decodeOffer(t.text)), o).catch((e) => {
    throw e instanceof LinkError && e.code === 'unreachable' ? new Error(`${e.message} On another network? Paste the second code the command printed instead.`) : e;
  });
  await store.save(grant);
}

/** Back to the demo: tell the computer (briefly; it may be off), forget the grant, clear the icon's count. */
export async function unpair(link: DeviceLink) {
  const bounded = (step: Promise<unknown>) => Promise.race([step, new Promise((ok) => setTimeout(ok, 2500))]).catch(() => {});
  await bounded(turnOffNotifications());
  await bounded(link.unpair());
  link.stop();
  await store.clear();
  await leave();
}

/** The same installed app opens fresh: the grant (or its absence) decides the mode at boot. A deliberate restart
 *  lands Home, never on the last place, so it flags itself for `resume()` (web/src/resume.ts). */
export async function leave() {
  await setBadge(0);
  try { sessionStorage.setItem('crewhouse.home', '1'); } catch { /* no storage: Home is the default anyway */ }
  location.replace('/');
}

function start(grant: DeviceGrant) {
  const listeners = new Set<(e: Json) => void>();
  const link: DeviceLink = new DeviceLink(grant, {
    store,
    // The computer says where else it can be reached: remember each one.
    onEvent: (e: any) => { if (e?.kind === 'link.urls') (e.data?.urls ?? []).forEach((u: string) => link.addUrl(u)); else listeners.forEach((f) => f(e)); },
    onStatus: (s) => { if (s === 'online') listeners.forEach((f) => f({ kind: 'connected' })); if (s === 'removed') void leave(); },
  });
  setLink({
    name: grant.hostName,
    // A read or the notifications key ask gives up after 15 s, so a computer that's off shows as out of reach; a change waits through reconnects.
    call: async (method, path, body) => {
      let r: { status: number; body: Json };
      try { r = await link.request(`${method} ${path}`, { ...body, build: BUILD }, { timeoutMs: method === 'GET' || body?.key === true ? 15_000 : undefined }) as typeof r; } catch (e) {
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
