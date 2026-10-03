// Chief on the phone's screen, over other apps (Android), through @byokit/overlay: the one file that imports the kit.
// Off until the person switches it on in Settings. While it is on, it holds the phone's link (src/link.ts), so his face
// follows the crew from the same refresh as every screen: it changes only when something lands, never on a timer.
// A tap opens his panel (src/panel.tsx), a long press opens it listening. On iPhone the kit is unsupported and every call is a no-op.
// Write it here: the box the person is typing in is read once, on that tap, through Crewhouse's own accessibility
// service (the crewhouse-net module) — never in the background, and never a password box (the kit skips those).
import { overlay, stateWords, words, type OverlayState } from '@byokit/overlay';
import { focusedField } from '@byokit/overlay/focused-field';
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
const NOTICE = { channel: 'Chief on your screen', title: 'Chief is on your screen', text: 'Tap Chief for quick actions.', icon: 'chief_glyph' };

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
/** What to do when the phone greys out a switch for an app installed outside its store. */
export const restrictedWords = () => words('overlay.restricted');
/** Deal with this, or a button that needs a still: the panel steps aside, the phone asks (every time) and takes one
 *  still of the screen, and the panel comes back with it, `to` that helper with `words` in the box, to send or pick
 *  someone else. A no leaves nothing behind. */
export async function handScreen(to = '', words = '') {
  await overlay.closePanel();
  const frame = await screenFrame().catch(() => '');
  if (frame) await overlay.openPanel({ frame, to, words });
}
// Hold him to talk to Chief: the panel opens already listening (the mic starts there, never from the bubble's own
// window), and what was heard waits in the box until the person sends it.
overlay.on('longPress', () => { void overlay.openPanel({ listen: '1' }); });

/** The box in focus when he was tapped: its words and the part the person picked ('' for none), or 'off' while the
 *  phone hasn't let him see it, or null for none. */
export type Box = { app: string; text: string; picked: string } | 'off' | null;
let box: Promise<Box> = Promise.resolve(null);
// Read on the tap itself, both asks at once: his panel opens on the same tap and takes the focus with it.
overlay.on('tap', () => {
  box = Promise.all([focusedField.available(), focusedField.read()]).then(([on, f]) =>
    (!on ? 'off' : f ? { app: f.app, text: f.text, picked: f.selection ? f.text.slice(f.selection.start, f.selection.end).trim() && f.text.slice(f.selection.start, f.selection.end) : '' } : null), () => null);
});
/** The panel takes the tap's box once; a panel opened any other way has none. */
export function tappedBox() { const b = box; box = Promise.resolve(null); return b; }
/** The tap log, which orders the panel's buttons: a press is kept as its app and button (never words, gone after 30
 *  days), and `used` counts them for one app ('' when no box named it). */
export const logTap = (app: string, action: string) => void overlay.logTap({ app, action }).catch(() => {});
export async function used(app: string) {
  const n: Record<string, number> = {};
  for (const t of await overlay.taps().catch(() => [])) if (t.app === app) n[t.action] = (n[t.action] ?? 0) + 1;
  return n;
}

/** Put it in: the panel steps aside and the words become what the box the person was in says (or, with a part
 *  picked, go over that part). Nothing is sent: they press the app's own Send. An app that turns the words away gets
 *  them copied, and he says how to paste. If the box in focus is no longer the one read on the tap (another app, or
 *  its words changed), nothing is put in: he says the draft waits in `who`'s chat. */
export async function putIn(text: string, who: string, was: { app: string; text: string; picked: string }) {
  let gone = () => {};
  const closed = new Promise<void>((done) => { gone = done; setTimeout(done, 2000); }); // a panel already closed says nothing
  const off = overlay.on('panel', (e) => { if (!e.open) gone(); });
  await overlay.closePanel();
  await closed;
  off();
  const now = await focusedField.read().catch(() => null);
  const same = !!now && now.app === was.app && now.text === was.text;
  const r = same ? await focusedField.insert(text, { replace: was.picked ? 'selection' : 'all', attempts: 13, retryMs: 150, acceptNewlineLoss: true }).catch(() => 'failed' as const) : 'failed';
  if (r === 'copied') overlay.say('Copied. Hold your finger on the box, then paste.', 'chief_idle', 6000, { announce: true });
  else if (r === 'failed') overlay.say(`Chief could not put it in the box. It is in ${who}'s chat.`, 'chief_worried', 6000, { announce: true });
}
