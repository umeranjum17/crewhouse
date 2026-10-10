// The phone crew list's status word and dot: the web rail's own (A.railWord, from A.groupOf), so the
// phone and the web rail agree for the same member — same word and same dot colour. The dot colours
// mirror the rail's own seat classes (web/src/styles.css `.side-seat.seat-*`: working a hollow ink
// ring, done ink, quiet/failed red, next amber, waiting/free grey) and Chief's own line
// (`.side-status`: grey, pink only for Needs you). A member missing from the office view across a
// refresh (added or leaving between the snapshot and the live events) falls back to the helper's own
// words rather than crashing; that fallback is the only place the raw status may appear, never a
// second status rule.
import * as A from '../../web/src/adapter.ts';

/** The phone pill's dot: the three the app already used (ok green, wait pink, off grey) plus the
 *  rail's own colours — danger (red), amber, ink, and work (the rail's hollow ink ring). */
export type CrewPillTone = 'ok' | 'wait' | 'off' | 'danger' | 'amber' | 'ink' | 'work';

/** The rail's dot colour for one seat (styles.css `.side-seat.seat-<seat> i`), so the phone can never
 *  paint a different colour than the rail row it mirrors. */
export const railTone = (seat: A.Seat | 'done'): CrewPillTone =>
  seat === 'done' ? 'ink'
  : seat === 'working' ? 'work'
  : seat === 'quiet' || seat === 'failed' ? 'danger'
  : seat === 'next' ? 'amber'
  : 'off';

export function crewPill(h: A.Helper, view: A.OfficeView | null): { word: string; tone: CrewPillTone } {
  const m = view?.crew.find((c) => c.id === h.id);
  const r = m && view ? A.railWord(m, view) : null;
  if (!r) return { word: h.status, tone: h.ring === 'needs' ? 'wait' : h.ring ? 'ok' : 'off' };
  // The word is the rail's (a finished today reads Done, as the web crew page does); the dot is the
  // rail's own seat colour, so both screens read the same.
  return { word: r.seat === 'done' ? 'Done' : r.word, tone: railTone(r.seat) };
}

/** Chief's row is the rail's Chief line (A.chiefWord) with the rail's own dot (`.side-status`: grey,
 *  pink only for Needs you), never a helper's line. */
export function chiefPill(view: A.OfficeView, offline: boolean, away: string): { word: string; tone: CrewPillTone } {
  if (offline) return { word: away, tone: 'off' };
  const word = A.chiefWord(view);
  return { word, tone: word === 'Needs you' ? 'wait' : 'off' };
}
