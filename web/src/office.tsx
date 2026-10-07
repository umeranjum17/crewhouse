// The office as panels (Term look): Chief and every helper gets one panel in a 3-column grid on a desk, one
// column on a phone-width web page. Each panel shows the helmet in its mood, the current line, one meta line, the
// last three timed steps and the one action (the ask's own yes/no, a Review link for anything needing words, or the
// finished file). Tapping a name opens that chat. Every word and count comes from the one A.office view Home also
// reads (useOffice). The helmet's own moods carry the motion: a scan line while working, still otherwise, none under
// Reduce Motion (parts.tsx).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Json } from './api.ts';
import * as A from './adapter.ts';
import * as art from './art.ts';
import { answer, ChiefArt, PalArt, PreviewCard } from './parts.tsx';

// Live events reach the panels straight from the socket the shell already holds (main.tsx): a step swaps the lines
// and the refresh stays the source of truth.
const ears = new Set<(e: Json) => void>();
export const hear = (e: Json) => ears.forEach((f) => f(e));

const today = () => new Date().setHours(0, 0, 0, 0);
/** The latest thing this helper landed today, if any. */
const landed = (c: A.OfficeMember, v: A.OfficeView) =>
  v.done.filter((t) => t.helper === c.id && t.at >= today()).sort((a, b) => b.at - a.at)[0];

/** The panel's state word, in the board's own sentence case. */
export type Glow = { word: string; cls: 'needs' | 'work' | 'quiet' | 'failed' | 'done' | 'rest' };
export const glowOf = (c: A.OfficeMember, v: A.OfficeView): Glow => {
  if (A.waitsOnYou(c)) return { word: 'Needs you', cls: 'needs' };
  const seat = A.seatOf(c);
  if (seat === 'working') return { word: 'At work', cls: 'work' };
  if (seat === 'quiet') return { word: 'Gone quiet', cls: 'quiet' };
  if (seat === 'failed') return { word: "Didn't finish", cls: 'failed' };
  if (landed(c, v)) return { word: `Done ${A.clock(landed(c, v)!.at)}`, cls: 'done' };
  return { word: 'Resting', cls: 'rest' };
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

/** The Office count line both headers read: needs-you rows, at work, done today and resting. The member buckets
 *  partition the crew; the needs number counts every row (Chief carries rows no crew panel holds). */
export const summaryOf = (v: A.OfficeView): string => {
  const needy = v.crew.filter(A.waitsOnYou);
  const work = v.crew.filter((c) => !A.waitsOnYou(c) && ['working', 'quiet'].includes(A.seatOf(c)));
  const done = v.crew.filter((c) => !A.waitsOnYou(c) && !['working', 'quiet', 'failed'].includes(A.seatOf(c)) && landed(c, v));
  const rest = v.crew.length - needy.length - work.length - done.length;
  const n = v.counts.needs;
  return `${n} ${n === 1 ? 'needs' : 'need'} you · ${work.length} at work · ${done.length} done · ${rest} resting`;
};

/** Phone width renders the grouped list, as the board's phone frame does: headings with dashed rules, rows with the
 *  helmet, name, state, line, meta and the question's own button. Helmets are still here; the scan lives on desktop. */
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

export function Office({ state, live, night, onDone }: { state: Json; live: A.OfficeView; night: boolean; onDone?: () => void }) {
  void night;   // the helmets read the shell's day/night themselves (parts.tsx), so day never draws night art
  const jobs = useMemo(() => new Map(A.work(state).map((w) => [w.helper, w])), [state]);
  const roles = useMemo(() => new Map(A.crew(state).map((h) => [h.id, h])), [state]);
  const titles = useMemo(() => new Map([...jobs].map(([id, w]) => [id, w.title])), [jobs]);
  if (useNarrow()) return (
    <section className="office" aria-label="The office">
      <Groups live={live} titles={titles} onDone={onDone} />
    </section>
  );
  return (
    <section className="office" aria-label="The office">
      <div className="panels">
        <ChiefPanel live={live} />
        {A.roster(live.crew).map((c) => <HelperPanel key={c.id} c={c} live={live}
          job={jobs.get(c.id)} role={roles.get(c.id)?.role} onDone={onDone} />)}
      </div>
    </section>
  );
}

type Group = 'needs' | 'work' | 'done' | 'rest';
const TITLES: Record<Group, string> = { needs: 'Needs you', work: 'At work', done: 'Done today', rest: 'Resting' };
/** Every helper lands in exactly one group: waiting on you, at work on an open job, done today, or resting. */
const groupOf = (c: A.OfficeMember, v: A.OfficeView): Group => {
  if (A.waitsOnYou(c)) return 'needs';
  const seat = A.seatOf(c);
  if (seat === 'working' || seat === 'quiet') return 'work';
  if (seat !== 'failed' && landed(c, v)) return 'done';
  return 'rest';
};

function Groups({ live, titles, onDone }: { live: A.OfficeView; titles: Map<string, string>; onDone?: () => void }) {
  const groups = (['needs', 'work', 'done', 'rest'] as Group[])
    .map((g) => [g, live.crew.filter((c) => groupOf(c, live) === g)] as const).filter(([, rows]) => rows.length);
  return (
    <div className="groups">
      {groups.map(([g, rows]) => <section key={g} className="grp" aria-label={TITLES[g]}>
        <div className="grp-head"><span>{TITLES[g]}</span></div>
        {rows.map((c) => <GroupRow key={c.id} c={c} live={live} jobTitle={titles.get(c.id)} onDone={onDone} />)}
      </section>)}
    </div>
  );
}

/** One grouped row: the still helmet, the name and state, the current line, one meta line, the question's button. */
function GroupRow({ c, live, jobTitle, onDone }: { c: A.OfficeMember; live: A.OfficeView; jobTitle?: string; onDone?: () => void }) {
  const g = groupOf(c, live);
  const done = landed(c, live);
  const glow = glowOf(c, live);
  const line = c.ask ? c.ask.head : g === 'done' && done!.summary ? done!.summary : c.status;
  const meta0 = jobTitle && (A.seatOf(c) === 'working' || A.seatOf(c) === 'quiet' || A.waitsOnYou(c)) ? jobTitle
    : g === 'done' ? c.status : c.status === 'Needs you' ? c.step : c.status;
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
        {c.ask && <AskButton c={c.ask} name={c.name} onDone={onDone} />}
      </div>
    </article>
  );
}

/** A question's own button: the ask's yes and no inline where nothing needs words first, otherwise its own action
 *  label opening the review — the ask's words, never a generic button. */
function AskButton({ c, name, onDone }: { c: A.Card; name: string; onDone?: () => void }) {
  const [oops, setOops] = useState(false);
  const last = useRef<Json | null>(null);
  const act = async (body: Json) => { last.current = body; setOops(false); if (await answer(c, body)) onDone?.(); else setOops(true); };
  const yes = c.choices[0];
  const deny = c.choices.find((x) => x.body.answer === 'deny' && x !== yes);
  const simple = !!yes && !c.reply && !c.review && c.kind !== 'routine' && c.kind !== 'plan' && c.evidence !== 'draft';
  const label = yes?.label ?? (c.reply ? `Answer ${name}…` : c.review ? 'Review order' : 'Review…');
  if (!simple) return <div className="p-acts"><a className="btn go gr-act" href={`#/ask/${c.id}`}>{label}</a></div>;
  return (
    <>
      <div className="btns">
        <button className="btn go" onClick={() => act(yes.body)}>{yes.label}</button>
        {deny && <button className="btn" onClick={() => act(deny.body)}>{deny.label}</button>}
      </div>
      {oops && <div className="send-failed" role="alert">That didn't go through. <button type="button" className="link inline" onClick={() => last.current && act(last.current)}>Try again</button></div>}
    </>
  );
}

/** Chief's panel: his line, since when the thread has been going, and the last three things said or finished. */
function ChiefPanel({ live }: { live: A.OfficeView }) {
  const crew = live.crew;
  const recent = [...live.needs.map((c) => ({ at: c.at, text: c.head })),
    ...live.done.map((t) => ({ at: t.at, text: `${crew.find((m) => m.id === t.helper)?.name ?? 'The crew'} finished ${t.title || 'a job'}` }))]
    .sort((a, b) => b.at - a.at);
  const glow: Glow = A.chiefAsks(live).length ? { word: 'Needs you', cls: 'needs' }
    : live.chief.mood === 'work' ? { word: 'At work', cls: 'work' } : { word: 'Resting', cls: 'rest' };
  return (
    <Panel name="Chief" href="#/chief" mood={live.chief.mood} chief line={live.chief.line}
      meta={recent.length ? `Talking with you since ${A.clock(Math.min(...recent.map((r) => r.at)))}` : 'Runs your crew'}
      steps={recent.slice(0, 3)} glow={glow} think={live.chief.mood === 'work'} />
  );
}

/** One helper's panel: the helmet, the current line, one meta line, the last three timed steps, the one action. */
function HelperPanel({ c, live, job, role, onDone }: { c: A.OfficeMember; live: A.OfficeView; job?: A.Work; role?: string; onDone?: () => void }) {
  const done = landed(c, live);
  const glow = glowOf(c, live);
  // Done leads with the finished work itself, as the board does; anything else leads with its line.
  const line = c.ask ? c.ask.head : glow.cls === 'done' && done!.summary ? done!.summary : c.status;
  const meta0 = job && job.helper === c.id && (A.seatOf(c) === 'working' || A.seatOf(c) === 'quiet' || A.waitsOnYou(c)) ? job.title
    : glow.cls === 'done' ? c.status : c.status || role || '';
  const meta = meta0 === line ? '' : meta0;
  const file = !c.ask && c.things[0] ? c.things[0] : undefined;
  // The scan follows the helmet's own mood (at work even while holding a question), never the seat.
  const think = art.helmetOf(c.mood) === 'think';
  return (
    <Panel name={c.name} href={`#/h/${c.id}`} mood={c.mood} kind={c.kind} line={line} meta={meta}
      steps={c.steps.slice(-3)} glow={glow} think={think}
      action={c.ask ? <AskButton c={c.ask} name={c.name} onDone={onDone} /> : file ? <PreviewCard f={file} /> : null} />
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

