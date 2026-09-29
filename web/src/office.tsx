// The office at the top of Home: Chief and the crew in one room, each at their desk, with what they are making for
// you on it. On a computer it is the Diorama (web/src/diorama.ts, real 3D, loaded after Home paints); without 3D, or
// with Reduce Motion on, it is a still row of the same mascots. Every word comes from A.office (web/src/adapter.ts):
// a member's room holds only their own jobs, and a helper busy with someone else's shows just "Busy with another job".
// Nothing is decided here: a question opens its review sheet, a thing opens its preview (the "Home commits nothing" rule).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Json } from './api.ts';
import * as A from './adapter.ts';
import { PALS, type Kind } from './art.ts';
import type { Anchors, Diorama, Room } from './diorama.ts';
import { Face, Media, Pill, Steps, useDialogOwn } from './parts.tsx';

// Live events reach the room straight from the socket the shell already holds (main.tsx): a step swaps the bubble
// and a new thing drops onto the desk before the debounced refresh lands, and the refresh stays the source of truth.
const ears = new Set<(e: Json) => void>();
export const hear = (e: Json) => ears.forEach((f) => f(e));

const go = (hash: string) => { location.hash = hash; };
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function useReducedMotion() {
  const [on, setOn] = useState(reduced);
  useEffect(() => {
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const f = () => setOn(q.matches);
    q.addEventListener('change', f);
    return () => q.removeEventListener('change', f);
  }, []);
  return on;
}

type Tone = { cls: string; pill: 'ok' | 'wait' | 'off' };
function tone(c: A.OfficeMember): Tone {
  if (c.ring === 'needs' || c.ask) return { cls: 's-needs', pill: 'wait' };
  if (c.ring === 'working') return { cls: 's-work', pill: 'ok' };
  if (c.busyElsewhere) return { cls: 's-away', pill: 'off' };
  if (c.status === 'Up next') return { cls: 's-next', pill: 'off' };
  return { cls: 's-free', pill: 'off' };
}
const KIND_WORDS: Record<A.FileView['kind'], string> = { image: 'A picture', video: 'A video', sheet: 'A spreadsheet', page: 'A document', doc: 'A file' };

/** A thing on a desk, small: its kind as a tile, its name beside it. */
function ThingIcon({ f, kind }: { f: A.FileView; kind: Kind }) {
  if (f.kind === 'image' || f.kind === 'video') {
    return <span className="o-ic sw" aria-hidden style={{ background: `linear-gradient(135deg, ${PALS[kind].body}, #ff7aa2)` }}>{f.kind === 'video' ? '▶' : ''}</span>;
  }
  return <span className={`o-ic ${f.kind === 'sheet' ? 'sheet' : ''}`} aria-hidden>{f.kind === 'sheet' ? '▦' : '▤'}</span>;
}

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
  // Every question a helper has open, the one that matters most first: money, then anything sent in her name.
  const asks = useMemo(() => {
    const rank = (c: A.Card) => (c.kind === 'spend' ? 0 : c.kind === 'ok' ? 1 : 2);
    const by = new Map<string, A.Card[]>();
    for (const c of A.cards(state)) by.set(c.helper, [...(by.get(c.helper) ?? []), c]);
    for (const l of by.values()) l.sort((a, b) => rank(a) - rank(b));
    return by;
  }, [state]);
  const crew = live.crew.map((c) => (c.ask && asks.get(c.id)?.[0] ? { ...c, ask: asks.get(c.id)![0] } : c));
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const room: Room = { chief: { mood: live.chief.mood }, crew, doneToday: live.done.filter((t) => t.at >= day.getTime()).length };
  // The scene redraws only when something it draws has changed; words live in the cards above it, which React keeps.
  const roomKey = JSON.stringify([room.chief, room.doneToday, crew.map((c) => [c.id, c.kind, c.mood, c.ring, c.busyElsewhere, c.ask?.kind, c.things.map((f) => f.kind)])]);
  const roomNow = useRef(room);
  roomNow.current = room;

  // What the stage is: waiting for the 3D chunk, the 3D room, or the still row.
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<'wait' | '3d' | 'still'>(() => (reduced() ? 'still' : 'wait'));
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<Diorama | null>(null);
  const anchors = useRef<Anchors>(new Map()).current;
  const [open, setOpen] = useState<string | null>(null);
  const pick = useRef((id: string) => {});
  pick.current = (id: string) => (id === 'chief' ? go('#/chief') : id === 'done' ? go('#/things') : setOpen(id));
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([en]) => setPhone(en.contentRect.width < 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (reduce) { setMode('still'); return; }
    let gone = false, d: Diorama | null = null;
    setMode('wait');
    import('./diorama.ts').then((m) => {
      if (gone || !stage.current) return;
      d = m.diorama(stage.current, anchors, (id) => pick.current(id), () => { if (!gone) { d?.dispose(); scene.current = null; setMode('still'); } });
      scene.current = d;
      setMode(d ? '3d' : 'still');
    }).catch(() => { if (!gone) setMode('still'); });
    return () => { gone = true; d?.dispose(); scene.current = null; };
  }, [reduce, anchors]);

  // Draw only when what the room shows has changed: the 15 s refresh with nothing new costs no frame at all.
  useEffect(() => { if (mode === '3d') scene.current?.show(roomNow.current, { night, phone }); }, [mode, roomKey, night, phone]);

  // A tapped helper: the camera glides to them, kept clear of the panel that opens beside (or below) the room.
  useEffect(() => {
    const el = stage.current;
    if (mode !== '3d' || !el) return;
    const r = el.getBoundingClientRect();
    scene.current?.focus(open, phone ? { right: 0, bottom: Math.max(0, r.bottom - innerHeight * 0.42) } : { right: Math.max(0, r.right - (innerWidth - 480)), bottom: 0 });
  }, [open, mode, phone]);

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

  const bind = (key: string) => (el: HTMLElement | null) => { if (el) anchors.set(key, el); else anchors.delete(key); };
  const mine = live.crew.some((c) => c.ring || c.ask);
  const chips = (c: A.OfficeMember) => c.things.length > 0 && (
    <div className="o-wips">{c.things.map((f, i) => (
      <button key={i} className={`o-wip${fresh.has(`${c.id}:${i}`) ? ' drop' : ''}`}
        onClick={() => setOpen(c.id)} aria-label={`${f.name}, ${KIND_WORDS[f.kind].toLowerCase()} from ${c.name}`} title={f.name}>
        <ThingIcon f={f} kind={c.kind} />
        {fresh.has(`${c.id}:${i}`) && <span className="o-new">New</span>}
      </button>))}
    </div>);
  const tag = (c: A.OfficeMember, withStep: boolean) => (
    <button className={`o-tag ${tone(c).cls}`} onClick={() => setOpen(c.id)} aria-label={`${c.name}: ${c.status}`}>
      <b>{c.name}</b><span className="o-st"><i /><span>{c.status}</span></span>
      {withStep && c.ring === 'working' && c.step && <span className="o-line"><Typing /><span className="o-bt">{c.step}</span></span>}
    </button>);
  const review = (c: A.OfficeMember) => c.ask && <a className="btn sm o-review" href={`#/ask/${c.ask.id}`} aria-label={`Review what ${c.name} needs`}>Review</a>;
  const chiefTag = <button className={`o-tag ${live.chief.mood === 'ask' ? 's-needs' : live.chief.mood === 'work' ? 's-work' : 's-free'}`} onClick={() => go('#/chief')} aria-label="Chief: open his chat">
    <b>Chief</b><span className="o-st"><i /><span>Runs the crew</span></span></button>;

  return (
    <section className={`office${phone ? ' o-phone' : ''}`} aria-label="The office">
      <div ref={stage} className={`o-stage ${mode}`}>
        {mode === '3d' && <div className={`o-ov${open ? ' focus' : ''}`}>
          <div className="anc on" ref={bind('chief:feet')}>{!phone && chiefTag}</div>
          <div className="anc on" ref={bind('chief:head')}>{phone && <div className="o-stack">{chiefTag}</div>}</div>
          {crew.map((c) => { const on = `anc${open === c.id ? ' on' : ''}`; return <div key={c.id} className="o-who">
            <div className={on} ref={bind(`${c.id}:head`)}>
              <div className="o-stack">
                {phone ? tag(c, true)
                  : c.ask ? <div className="o-ask" title={c.ask.words}><div className="o-ask-tag"><i /><span>{c.ask.head}</span></div>{review(c)}</div>
                  : c.ring === 'working' && c.step ? <div className="o-bubble"><Typing /><span className="o-bt" key={c.step}>{c.step}</span></div> : null}
              </div>
            </div>
            <div className={on} ref={bind(`${c.id}:desk`)}><div className="o-desk">{chips(c)}{phone && review(c)}</div></div>
            <div className={on} ref={bind(`${c.id}:feet`)}>{!phone && tag(c, false)}</div>
          </div>; })}
          {!mine && <div className="o-empty">{live.crew.some((c) => c.busyElsewhere) ? 'Nothing of yours on the go right now.' : 'Nothing of yours on the go. The crew is free.'}</div>}
          {!phone && <div className="o-hint" aria-hidden>Drag to look around · tap anyone to visit</div>}
        </div>}
        {mode === 'still' && <Still live={{ ...live, crew }} open={setOpen} />}
      </div>
      {open && crew.some((c) => c.id === open) && createPortal(<HelperSheet c={crew.find((c) => c.id === open)!} h={roles.get(open)} state={state}
        asks={asks.get(open) ?? []} onClose={() => setOpen(null)} />, document.body)}
    </section>
  );
}

const Typing = () => <span className="o-typing" aria-hidden><i /><i /><i /></span>;

/** Without 3D, or with Reduce Motion on: the same cast, standing still in a row, each with its one line. */
function Still({ live, open }: { live: A.OfficeView; open: (id: string) => void }) {
  return (
    <div className="o-still">
      <button className="o-still-who" onClick={() => go('#/chief')}><Face who="chief" size={64} /><b>Chief</b><span>{live.chief.line}</span></button>
      {live.crew.map((c) => (
        <button key={c.id} className={`o-still-who ${tone(c).cls}`} onClick={() => open(c.id)} aria-label={`${c.name}: ${c.status}`}>
          <Face who={{ kind: c.kind, name: c.name, mood: c.mood }} size={64} ring={c.ring} />
          <b>{c.name}</b><span className="o-st"><i /><span>{c.status}</span></span>
          {c.ask && <span className="o-still-ask">{c.ask.head}</span>}
          {c.things.length > 0 && <span className="o-count">{c.things.length === 1 ? 'One thing on the desk' : `${c.things.length} things on the desk`}</span>}
        </button>
      ))}
    </div>
  );
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
