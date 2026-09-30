// Chief on the phone's screen, over other apps (Android), through @byokit/overlay: the one file that imports the kit.
// Off until the person switches it on in Settings. While it is on, it holds the phone's link (src/link.ts), so his face
// follows the crew from the same refresh as every screen: it changes only when something lands, never on a timer.
// A tap opens his panel (src/panel.tsx). On iPhone the kit is unsupported and every call is a no-op.
import { overlay, stateWords, words, type OverlayState } from '@byokit/overlay';
import * as SecureStore from 'expo-secure-store';
import * as A from '../../web/src/adapter.ts';
import { api, setTransport, type Json } from '../../web/src/api.ts';
import { screenFrame } from '../modules/crewhouse-net';
import { connect, type Grant } from './link';

/** The panel's registered name (index.ts). */
export const PANEL = 'ChiefPanel';
const WANTED = 'crewhouse.bubble';
// The stills scripts/icons.mjs draws into mobile/assets/bubble/, one per mood Chief wears on Home.
const MOODS = new Set(['idle', 'work', 'ask', 'happy', 'rest', 'worried', 'error']);
const NOTICE = { channel: 'Chief on your screen', title: 'Chief is on your screen', text: 'Tap him for quick actions.', icon: 'chief_glyph' };

export type { OverlayState };
export const bubbleState = (): Promise<OverlayState> => overlay.state();
export const openBubblePermission = () => overlay.openPermission();
/** A state's sentence; a phone that won't let the switch on is told where the greyed-out switch unlocks. */
export const bubbleWords = (s: OverlayState) => (s === 'needs-permission' ? `${stateWords(s)} ${words('overlay.restricted')}` : stateWords(s));
export const wanted = async () => (await SecureStore.getItemAsync(WANTED).catch(() => null)) === '1';

let needs = 0;
/** His face for how the crew is: resting when the computer is out of reach, the pink dot while something needs you,
 *  otherwise Home's own mood. A rise in what needs you is said beside him, in counts only (a shared screen shows it). */
export function showCrew(state: Json | null, offline = false) {
  if (!state || offline) { overlay.setMood('chief_rest'); return; }
  const s = A.status(state);
  const n = s?.needsYou ?? 0;
  const mood = n ? 'ask' : A.chief(state).mood;
  overlay.setMood(`chief_${MOODS.has(mood) ? mood : 'idle'}`);
  if (n > needs && s) overlay.say(s.publicText, 'chief_ask', 4000);
  needs = n;
}

let release: (() => void) | null = null;
/** Hold the link while the bubble is on, and follow the crew on it. */
function follow(grant: Grant) {
  if (release) return;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const look = () => api.state().then((st) => showCrew(st), () => {});
  const held = connect(grant, () => { clearTimeout(pending); pending = setTimeout(look, 120); }, (st) => {
    if (st === 'online') void look(); else if (st === 'offline') showCrew(null, true); else if (st === 'removed') void bubbleOff();
  });
  setTransport(held.call);
  release = () => { clearTimeout(pending); held.release(); };
}
function letGo() { release?.(); release = null; }
overlay.on('state', (e) => { if (e.state !== 'on') letGo(); });

/** Switch him on: the answer is 'on', or what the phone still needs (the over-other-apps switch). */
export async function bubbleOn(grant: Grant): Promise<OverlayState> {
  await SecureStore.setItemAsync(WANTED, '1');
  const st = (await overlay.state()) === 'on' ? 'on' : await overlay.start({ host: 'window', mood: 'chief_idle', notice: NOTICE, panel: PANEL });
  if (st === 'on') follow(grant);
  return st;
}
export async function bubbleOff() {
  await SecureStore.deleteItemAsync(WANTED).catch(() => {});
  letGo();
  await overlay.stop();
}
/** On every start of the app: back on if the person left it on and the phone still allows it. */
export async function bubbleResume(grant: Grant) {
  if (await wanted()) await bubbleOn(grant).catch(() => {});
}

export const closePanel = () => overlay.closePanel();
/** Hand my screen to…: the panel steps aside, the phone asks (every time) and takes one still of the screen, and the
 *  panel comes back with it to pick who gets it. A no leaves nothing behind. */
export async function handScreen() {
  await overlay.closePanel();
  const frame = await screenFrame().catch(() => '');
  if (frame) await overlay.openPanel({ frame });
}
