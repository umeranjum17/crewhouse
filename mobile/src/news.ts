// News on an Android phone with no push credential: the link service (modules/crewhouse-net LinkService.kt) runs
// `keepNews`, which holds this phone's link while the app is closed and shows what crewd calls news (src/link.ts `tell`:
// Chief's reply, a helper's finished job, a card for the person, something that didn't work) as a notification that opens
// that chat or card. crewd decides what is news and holds it in quiet hours; while the app is open its screens show it.
// Migration debt: BYOKit owns phone notifications once it has an Android contract; FCM or UnifiedPush would spare the battery.
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as A from '../../web/src/adapter.ts';
import type { Json } from '../../web/src/api.ts';
import { keepLink, linkWords, onNetwork } from '../modules/crewhouse-net';
import { connect, loadGrant } from './link';

export const TASK = 'CrewhouseLink';
const CHANNEL = 'news';
let letGo = () => {};

/** The service's task: hold the link on the grant kept now (a new start replaces the last hold), and end only when this
 *  phone has no grant, which stops the service. */
export async function keepNews() {
  const grant = await loadGrant().catch(() => null);
  if (!grant) { letGo(); return; }
  // Private on a locked screen: the words show once the phone is unlocked.
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Chief and the crew', importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE }).catch(() => {});
  const was = letGo;
  const held = connect(grant, (e) => { if (e?.kind === 'news') void show(e.data, held.call).catch(() => {}); }, (st) => {
    linkWords(st === 'online' ? 'Crewhouse is connected' : 'Looking for your computer…');
    if (st === 'removed') stopNews();
  });
  const off = onNetwork(() => held.link.retry());
  letGo = () => { off(); held.release(); letGo = () => {}; };
  was();
  await new Promise<never>(() => {}); // held while the service runs
}

/** On while paired: the service starts, or restarts its task on the grant kept now. */
export const startNews = () => keepLink(true);
/** Unpaired: the hold goes and the service stops, and it stays off after a reboot. */
export function stopNews() { letGo(); keepLink(false); }

type News = { id: string; e?: { kind: string; bot: string | null; data: Json } };
/** One notification per piece of news, while the app isn't on screen. Its words come from crewd's own records, read
 *  over the link like the screens read them; a tap opens the chat or card (App.tsx reads `url`). */
async function show(n: News, call: (method: string, path: string) => Promise<Json>) {
  if (AppState.currentState === 'active') return;
  const e = n.e, state = e ? await call('GET', '/api/state').catch(() => null) : null;
  const name = (id: string | null) => (id && id !== 'chief' && state?.bots?.find((b: Json) => b.id === id)?.display) || 'Chief';
  const card = e?.kind === 'ask.opened' && state ? A.cards(state).find((c) => c.id === e.data.ask) : undefined;
  const [title, body, url] = !e ? ['Crewhouse has news', 'Open Crewhouse to see what came in while it was quiet.', 'crewhouse://needs']
    : e.kind === 'message' ? [name(e.bot), A.teaser(String(e.data.text ?? '')), `crewhouse://chat?bot=${e.bot}`]
    : e.kind === 'task.done' ? [`${name(e.bot)} finished`, A.plain(String(e.data.title ?? '')), `crewhouse://chat?bot=${e.bot}`]
    : e.kind === 'ask.opened' ? [card && card.words !== card.head ? card.head : 'Chief has something for you', card?.words ?? A.plain(String(e.data.title ?? '')), `crewhouse://card?id=${e.data.ask}`]
    : [name(e.bot), "Something didn't work. Open the chat to see what happened.", `crewhouse://chat?bot=${e.bot ?? 'chief'}`];
  await Notifications.scheduleNotificationAsync({ identifier: n.id, content: { title, body, data: { url } }, trigger: { channelId: CHANNEL } });
}
