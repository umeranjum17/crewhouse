// The office's one state (useOffice): Home's crew cards, Chief's card, the rail and the badge all read it, so they can
// never disagree. Crew never ask the person: a crew member waiting says what it is on and "Waiting for Chief", and the
// asks reach the person once, through Chief.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Json } from './api.ts';
import * as A from './adapter.ts';

// Live events reach the office view straight from the socket the shell already holds (main.tsx): a step swaps the lines
// and the refresh stays the source of truth.
const ears = new Set<(e: Json) => void>();
export const hear = (e: Json) => ears.forEach((f) => f(e));

const { landed } = A;

/** A crew card's state word is the member's one status (A.statusOf), the same the header counts and the rail rows
 *  read; only its glow class is the card's own. A finish today also says when. */
export type Glow = { word: string; cls: 'needs' | 'work' | 'failed' | 'done' | 'rest' };
export const glowOf = (c: A.OfficeMember, v: A.OfficeView): Glow => {
  const s = A.statusOf(c, v);
  if (s.group === 'wait') return { word: s.word, cls: A.waitsOnYou(c) ? 'needs' : 'rest' };
  if (s.group === 'work') return { word: s.word, cls: 'work' };
  if (s.group === 'done') return { word: `${s.word} ${A.clock(landed(c, v)!.at)}`, cls: 'done' };
  return { word: s.word, cls: s.seat === 'failed' ? 'failed' : 'rest' };
};

/** The office view: the snapshot, moved by live events until the next refresh starts it again. Home reads it once
 *  and hands it to the cards, so they can never disagree. While the home computer is out of reach nobody claims
 *  to be busy. */
export function useOffice(state: Json, offline = false, signedOut = false): A.OfficeView | null {
  const sent = useSyncExternalStore(A.onChiefSend, A.chiefSend);
  const view = useMemo(() => (state ? A.office(state, { signedOut }) : null), [state, signedOut]);
  const [live, setLive] = useState(view);
  const [talking, setTalking] = useState<string[]>([]);
  useEffect(() => {
    setLive(view);
    setTalking((ids) => ids.filter((id) => state?.bots.some((b: Json) => b.id === id && b.task?.state === 'working')));
  }, [view, state]);
  useEffect(() => {
    const f = (e: Json) => {
      setLive((v) => v && A.officeEvent(v, e));
      if (e.kind === 'reply.partial' && e.data?.text) setTalking((ids) => ids.includes(e.bot) ? ids : [...ids, e.bot]);
      else if (['run.thinking', 'run.tool', 'task.working', 'task.progress', 'task.done', 'task.failed', 'task.unsure', 'task.paused', 'task.queued', 'task.needs_you'].includes(e.kind)) {
        setTalking((ids) => ids.includes(e.bot) ? ids.filter((id) => id !== e.bot) : ids);
      }
    };
    ears.add(f);
    return () => { ears.delete(f); };
  }, []);
  const shown = live && sent ? A.sending(live, sent) : live;
  return shown && { ...(offline ? A.officeAway(shown) : shown), talking: offline ? [] : talking };
}
