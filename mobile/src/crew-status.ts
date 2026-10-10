// The phone crew list's status word and dot: the web rail's own (A.railWord, from A.groupOf), so the
// phone and the web rail agree for the same member. A member missing from the office view across a
// refresh (added or leaving between the snapshot and the live events) falls back to the helper's own
// words rather than crashing; that fallback is the only place the raw status may appear, never a
// second status rule.
import * as A from '../../web/src/adapter.ts';

export type CrewPillTone = 'ok' | 'wait' | 'off';
export function crewPill(h: A.Helper, view: A.OfficeView | null): { word: string; tone: CrewPillTone } {
  const m = view?.crew.find((c) => c.id === h.id);
  const r = m && view ? A.railWord(m, view) : null;
  if (!r) return { word: h.status, tone: h.ring === 'needs' ? 'wait' : h.ring ? 'ok' : 'off' };
  // The word is the rail's (a finished today reads Done, as the web crew page does); the dot is the
  // web crew page's (green while working or done, otherwise plain), so both screens read the same.
  return { word: r.seat === 'done' ? 'Done' : r.word, tone: r.seat === 'working' || r.seat === 'done' ? 'ok' : 'off' };
}
