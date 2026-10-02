// The office at the top of Home: Chief and the crew in one room, drawn front on like a cut-open dollhouse. The phone
// draws the same room (mobile/src/office.tsx). A.floorPlan (web/src/adapter.ts) hot-desks it: the room never grows,
// four desks go to whoever waits on you and then whoever is working, a three-seat lounge takes the rest, and "+N"
// counts everyone else (the rail's crew list names them all). Every word and count comes from A.office, the one
// state source Home's header, tray, rail and Needs you also read; Review shows only for a row that is in Needs you.
// Nothing is decided here: a question opens its review sheet, a helper opens their panel (the "Home commits nothing"
// rule). Motion is CSS: each member wears a calm loop for their status (styles.css, paused off screen), a helper hops
// once when their news lands, a done page travels to the tray; Reduce Motion shows the poses and end states only.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, type Json } from './api.ts';
import * as A from './adapter.ts';
import * as art from './art.ts';
import { room as ROOM } from './tokens.ts';
import { attempt, Face, Media, Pill, Steps, useDialogOwn } from './parts.tsx';

// Live events reach the room straight from the socket the shell already holds (main.tsx): a step swaps the bubble
// and a new thing lands by the desk before the debounced refresh lands, and the refresh stays the source of truth.
const ears = new Set<(e: Json) => void>();
export const hear = (e: Json) => ears.forEach((f) => f(e));

const go = (hash: string) => { location.hash = hash; };
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Tone = { cls: string; pill: 'ok' | 'wait' | 'off' };
const TONES: Record<A.Seat, Tone> = { needs: { cls: 'needs', pill: 'wait' }, chat: { cls: 'needs', pill: 'wait' }, working: { cls: 'work', pill: 'ok' },
  failed: { cls: 'failed', pill: 'wait' }, next: { cls: 'next', pill: 'off' }, resting: { cls: 'free', pill: 'off' }, free: { cls: 'free', pill: 'off' } };
const tone = (c: A.OfficeMember) => TONES[A.seatOf(c)];
const said = (c: A.OfficeMember) => {
  const k = A.seatOf(c);
  return k === 'needs' ? `${c.name} needs you: ${c.ask!.head}` : k === 'working' ? `${c.name}, working on ${c.status}` : k === 'free' || k === 'resting' ? `${c.name}, ${c.status.toLowerCase()}` : `${c.name}, ${A.SEAT_WORDS[k].toLowerCase()}`;
};

/** A mascot whole, in B1 line ink (art.ts), `dot` scaling the old sprite footprint. Its pose class drives the calm
 *  per-status loop in styles.css (work, needs, rest), which Reduce Motion stops at the pose itself. */
function Sprite({ who, mood, dot, className = '', beat }: { who: art.Kind | 'chief'; mood: art.Mood; dot: number; night?: boolean; className?: string; beat?: string }) {
  const pose = art.poseOf(mood);
  const svg = useMemo(() => who === 'chief' ? art.chiefSvg(pose) : art.beanSvg(who, pose), [who, pose]);
  const [w, h] = who === 'chief' ? [20 * dot, 25 * dot] : [16 * dot, 20 * dot];
  const img = useRef<HTMLSpanElement>(null);
  // A hop when their news lands (a new ring, mood or thing): once, never on the first paint, never with Reduce Motion.
  const was = useRef(beat);
  useEffect(() => {
    if (was.current === beat) return;
    was.current = beat;
    if (!reduced()) img.current?.animate([{ translate: '0 0' }, { translate: '0 -10px', offset: 0.35 }, { translate: '0 0', offset: 0.7 }, { translate: '0 -3px', offset: 0.85 }, { translate: '0 0' }], { duration: 560, easing: 'ease-out' });
  }, [beat]);
  return <span ref={img} className={`o-sprite ink ${who} pose-${pose} ${className}`} style={{ width: w, height: h }} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}

const KIND_WORDS: Record<A.FileView['kind'], string> = { image: 'a picture', video: 'a video', sheet: 'a spreadsheet', page: 'a document', doc: 'a file' };

/** The live office: the snapshot's view, moved by live events until the next refresh. Home reads it once and hands
 *  it to the room and the feed, so they can never disagree. */
export function useOffice(state: Json, offline = false): A.OfficeView | null {
  const view = useMemo(() => (state ? A.office(state) : null), [state]);
  const [live, setLive] = useState(view);
  useEffect(() => setLive(view), [view]);
  useEffect(() => {
    const f = (e: Json) => setLive((v) => v && A.officeEvent(v, e));
    ears.add(f);
    return () => { ears.delete(f); };
  }, []);
  // What was last heard says how things were: while the home computer is out of reach nobody claims to be busy.
  return live && offline ? A.officeAway(live, 'The home computer is asleep') : live;
}

export function Office({ state, live, night }: { state: Json; live: A.OfficeView; night: boolean }) {
  const roles = useMemo(() => new Map(A.crew(state).map((h) => [h.id, h])), [state]);
  // Every question a helper has open, the one that matters most first (A.askRank), for their panel.
  const asks = useMemo(() => {
    const by = new Map<string, A.Card[]>();
    for (const c of live.needs) by.set(c.helper, [...(by.get(c.helper) ?? []), c]);
    for (const l of by.values()) l.sort((a, b) => A.askRank(a) - A.askRank(b));
    return by;
  }, [live]);
  const crew = live.crew;
  const [open, setOpen] = useState<string | null>(null);

  // Three seats across on a phone, the whole row of five from a computer's room card.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([en]) => setWidth(Math.round(en.contentRect.width)));
    ro.observe(el);
    // The room's loops pause while it is off screen.
    const io = new IntersectionObserver(([en]) => el.classList.toggle('off', !en.isIntersecting));
    io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);
  const cols = (width || 360) >= 500 ? 5 : 3;
  const plan = A.floorPlan(crew);
  const nooks = Math.max(A.NOOKS, plan.desks.length);
  const spare = (cols - ((nooks + 1) % cols)) % cols;

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
    handOff(box.current, [...got].map((k) => k.split(':')[0]));
    // Its own timer, kept past the next change: a step arriving a second later must not leave "New" up for good.
    timers.current.push(window.setTimeout(() => setFresh((f) => new Set([...f].filter((k) => !got.has(k)))), 6000));
  }, [live]);

  const r = night ? ROOM.night : ROOM.day;
  const vars = { '--r-wall': r.wall, '--r-stripe': r.stripe, '--r-skirt': r.skirt, '--r-floor': r.floor, '--r-seam': r.seam, '--r-desk': r.desk, '--r-top': r.top, '--r-edge': r.edge,
    '--r-bezel': r.bezel, '--r-screen': r.screen, '--r-sofa': r.sofa, '--r-sofa-dark': r.sofaDark, '--r-window': r.window, '--r-frame': r.frame, '--r-leaf': r.leaf, '--r-pot': r.pot } as CSSProperties;
  const chiefAsk = A.chiefAsks(live).sort((a, b) => A.askRank(a) - A.askRank(b))[0];
  const chiefBusy = chiefAsk ? 'needs' : live.chief.mood === 'work' ? 'work' : '';
  const [profile, setProfile] = useState(false);
  const trayWas = useRef<number | undefined>(undefined);
  useEffect(() => { trayWas.current = live.counts.done; }, [live.counts.done]);
  const more = plan.more.length, moreBusy = plan.more.filter((c) => A.seatOf(c) === 'working').length;

  return (
    <section className="office" aria-label="The office">
      <div ref={box} className="o-room" style={vars}>
        <div className="o-head">
          <a key={live.counts.done} className={`o-tray${trayWas.current !== undefined && trayWas.current !== live.counts.done ? ' bump' : ''}`} href="#/things" aria-label={`Your tray: ${live.counts.done} done today`}>Your tray · {live.counts.done}</a>
        </div>
        <Wall wide={cols === 5} />
        <div className="o-desks" style={{ ['--cols' as string]: cols }}>
          <div className="o-cell chief">
            <div className="o-chair" />
            <Sprite who="chief" mood={live.chief.mood} dot={3} night={night} beat={live.chief.mood} />
            <div className="o-seat" />
            {chiefAsk
              ? <Bubble cls="needs" name="Chief"><Cue href={`#/ask/${chiefAsk.id}`} label={`Review what Chief needs: ${chiefAsk.head}`} /></Bubble>
              : <Bubble cls={chiefBusy} name="Chief" line={A.chiefWord(live)} />}
            <button className="o-hit" onClick={() => setProfile(true)} aria-label={`Chief: ${live.chief.line}`} />
          </div>
          {Array.from({ length: nooks }, (_, i) => plan.desks[i]).map((c, i) => c ? (
            <div key={c.id} className="o-cell" data-seat={A.seatOf(c)} data-id={c.id}>
              <Sprite who={c.kind} mood={c.mood} dot={3} night={night} className={`at-desk${c.second ? ' second' : ''}`} beat={`${c.ring}|${c.mood}|${c.things.length}|${c.ask?.id ?? ''}`} />
              <div className="o-deskf" />
              <div className="o-mon"><Screen c={c} /></div>
              {c.things.length > 0 && <div className="o-things" aria-hidden>{c.things.slice(-2).map((f, j) => {
                const i = c.things.length - Math.min(2, c.things.length) + j, k = `${c.id}:${i}`;
                return <span key={k} className={`o-thing ${f.kind === 'image' || f.kind === 'video' ? 'o-pin' : 'o-paper'}${fresh.has(k) ? ' drop' : ''}`}
                  style={{ ['--c' as string]: art.PALS[c.kind].body }} title={f.name}>{fresh.has(k) && <span className="o-new">New</span>}</span>;
              })}</div>}
              <button className="o-hit" onClick={() => setOpen(c.id)} aria-label={said(c) + (c.things.length ? `, made ${c.things.map((f) => KIND_WORDS[f.kind]).join(', ')}` : '')} />
              {c.ask
                ? <Bubble cls="needs" name={c.name}><Cue href={`#/ask/${c.ask.id}`} label={`Review what ${c.name} needs: ${c.ask.head}`} /></Bubble>
                : A.seatOf(c) === 'chat'
                  ? <Bubble cls="needs" name={c.name}><Cue href={`#/h/${c.id}`} label={`Reply to ${c.name} in their chat`} word="Reply" /></Bubble>
                  : <Bubble cls={tone(c).cls} name={c.name} line={A.SEAT_WORDS.working} typing />}
            </div>
          ) : (
            <div key={`nook${i}`} className="o-cell" aria-hidden><div className="o-deskf" /><div className="o-mon"><div className="o-scr" /></div></div>
          ))}
          {Array.from({ length: spare }, (_, i) => <div key={`spare${i}`} className="o-cell" aria-hidden><div className="o-win" /><div className="o-plant" /></div>)}
        </div>
        {/* The lounge only when someone sits there or "+N" counts more: an empty sofa row means nothing to her. */}
        {(plan.lounge.length > 0 || more > 0) && <div className="o-lounge" style={{ ['--cols' as string]: A.LOUNGE_SEATS + 1 }}>
          {Array.from({ length: A.LOUNGE_SEATS }, (_, i) => plan.lounge[i]).map((c, i) => c ? (
            <div key={c.id} className="o-cell" data-seat={A.seatOf(c)}>
              <Sprite who={c.kind} mood={c.mood} dot={2} night={night} className={c.second ? 'second' : ''} beat={`${c.ring}|${c.mood}`} />
              <div className="o-sofa" />
              <div className={`o-chip ${tone(c).cls}`}><i /><b>{c.name}</b></div>
              <button className="o-hit" onClick={() => setOpen(c.id)} aria-label={said(c)} />
            </div>
          ) : <div key={`sofa${i}`} className="o-cell" aria-hidden><div className="o-sofa" /></div>)}
          <div className="o-cell"><div className="o-sofa" />{more > 0 && <a className="o-more" data-more={more} href="#/crew" aria-label={`${more} more of the crew${moreBusy ? `, ${moreBusy} working` : ''}: see everyone`}>+{more}{moreBusy > 0 && <small>{moreBusy} working</small>}</a>}</div>
        </div>}
      </div>
      {profile && createPortal(<ChiefSheet live={live} state={state} roles={roles} onClose={() => setProfile(false)} />, document.body)}
      {open && crew.some((c) => c.id === open) && createPortal(<HelperSheet c={crew.find((c) => c.id === open)!} h={roles.get(open)} state={state}
        asks={asks.get(open) ?? []} onClose={() => setOpen(null)} />, document.body)}
    </section>
  );
}

/** The wall above the desks, in the room's ink: a shelf, the clock and the night window. The clock sits left of the
 *  window, clear of the tray pill in the right corner at every width (Main596). */
function Wall({ wide }: { wide: boolean }) {
  const w = wide ? 700 : 360, c = w / 2;
  return <div className="o-wall" aria-hidden><svg viewBox={`0 0 ${w} 64`} preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d={`M${c - 150} 50h70`} /><rect x={c - 140} y="34" width="9" height="16" rx="1.5" fill="#DCEBFF" /><rect x={c - 128} y="38" width="8" height="12" rx="1.5" fill="#FFE3DB" />
    <path d={`M${c - 104} 50v-8h12v8M${c - 98} 42c-6 -6 -4 -12 0 -14c4 2 6 8 0 14`} />
    <rect x={c - 34} y="8" width="68" height="48" rx="4" fill="var(--r-window)" /><path d={`M${c} 8v48M${c - 34} 32h68`} />
    <circle cx={c + 20} cy="20" r="4" fill="#FFF3C8" stroke="none" />
    <circle cx={c - 57} cy="30" r="12" fill="var(--solid)" /><path d={`M${c - 57} 23v7l5 3`} />
  </svg></div>;
}

/** Done hand-off: a page travels from the helper's desk to the tray, then the tray's count bumps. Reduce Motion skips
 *  the journey and lands on the end state, which the refresh already shows. */
function handOff(room: HTMLElement | null, ids: string[]) {
  const tray = room?.querySelector('.o-tray');
  if (!room || !tray || reduced()) return;
  const to = tray.getBoundingClientRect(), base = room.getBoundingClientRect();
  for (const id of new Set(ids)) {
    const from = room.querySelector(`.o-cell[data-id="${CSS.escape(id)}"] .o-mon`)?.getBoundingClientRect();
    if (!from) continue;
    const page = document.createElement('i');
    page.className = 'o-flyer';
    page.style.left = `${from.left - base.left}px`; page.style.top = `${from.top - base.top}px`;
    room.appendChild(page);
    page.animate([{ transform: 'none' }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(.7) rotate(8deg)`, opacity: .2 }], { duration: 1300, easing: 'ease-in-out' }).finished.finally(() => page.remove());
  }
}

/** Chief up close: how to reach him, the crew's computers (watching first), and what the crew made today. */
function ChiefSheet({ live, state, roles, onClose }: { live: A.OfficeView; state: Json; roles: Map<string, A.Helper>; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogOwn(box, onClose);
  const [phones, setPhones] = useState<number | null>(null);
  useEffect(() => { api.phones().then((p) => setPhones(p.length)).catch(() => setPhones(null)); }, []);
  const computers = live.crew.filter((c) => roles.get(c.id)?.computer);
  const made = A.things(state).slice(0, 4);
  const word = A.chiefWord(live);
  return (
    <div className="scrim o-scrim" onClick={onClose}>
      <div ref={box} className="o-sheet o-profile" role="dialog" aria-modal aria-label="Chief" onClick={(e) => e.stopPropagation()}>
        <header className="o-sh-head">
          <Face who="chief" size={64} />
          <span className="grow"><h2>Chief</h2><span className="mute small">Runs your crew</span>
            <span className={`o-state ${word === 'Needs you' ? 'needs' : word === 'Working' ? 'work' : ''}`}><i />{word}</span></span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="o-sec"><div className="o-eyebrow">Ways to reach</div>
          <div className="card list">
            <a className="row-item" href="#/chief" onClick={onClose}><span className="grow">Message in Chat</span><b>›</b></a>
            <a className="row-item" href="#/settings" onClick={onClose}><span className="grow">On your phone<small className="mute block">{phones ? `${phones} paired` : 'Not set up'}</small></span>{!phones && <b className="o-setup">Set up</b>}</a>
          </div></div>
        {computers.length > 0 && <div className="o-sec"><div className="o-eyebrow">Crew computers</div>
          <div className="card list">{computers.map((c) => {
            const k = A.seatOf(c);
            return <a key={c.id} className="row-item" href={`#/h/${c.id}/screen`} onClick={onClose}>
              <Face who={{ kind: c.kind, name: c.name, mood: c.mood }} size={36} />
              <span className="grow">{c.name}'s computer<small className="mute block">{roles.get(c.id)?.driving ? 'You have the wheel' : `Watch ${c.name}`}</small></span>
              <Pill tone={k === 'needs' || k === 'chat' ? 'wait' : k === 'working' ? 'ok' : 'off'}>{A.waitsOnYou(c) ? 'Needs you' : k === 'working' ? 'Working' : 'Resting'}</Pill></a>;
          })}</div></div>}
        {made.length > 0 && <div className="o-sec"><div className="o-eyebrow">Outputs</div>
          <div className="o-made">{made.map((m) => <a key={m.id} className="card" href={`#/h/${m.helper}`} onClick={onClose}><b>{m.title}</b><small className="mute">From {roles.get(m.helper)?.name ?? 'the crew'}</small></a>)}</div></div>}
      </div>
    </div>
  );
}

/** The card over a seat, just above whoever sits there: a name and one short word that always fits (the step itself is
 *  in the feed's On it now), the typing dots while working, or a quiet cue when it waits on you. */
function Bubble({ cls, name, line, typing, children }: { cls: string; name: string; line?: string; typing?: boolean; children?: ReactNode }) {
  return <div className={`o-bub ${cls}`} aria-hidden={!children}>
    <b>{name}</b>
    {children ?? <span className="o-st">{typing ? <Typing /> : <i />}<span>{line}</span></span>}
  </div>;
}

/** Waiting on you, said quietly: a pink dot and the seat's word, a link to the question (Needs you above holds the
 *  same row), never a filled button per seat. */
const Cue = ({ href, label, word = A.SEAT_WORDS.needs }: { href: string; label: string; word?: string }) =>
  <a className="o-st o-cue" href={href} aria-label={label}><i /><span>{word}</span></a>;

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
  if (!c.ring && !c.ask) body = <p className="o-note">{c.status === 'Up next' ? `Your job is next in line. ${c.name} starts it as soon as the desk is clear.` : `${c.name} is free to help. Tell Chief what you need, and he'll pass it over.`}</p>;
  return (
    <div className="scrim o-scrim" onClick={onClose}>
      <div ref={box} className="o-sheet" role="dialog" aria-modal aria-label={c.name} onClick={(e) => e.stopPropagation()}>
        <header className="o-sh-head">
          <Face who={h ?? { kind: c.kind, name: c.name, mood: c.mood }} size={52} ring={c.ring} />
          <span className="grow"><h2>{c.name}</h2>{h?.role && <span className="mute small">{h.role}</span>}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <Pill tone={t.pill} live={A.seatOf(c) === 'working'}>{A.seatOf(c) === 'working' ? 'Working' : A.waitsOnYou(c) ? A.SEAT_WORDS[A.seatOf(c)] : c.status}</Pill>
        {(c.ring || c.ask) && job && <div className="o-sec"><div className="o-eyebrow">{A.waitsOnYou(c) ? 'Waiting on you' : 'Working on'}</div><h3>{job.title}</h3></div>}
        {asks.map((a) => <div key={a.id} className="o-ask big"><div className="o-ask-tag"><i /><span>{a.head}</span></div><p>{a.words}</p><a className="btn go" href={`#/ask/${a.id}`}>Review</a></div>)}
        {c.steps.length > 0 && <Steps steps={c.steps} max={5} />}
        {c.things.length > 0 && <div className="o-sec"><div className="o-eyebrow">{c.ring ? 'First looks' : 'Made for you'}</div>
          {c.things.map((f, i) => <Media key={i} f={f} />)}</div>}
        {body}
        <a className="btn o-chat" href={`#/h/${c.id}`}>Open {c.name}'s chat</a>
        {h?.computer && <div className="o-sec"><div className="o-eyebrow">{c.name}'s computer</div>
          <div className="chips"><a className="btn" href={`#/h/${c.id}/screen`}>Watch {c.name}</a>
            <button className="btn" onClick={() => attempt(async () => { await api.takeOver(c.id); go(`#/h/${c.id}/screen`); })}>Take the wheel</button></div></div>}
      </div>
    </div>
  );
}
