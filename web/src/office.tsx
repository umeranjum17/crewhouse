// The office at the top of Home: Chief and the crew in one flat room, drawn front on like a cut-open dollhouse, with
// what each helper is making for you pinned beside their desk. The phone draws the same room (mobile/src/office.tsx),
// and A.floorPlan (web/src/adapter.ts) says who sits where at any crew size: a desk for Chief and for each helper on a
// job of yours, the lounge sofa for everyone else, "+N more" past two rows of each. Every word comes from A.office:
// a member's room holds only their own jobs, and a helper busy with someone else's shows just "Busy with another job".
// Nothing is decided here: a question opens its review sheet, a helper opens their panel (the "Home commits nothing"
// rule). Nothing moves while the room is quiet: a helper hops once when their news lands, and Reduce Motion skips it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Json } from './api.ts';
import * as A from './adapter.ts';
import * as art from './art.ts';
import { room as ROOM } from './tokens.ts';
import { Face, Media, Pill, Steps, useDialogOwn } from './parts.tsx';

// Live events reach the room straight from the socket the shell already holds (main.tsx): a step swaps the bubble
// and a new thing lands by the desk before the debounced refresh lands, and the refresh stays the source of truth.
const ears = new Set<(e: Json) => void>();
export const hear = (e: Json) => ears.forEach((f) => f(e));

const go = (hash: string) => { location.hash = hash; };
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Tone = { cls: string; pill: 'ok' | 'wait' | 'off' };
function tone(c: A.OfficeMember): Tone {
  if (A.waitsOnYou(c)) return { cls: 'needs', pill: 'wait' };
  if (c.ring === 'working') return { cls: 'work', pill: 'ok' };
  if (c.busyElsewhere) return { cls: 'away', pill: 'off' };
  if (c.status === 'Up next') return { cls: 'next', pill: 'off' };
  return { cls: 'free', pill: 'off' };
}
const said = (c: A.OfficeMember) => (c.busyElsewhere ? `${c.name}, ${A.BUSY_ELSEWHERE.toLowerCase()}`
  : A.waitsOnYou(c) ? `${c.name} needs you` : c.ring === 'working' ? `${c.name}, working on ${c.status}` : `${c.name}, ${c.status.toLowerCase()}`);

/** A mascot as crisp square pixels with an ink edge, `dot` px a pixel; one image per face, made once. */
const urls = new Map<string, string>();
function Sprite({ who, mood, dot, night, className = '', beat }: { who: art.Kind | 'chief'; mood: art.Mood; dot: number; night: boolean; className?: string; beat?: string }) {
  const key = `${who}-${mood}-${night && who === 'chief' ? 'n' : 'd'}`;
  let url = urls.get(key);
  if (!url) {
    const svg = who === 'chief' ? art.spriteSvg(art.chief(mood), night ? art.CHIEF_PAL_NIGHT : art.CHIEF_PAL, 1, art.EDGE) : art.spriteSvg(art.pal(who, mood), art.palPalette(who), 1, art.EDGE);
    urls.set(key, url = `data:image/svg+xml,${encodeURIComponent(svg)}`);
  }
  const [w, h] = who === 'chief' ? [24, 25] : [20, 19];
  const img = useRef<HTMLImageElement>(null);
  // A hop when their news lands (a new ring, mood or thing): once, never on the first paint, never with Reduce Motion.
  const was = useRef(beat);
  useEffect(() => {
    if (was.current === beat) return;
    was.current = beat;
    if (!reduced()) img.current?.animate([{ translate: '0 0' }, { translate: '0 -10px', offset: 0.35 }, { translate: '0 0', offset: 0.7 }, { translate: '0 -3px', offset: 0.85 }, { translate: '0 0' }], { duration: 560, easing: 'ease-out' });
  }, [beat]);
  return <img ref={img} className={`o-px o-sprite ${className}`} src={url} alt="" width={w * dot} height={h * dot} draggable={false} />;
}

const KIND_WORDS: Record<A.FileView['kind'], string> = { image: 'a picture', video: 'a video', sheet: 'a spreadsheet', page: 'a document', doc: 'a file' };

export function Office({ state, night }: { state: Json; night: boolean }) {
  const view = useMemo(() => A.office(state, { busyElsewhere: true }), [state]);
  const [live, setLive] = useState(view);
  useEffect(() => setLive(view), [view]);
  useEffect(() => {
    const f = (e: Json) => setLive((v) => A.officeEvent(v, e));
    ears.add(f);
    return () => { ears.delete(f); };
  }, []);
  const roles = useMemo(() => new Map(A.crew(state).map((h) => [h.id, h])), [state]);
  // Every question a helper has open, the one that matters most first (A.askRank), for their panel.
  const asks = useMemo(() => {
    const by = new Map<string, A.Card[]>();
    for (const c of A.cards(state)) by.set(c.helper, [...(by.get(c.helper) ?? []), c]);
    for (const l of by.values()) l.sort((a, b) => A.askRank(a) - A.askRank(b));
    return by;
  }, [state]);
  const crew = live.crew;
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  // The room is as many seats across as it is wide: measured before the first paint, then on every resize.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([en]) => setWidth(Math.round(en.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const plan = A.floorPlan(crew, width || 360, all);
  const folds = all && A.floorPlan(crew, width || 360).more > 0;

  // A thing that just arrived wears "New" for a moment and drops in.
  const seen = useRef<Map<string, number> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const now = new Map(live.crew.map((c) => [c.id, c.things.length]));
    const was = seen.current;
    seen.current = now;
    if (!was) return;
    const got = new Set<string>();
    for (const c of live.crew) for (let i = was.get(c.id) ?? c.things.length; i < c.things.length; i++) got.add(`${c.id}:${i}`);
    if (!got.size) return;
    setFresh((f) => new Set([...f, ...got]));
    // Its own timer, kept past the next change: a step arriving a second later must not leave "New" up for good.
    timers.current.push(window.setTimeout(() => setFresh((f) => new Set([...f].filter((k) => !got.has(k)))), 6000));
  }, [live]);

  const r = night ? ROOM.night : ROOM.day;
  const vars = { '--r-wall': r.wall, '--r-stripe': r.stripe, '--r-skirt': r.skirt, '--r-floor': r.floor, '--r-seam': r.seam, '--r-desk': r.desk, '--r-top': r.top, '--r-edge': r.edge,
    '--r-bezel': r.bezel, '--r-screen': r.screen, '--r-sofa': r.sofa, '--r-sofa-dark': r.sofaDark, '--r-window': r.window, '--r-frame': r.frame, '--r-leaf': r.leaf, '--r-pot': r.pot } as CSSProperties;
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const today = live.done.filter((t) => t.at >= day.getTime()).length; // the tray holds today's, as Home's count does
  const calm = crew.some((c) => c.ring || c.ask) ? ''
    : crew.some((c) => c.busyElsewhere) ? 'Nothing of yours on the go right now.' : 'Nothing of yours on the go. The crew is free.';
  const chiefBusy = live.chief.mood === 'ask' ? 'needs' : live.chief.mood === 'work' ? 'work' : '';

  return (
    <section className="office" aria-label="The office">
      <div ref={box} className="o-room" style={vars}>
        <div className="o-head">
          {calm && <span className="o-calm">{calm}</span>}
          <a className="o-tray" href="#/things" aria-label={`Your tray: ${today} done today`}>Your tray · {today}</a>
        </div>
        <div className="o-desks" style={{ ['--cols' as string]: plan.cols }}>
          <div className="o-cell chief">
            <div className="o-chair" />
            <Sprite who="chief" mood={live.chief.mood} dot={3} night={night} beat={live.chief.mood} />
            <div className="o-seat" />
            <Bubble cls={chiefBusy} name="Chief" line={live.chief.line} />
            <button className="o-hit" onClick={() => go('#/chief')} aria-label={`Chief: ${live.chief.line}`} />
          </div>
          {plan.desks.map((c) => (
            <div key={c.id} className="o-cell">
              <Sprite who={c.kind} mood={c.mood} dot={3} night={night} className="at-desk" beat={`${c.ring}|${c.mood}|${c.things.length}|${c.ask?.id ?? ''}`} />
              <div className="o-deskf" />
              <div className="o-mon"><Screen c={c} /></div>
              {c.things.length > 0 && <div className="o-things" aria-hidden>{c.things.slice(-2).map((f, j) => {
                const i = c.things.length - Math.min(2, c.things.length) + j, k = `${c.id}:${i}`;
                return <span key={k} className={`o-thing ${f.kind === 'image' || f.kind === 'video' ? 'o-pin' : 'o-paper'}${fresh.has(k) ? ' drop' : ''}`}
                  style={{ ['--c' as string]: art.PALS[c.kind].body }} title={f.name}>{fresh.has(k) && <span className="o-new">New</span>}</span>;
              })}</div>}
              <button className="o-hit" onClick={() => setOpen(c.id)} aria-label={said(c) + (c.things.length ? `, made ${c.things.map((f) => KIND_WORDS[f.kind]).join(', ')}` : '')} />
              {A.waitsOnYou(c) && c.ask
                ? <Bubble cls="needs" name={c.name} line={c.ask.head}><a href={`#/ask/${c.ask.id}`} aria-label={`Review what ${c.name} needs: ${c.ask.head}`}>Review</a></Bubble>
                : <Bubble cls={tone(c).cls} name={c.name} line={c.step || c.status} typing={c.ring === 'working'} />}
            </div>
          ))}
          {Array.from({ length: plan.spare }, (_, i) => (
            <div key={`spare${i}`} className="o-cell" aria-hidden>
              {i % 2 ? <><div className="o-deskf" /><div className="o-mon"><div className="o-scr" /></div></> : <><div className="o-win" /><div className="o-plant" /></>}
            </div>
          ))}
        </div>
        {(plan.lounge.length > 0 || plan.more > 0 || folds) && <div className="o-lounge" style={{ ['--cols' as string]: plan.loungeCols }}>
          {plan.lounge.map((c) => (
            <div key={c.id} className="o-cell">
              <Sprite who={c.kind} mood={c.mood} dot={2} night={night} beat={`${c.ring}|${c.mood}|${c.busyElsewhere}`} />
              <div className="o-sofa" />
              <div className={`o-chip ${tone(c).cls}`}><i /><b>{c.name}</b></div>
              <button className="o-hit" onClick={() => setOpen(c.id)} aria-label={said(c)} />
            </div>
          ))}
          {plan.more > 0 && <div className="o-cell"><div className="o-sofa" /><button className="o-more" onClick={() => setAll(true)} aria-label={`Show ${plan.more} more of the crew`}>+{plan.more} more</button></div>}
          {folds && <div className="o-cell"><div className="o-sofa" /><button className="o-more" onClick={() => setAll(false)}>Show fewer</button></div>}
          {Array.from({ length: (plan.loungeCols - ((plan.lounge.length + (plan.more > 0 || folds ? 1 : 0)) % plan.loungeCols)) % plan.loungeCols }, (_, i) =>
            <div key={`sofa${i}`} className="o-cell" aria-hidden><div className="o-sofa" /></div>)}
        </div>}
      </div>
      {open && crew.some((c) => c.id === open) && createPortal(<HelperSheet c={crew.find((c) => c.id === open)!} h={roles.get(open)} state={state}
        asks={asks.get(open) ?? []} onClose={() => setOpen(null)} />, document.body)}
    </section>
  );
}

/** The card over a seat: a name and one line, the typing dots while working, and a Review when it needs her. */
function Bubble({ cls, name, line, typing, children }: { cls: string; name: string; line: string; typing?: boolean; children?: ReactNode }) {
  return <div className={`o-bub ${cls}`} aria-hidden={!children}>
    <b>{name}</b>
    {children ?? <span className="o-st">{typing ? <Typing /> : <i />}<span>{line}</span></span>}
  </div>;
}

const Typing = () => <span className="o-typing" aria-hidden><i /><i /><i /></span>;

/** The monitor: dark when free, lines while working, pink with the question's mark when it needs her. */
function Screen({ c }: { c: A.OfficeMember }) {
  if (A.waitsOnYou(c)) return <div className="o-scr needs">{c.ask?.kind === 'spend' ? '$' : '!'}</div>;
  if (c.ring === 'working') return <div className="o-scr"><i /><i /><i /></div>;
  return <div className="o-scr" />;
}

/** One helper, up close: what they are on, the steps so far, anything waiting on you, and what they have made. */
function HelperSheet({ c, h, state, asks, onClose }: { c: A.OfficeMember; h: A.Helper | undefined; state: Json; asks: A.Card[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogOwn(box, onClose);
  const job = A.work(state).find((w) => w.helper === c.id);
  const t = tone(c);
  let body: ReactNode;
  if (c.busyElsewhere) body = <p className="o-note">{c.name} is busy with another job. It isn't yours, so what it is stays private. Anything you ask for waits its turn.</p>;
  else if (!c.ring && !c.ask) body = <p className="o-note">{c.status === 'Up next' ? `Your job is next in line. ${c.name} starts it as soon as the desk is clear.` : `${c.name} is free to help. Tell Chief what you need, and he'll pass it over.`}</p>;
  return (
    <div className="scrim o-scrim" onClick={onClose}>
      <div ref={box} className="o-sheet" role="dialog" aria-modal aria-label={c.name} onClick={(e) => e.stopPropagation()}>
        <header className="o-sh-head">
          <Face who={h ?? { kind: c.kind, name: c.name, mood: c.mood }} size={52} ring={c.ring} />
          <span className="grow"><h2>{c.name}</h2>{h?.role && <span className="mute small">{h.role}</span>}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <Pill tone={t.pill} live={c.ring === 'working'}>{c.ring === 'working' ? 'Working' : c.status}</Pill>
        {(c.ring || c.ask) && job && <div className="o-sec"><div className="o-eyebrow">{c.ring === 'needs' ? 'Waiting on you' : 'Working on'}</div><h3>{job.title}</h3></div>}
        {!c.busyElsewhere && asks.map((a) => <div key={a.id} className="o-ask big"><div className="o-ask-tag"><i /><span>{a.head}</span></div><p>{a.words}</p><a className="btn go" href={`#/ask/${a.id}`}>Review</a></div>)}
        {c.steps.length > 0 && <Steps steps={c.steps} max={5} />}
        {c.things.length > 0 && <div className="o-sec"><div className="o-eyebrow">{c.ring ? 'First looks' : 'Made for you'}</div>
          {c.things.map((f, i) => <Media key={i} f={f} />)}</div>}
        {body}
        <a className="btn o-chat" href={`#/h/${c.id}`}>Open {c.name}'s chat</a>
      </div>
    </div>
  );
}
