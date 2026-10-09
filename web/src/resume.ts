// Where the installed web app was last showing, so a cold relaunch (a home-screen tap, which opens start_url "/")
// returns there instead of always Home. The device keeps it, keyed by how this browser reaches crewd — demo, paired,
// or the local shell — so one mode's place never leaks into another. crewd never sees it: no server change at all.
// Framework-free, like the rest of the shell's client layer.
import { demo, paired } from './api.ts';

const key = () => `crewhouse.place.${paired ? 'paired' : demo ? 'demo' : 'local'}`;
const store = () => { try { return localStorage; } catch { return null; } };

/** A hash that names a real place worth reopening: a thread or another screen, but not bare Home and not the
 *  launcher's one-shot person fragment. */
export function namesPlace(hash: string) {
  if (/^#person=/.test(hash)) return false;
  const a = hash.replace(/^#\/?/, '').split('/')[0];
  return a !== '' && a !== 'person';
}

/** Remember the place this launch is showing, so the next cold start reopens it; bare Home clears the memory. */
export function remember() {
  const s = store(); if (!s) return;
  if (namesPlace(location.hash)) s.setItem(key(), location.hash); else s.removeItem(key());
}

/** A home-screen launch (start_url "/", nothing after the #) reopens the remembered place. A normal link or a
 *  shortcut that already names a place has one and always wins over the memory; an unknown one falls back to Home. */
export function resume() {
  if (location.pathname !== '/') return; // the /share target is not the app root
  if (namesPlace(location.hash)) return;
  const s = store(); if (!s) return;
  const saved = s.getItem(key());
  if (saved && namesPlace(saved)) history.replaceState(null, '', `${location.pathname}${location.search}${saved}`);
}
