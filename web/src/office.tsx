// The office as panels (Term look): Chief and every helper gets one panel in a 3-column grid on a desk, one
// column on a phone-width web page. Each panel shows the helmet in its mood, the current line, one meta line, the
// last three timed steps and the one action (the finished file). Crew never ask the person: a crew member waiting says
// what it is on and "Waiting for Chief", and the asks reach the person once, through Chief's one action. Tapping a
// name opens that chat. Every word and count comes from the one A.office view Home also reads (useOffice). The helmet's
// own moods carry the motion: a scan line while working, still otherwise, none under Reduce Motion (parts.tsx).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Json } from './api.ts';
import * as A from './adapter.ts';
import * as art from './art.ts';
import { ChiefArt, PalArt, PreviewCard } from './parts.tsx';

// Live events reach the panels straight from the socket the shell already holds (main.tsx): a step swaps the lines
// and the refresh stays the source of truth.
const ears = new Set<(e: Json) => void>();
export const hear = (e: Json) => ears.forEach((f) => f(e));

const { landed, groupOf } = A;

/** The panel's state word, in the board's own sentence case. It follows the Office group (A.groupOf) — the one
 *  per-member status the header counts and the rail rows read — so a held helper shows "Waiting", never "Resting". */
export type Glow = { word: string; cls: 'needs' | 'work' | 'quiet' | 'failed' | 'done' | 'rest' };
export const glowOf = (c: A.OfficeMember, v: A.OfficeView): Glow => {
  const g = A.groupOf(c, v), seat = A.seatOf(c);
  if (g === 'needs') return { word: 'Waiting', cls: 'needs' };
  if (g === 'work') return seat === 'quiet' ? { word: 'Gone quiet', cls: 'quiet' } : { word: 'At work', cls: 'work' };
  if (g === 'done') return { word: `Done ${A.clock(landed(c, v)!.at)}`, cls: 'done' };
  return seat === 'failed' ? { word: "Didn't finish", cls: 'failed' } : { word: 'Resting', cls: 'rest' };
};

/** The office view: the snapshot, moved by live events until the next refresh starts it again. Home reads it once
 *  and hands it to the panels, so they can never disagree. While the home computer is out of reach nobody claims
 *  to be busy. */
export function useOffice(state: Json, offline = false): A.OfficeView | null {
  const view = useMemo(() => (state ? A.office(state) : null), [state]);
  const [live, setLive] = useState(view);
  useEffect(() => setLive(view), [view]);
  useEffect(() => {
    const f = (e: Json) => setLive((v) => v && A.officeEvent(v, e));
    ears.add(f);
    return () => { ears.delete(f); };
  }, []);
  return live && offline ? A.officeAway(live, 'The home computer is asleep') : live;
}

/** The Office count line both headers read: waiting crew, at work, done today and resting — the same words as the
 *  board's groups (A.groupOf; only Chief says "Needs you"), so the counts are the rows. */
export const summaryOf = (v: A.OfficeView): string => {
  const n = (g: Group) => v.crew.filter((c) => groupOf(c, v) === g).length;
  return `${n('needs')} waiting · ${n('work')} at work · ${n('done')} done · ${n('rest')} resting`;
};

/** Phone width renders the grouped list, as the board's phone frame does: headings with dashed rules, rows with the
 *  helmet, name, state, line and meta, under Chief's one action. Helmets are still here; the scan lives on desktop. */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 899px)').matches);
  useEffect(() => {
    const q = matchMedia('(max-width: 899px)');
    const f = () => setNarrow(q.matches);
    q.addEventListener('change', f);
    return () => q.removeEventListener('change', f);
  }, []);
  return narrow;
}

export function Office({ state, live, night }: { state: Json; live: A.OfficeView; night: boolean }) {
  void night;   // the helmets read the shell's day/night themselves (parts.tsx), so day never draws night art
  const jobs = useMemo(() => new Map(A.work(state).map((w) => [w.helper, w])), [state]);
  const roles = useMemo(() => new Map(A.crew(state).map((h) => [h.id, h])), [state]);
  const titles = useMemo(() => new Map([...jobs].map(([id, w]) => [id, w.title])), [jobs]);
  if (useNarrow()) return (
    <section className="office" aria-label="The office">
      <Groups live={live} titles={titles} />
    </section>
  );
  return (
    <section className="office" aria-label="The office">
      <div className="panels">
        <ChiefPanel live={live} />
        {A.roster(live.crew).map((c) => <HelperPanel key={c.id} c={c} live={live}
          job={jobs.get(c.id)} role={roles.get(c.id)?.role} />)}
      </div>
    </section>
  );
}

type Group = A.Group;
const TITLES: Record<Group, string> = { needs: 'Waiting', work: 'At work', done: 'Done today', rest: 'Resting' };
function Groups({ live, titles }: { live: A.OfficeView; titles: Map<string, string> }) {
  const groups = (['needs', 'work', 'done', 'rest'] as Group[])
    .map((g) => [g, live.crew.filter((c) => groupOf(c, live) === g)] as const).filter(([, rows]) => rows.length);
  return (
    <div className="groups">
      {live.needs.length > 0 && <ToChief live={live} />}
      {groups.map(([g, rows]) => <section key={g} className="grp" aria-label={TITLES[g]}>
        <div className="grp-head"><span>{TITLES[g]}</span></div>
        {rows.map((c) => <GroupRow key={c.id} c={c} live={live} jobTitle={titles.get(c.id)} />)}
      </section>)}
    </div>
  );
}

/** One grouped row: the still helmet, the name and state, the current line, one meta line. */
function GroupRow({ c, live, jobTitle }: { c: A.OfficeMember; live: A.OfficeView; jobTitle?: string }) {
  const g = groupOf(c, live);
  const done = landed(c, live);
  const glow = glowOf(c, live);
  const line = A.waitsOnYou(c) ? jobTitle || c.step || A.NO_JOB : g === 'done' && done!.summary ? done!.summary : c.status;
  // A done row says what it finished, never a waiting status.
  const meta0 = A.waitsOnYou(c) ? A.WAIT_CHIEF : jobTitle && (A.seatOf(c) === 'working' || A.seatOf(c) === 'quiet') ? jobTitle
    : g === 'done' ? done!.title : c.status;
  const meta = meta0 === line ? '' : meta0;
  return (
    <article className="grow-row" aria-label={`${c.name}: ${line}`}>
      <PalArt kind={c.kind} mood={c.mood} d={6} name={c.name} />
      <div className="grow">
        <div className="gr-top">
          <a href={`#/h/${c.id}`}><b>{c.name}</b></a>
          <span className={`p-state ${glow.cls}`}><i />{glow.word}</span>
        </div>
        <p className="p-line">{line}</p>
        {meta && <p className="p-meta">{meta}</p>}
      </div>
    </article>
  );
}

/** Chief's one action: every ask, counted, opening Chief, who carries them. */
const ToChief = ({ live }: { live: A.OfficeView }) =>
  <div className="p-acts"><a className="btn go" href="#/chief">{A.chiefHas(live)}</a></div>;

/** Chief's panel: his line, since when the thread has been going, the last three things finished, and his one action. */
function ChiefPanel({ live }: { live: A.OfficeView }) {
  const crew = live.crew;
  const recent = [...live.done.map((t) => ({ at: t.at, text: `${crew.find((m) => m.id === t.helper)?.name ?? 'The crew'} finished ${t.title || 'a job'}` }))]
    .sort((a, b) => b.at - a.at);
  const glow: Glow = A.chiefAsks(live).length ? { word: 'Needs you', cls: 'needs' }
    : live.chief.mood === 'work' ? { word: 'At work', cls: 'work' } : { word: 'Resting', cls: 'rest' };
  // Chief's own line names who "needs you"; in the Office crew only wait for him, so his panel says how many do.
  const waiting = crew.filter(A.waitsOnYou).length;
  const line = live.chief.mood !== 'ask' ? live.chief.line : waiting ? `${waiting} waiting for Chief` : 'Has something for you';
  return (
    <Panel name="Chief" href="#/chief" mood={live.chief.mood} chief line={line}
      meta={recent.length ? `Talking with you since ${A.clock(Math.min(...recent.map((r) => r.at)))}` : 'Runs your crew'}
      steps={recent.slice(0, 3)} glow={glow} think={live.chief.mood === 'work'} action={live.needs.length > 0 && <ToChief live={live} />} />
  );
}

/** One helper's panel: the helmet, the current line, one meta line, the last three timed steps, the one action. */
function HelperPanel({ c, live, job, role }: { c: A.OfficeMember; live: A.OfficeView; job?: A.Work; role?: string }) {
  const done = landed(c, live);
  const glow = glowOf(c, live);
  // Done leads with the finished work itself, as the board does; waiting leads with what it is on; anything else its line.
  const line = A.waitsOnYou(c) ? job?.title || c.step || A.NO_JOB : glow.cls === 'done' && done!.summary ? done!.summary : c.status;
  const meta0 = A.waitsOnYou(c) ? A.WAIT_CHIEF : job && (A.seatOf(c) === 'working' || A.seatOf(c) === 'quiet') ? job.title
    : glow.cls === 'done' ? done!.title : c.status || role || '';
  const meta = meta0 === line ? '' : meta0;
  const file = !c.ask && c.things[0] ? c.things[0] : undefined;
  // The scan follows the helmet's own mood (at work even while holding a question), never the seat.
  const think = art.helmetOf(c.mood) === 'think';
  return (
    <Panel name={c.name} href={`#/h/${c.id}`} mood={c.mood} kind={c.kind} line={line} meta={meta}
      steps={c.steps.slice(-3)} glow={glow} think={think}
      action={file ? <PreviewCard f={file} /> : null} />
  );
}

function Panel({ name, href, mood, kind, chief, line, meta, steps, glow, think, action }: {
  name: string; href: string; mood: art.Mood; kind?: art.Kind; chief?: boolean; line: string; meta: string;
  steps: { at: number; text: string }[]; glow: Glow; think: boolean; action?: ReactNode;
}) {
  return (
    <article className={`panel glow-${glow.cls}${glow.cls === 'needs' ? ' hot' : ''}`} aria-label={`${name}: ${line}`}>
      <header className="p-head">
        <a href={href}><b>{name}</b></a>
        <span className={`p-state ${glow.cls}`}><i />{glow.word}</span>
      </header>
      <div className="p-body">
        {chief ? <ChiefArt mood={mood} d={5} hero={think} /> : <PalArt kind={kind!} mood={mood} d={5} live={think} />}
        <div className="grow">
          <p className="p-line">{line}</p>
          {meta && <p className="p-meta">{meta}</p>}
        </div>
      </div>
      {steps.length > 0 && <ol className="p-steps">
        {steps.map((s, i) => <li key={i}><time className="time">{A.clock(s.at)}</time><span>{s.text}</span></li>)}
      </ol>}
      {action && <div className="p-acts">{action}</div>}
    </article>
  );
}

