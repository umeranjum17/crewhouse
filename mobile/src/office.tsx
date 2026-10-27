// The office's one state on the phone: Home's crew cards, Chief's card and the Crew tiles all read it, so they can
// never disagree. Crew never ask the person: a waiting member says "Waiting for Chief", and the asks reach the person
// once, through Chief.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as A from '../../web/src/adapter.ts';
import type { Json } from '../../web/src/api.ts';
import { onLive } from './link';

/** The office view: the snapshot, moved by live events until the next refresh starts it again. Home reads it once and
 *  hands it to the counts and Needs you, so they can never disagree. While out of reach, what this
 *  phone kept says how things were (App.tsx OUT). Running work stays visible; stale asks and idle details are hidden. */
export function useOffice(state: Json, offline: boolean, away: string) {
  const base = useMemo(() => A.office(state), [state]);
  const sent = useSyncExternalStore(A.onChiefSend, A.chiefSend);
  const [live, setLive] = useState<A.OfficeView | null>(null);
  const from = useRef(base);
  from.current = base;
  useEffect(() => { setLive(null); }, [base]);
  useEffect(() => onLive((e) => setLive((v) => A.officeEvent(v ?? from.current, e))), []);
  const cur = live ?? base, shown = sent ? A.sending(cur, sent) : cur;
  return offline ? A.officeAway(shown, away) : shown;
}
