// The office on Home (B1 Studio): Chief and the crew on one floor, side on, each posed at what they are doing. The phone
// draws the same room (mobile/src/office.tsx). A.floorPlan (web/src/adapter.ts) stands five helpers in roster order
// (whoever waits on you first, Chief just after them) and the strip's "+N" counts the rest (the rail names them all).
// Every word and count comes from A.office, the one state source Home's header, tray, rail and Needs you also read; the
// one accent pill sits over the most urgent question that is in Needs you, and the Tray bubble counts what is done.
// Nothing is decided here: a question opens its review sheet, a helper opens their panel (the "Home commits nothing"
// rule). Motion is CSS: each member wears a calm loop for their status (styles.css, paused off screen), a helper hops
// once when their news lands, a done page travels to the tray; Reduce Motion shows the poses and end states only.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
  const [profile, setProfile] = useState(false);

  // The room's loops pause while it is off screen; from a computer's width the wall and floor fill a taller card.
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([en]) => setWide(en.contentRect.width >= 560));
    ro.observe(el);
    const io = new IntersectionObserver(([en]) => el.classList.toggle('off', !en.isIntersecting));
    io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);

  // Whoever finished hands a page to the tray, and the tray's count bumps.
  const seen = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    const now = new Map(live.crew.map((c) => [c.id, c.things.length]));
    const was = seen.current;
    seen.current = now;
    if (!was) return;
    const got = live.crew.filter((c) => c.things.length > (was.get(c.id) ?? c.things.length)).map((c) => c.id);
    if (got.length) handOff(box.current, got);
  }, [live]);
  const trayWas = useRef<number | undefined>(undefined);
  useEffect(() => { trayWas.current = live.counts.done; }, [live.counts.done]);

  const r = night ? ROOM.night : ROOM.day;
  const vars = { '--r-wall': r.wall, '--r-floor': r.floor, '--r-desk': r.desk, '--r-edge': r.edge, '--r-screen': r.screen, '--r-sofa': r.sofa, '--r-window': r.window } as CSSProperties;
  const plan = A.floorPlan(crew);
  const chiefAsk = A.chiefAsks(live).sort((a, b) => A.askRank(a) - A.askRank(b))[0];
  // One floor, left to right in the roster's order (whoever waits on you, then working, then the rest, resting last),
  // Chief standing just after whoever waits on you.
  const waits = plan.seats.filter(A.waitsOnYou).length;
  const order: (A.OfficeMember | 'chief')[] = [...plan.seats.slice(0, waits), 'chief', ...plan.seats.slice(waits)];
  const xs = spots(order.length);
  // One accent pill, over whoever's question matters most (money, then your name, then the rest; Chief's own last).
  const urgent = plan.seats.filter((c) => c.ask).sort((a, b) => A.askRank(a.ask!) - A.askRank(b.ask!))[0];
  const pill = urgent && (!chiefAsk || A.askRank(urgent.ask!) <= A.askRank(chiefAsk))
    ? { at: order.indexOf(urgent), href: `#/ask/${urgent.ask!.id}`, label: `Review what ${urgent.name} needs: ${urgent.ask!.head}` }
    : chiefAsk ? { at: order.indexOf('chief'), href: `#/ask/${chiefAsk.id}`, label: `Review what Chief needs: ${chiefAsk.head}` }
    : plan.seats.find((c) => A.seatOf(c) === 'chat') ? (() => { const c = plan.seats.find((m) => A.seatOf(m) === 'chat')!; return { at: order.indexOf(c), href: `#/h/${c.id}`, label: `Reply to ${c.name} in their chat` }; })()
    : null;
  const more = plan.more.length, moreBusy = plan.more.filter((c) => A.seatOf(c) === 'working').length;
  const id = useId().replace(/:/g, '');
  const Y0 = wide ? -34 : 0, H = 210;

  return (
    <section className="office" aria-label="The office">
      <div ref={box} className={`o-room${wide ? ' wide' : ''}`} style={vars}>
        <svg className="o-art" viewBox={`0 ${Y0} 360 ${H - Y0}`} preserveAspectRatio={wide ? 'xMidYMid meet' : 'none'} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id={`${id}bl`} x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="2" /></filter>
            <radialGradient id={`${id}lamp`} cx=".5" cy="0" r="1"><stop offset="0" stopColor="#FFE7A3" stopOpacity=".9" /><stop offset="1" stopColor="#FFE7A3" stopOpacity="0" /></radialGradient>
            <radialGradient id={`${id}glow`} cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#C9D6FF" stopOpacity=".5" /><stop offset="1" stopColor="#C9D6FF" stopOpacity="0" /></radialGradient>
          </defs>
          <Scene id={id} wide={wide} />
          {order.map((m, i) => m === 'chief'
            ? <Seat key="chief" x={xs[i]} id={id} who="chief" mood={live.chief.mood} seat={chiefAsk ? 'needs' : live.chief.mood === 'work' ? 'working' : 'free'} beat={live.chief.mood}
                label={`Chief: ${live.chief.line}`} onOpen={() => setProfile(true)} />
            : <Seat key={m.id} x={xs[i]} id={id} who={m.kind} mood={m.mood} seat={A.seatOf(m)} second={m.second} dataId={m.id} beat={`${m.ring}|${m.mood}|${m.things.length}|${m.ask?.id ?? ''}`}
                label={said(m) + (m.things.length ? `, made ${m.things.map((f) => KIND_WORDS[f.kind]).join(', ')}` : '')} onOpen={() => setOpen(m.id)} />)}
          <Tray id={id} n={live.counts.done} bump={trayWas.current !== undefined && trayWas.current !== live.counts.done} />
          {pill && <Tag x={Math.min(306, Math.max(46, xs[pill.at]))} y={order[pill.at] === 'chief' ? 100 : 114} text={A.SEAT_WORDS.needs} hot href={pill.href} label={pill.label} />}
        </svg>
        <div className="o-strip" style={{ ['--n' as string]: order.length + (more ? 1 : 0) }}>
          {order.map((m) => {
            const k = m === 'chief' ? (chiefAsk ? 'needs' : live.chief.mood === 'work' ? 'working' : 'here') : stripSeat(m, live);
            const name = m === 'chief' ? 'Chief' : m.name;
            return <button key={m === 'chief' ? 'chief' : m.id} className={`o-cap ${k}`} onClick={() => (m === 'chief' ? setProfile(true) : setOpen(m.id))}
              aria-label={m === 'chief' ? `Chief: ${A.chiefWord(live)}` : said(m)}><b>{name}</b><span><i />{STRIP[k]}</span></button>;
          })}
          {more > 0 && <a className="o-cap o-more" data-more={more} href="#/crew" aria-label={`${more} more of the crew${moreBusy ? `, ${moreBusy} working` : ''}: see everyone`}><b>+{more}</b><span>{moreBusy ? `${moreBusy} working` : 'more'}</span></a>}
        </div>
      </div>
      {profile && createPortal(<ChiefSheet live={live} state={state} roles={roles} onClose={() => setProfile(false)} />, document.body)}
      {open && crew.some((c) => c.id === open) && createPortal(<HelperSheet c={crew.find((c) => c.id === open)!} h={roles.get(open)} state={state}
        asks={asks.get(open) ?? []} onClose={() => setOpen(null)} />, document.body)}
    </section>
  );
}

/** The strip's word for each figure, short enough for a sixth of a phone: waiting on you is one word whatever it is. */
type StripSeat = A.Seat | 'done' | 'here';
const STRIP: Record<StripSeat, string> = { needs: 'needs you', chat: 'needs you', working: 'working', failed: 'stuck', next: 'up next', resting: 'resting', free: 'free', done: 'done', here: 'here' };
const stripSeat = (c: A.OfficeMember, v: A.OfficeView): StripSeat => { const r = A.railWord(c, v); return r.seat; };

/** Where each figure stands on the floor (viewBox x), clear of the tray's corner on the right. */
const G = 196, L = 32, R = 244; // R + 35 (Chief's half width) stays left of the Tray bubble at x 281
const spots = (k: number) => { const span = Math.min(R - L, (k - 1) * 58), x0 = (L + R) / 2 - span / 2; return Array.from({ length: k }, (_, i) => (k === 1 ? (L + R) / 2 : x0 + (i * span) / (k - 1))); };

/** The room itself: wall, floor line, a shelf with a plant, the night window and a clock (B1 Studio). */
function Scene({ id, wide }: { id: string; wide: boolean }) {
  const ink = 'var(--r-edge)';
  return <g aria-hidden className="o-scene">
    <rect x="-400" y={wide ? -400 : 0} width="1160" height={G + (wide ? 400 : 0)} fill="var(--r-wall)" />
    <ellipse cx="180" cy="56" rx="92" ry="64" fill={`url(#${id}glow)`} />
    <rect x="-400" y={G} width="1160" height={wide ? 400 : 20} fill="var(--r-floor)" />
    <path d={`M-400 ${G}H760`} stroke={ink} strokeWidth="1.8" />
    <rect x="136" y="22" width="88" height="64" rx="6" fill="var(--r-window)" stroke={ink} strokeWidth="1.8" />
    <path d="M180 22v64M136 54h88" stroke={ink} strokeWidth="1.6" />
    <path d="M206 34a7 7 0 1 0 6 10a5.5 5.5 0 1 1-6-10z" fill="#FFE7A3" />
    <g className="tw" fill="#fff"><circle cx="150" cy="36" r="1.2" /><circle cx="165" cy="44" r="1" opacity=".7" /><circle cx="196" cy="70" r="1.1" opacity=".8" /><circle cx="148" cy="72" r="1" opacity=".6" /></g>
    <path d="M18 70h70" stroke={ink} strokeWidth="1.8" /><rect x="26" y="52" width="9" height="18" rx="1.5" fill="#DCEBFF" stroke={ink} strokeWidth="1.5" /><rect x="36" y="56" width="8" height="14" rx="1.5" fill="#FFE3DB" stroke={ink} strokeWidth="1.5" />
    <path d="M62 70v-8h14v8" fill="var(--r-desk)" stroke={ink} strokeWidth="1.5" /><path d="M69 62c-6-8-2-14 0-16 2 2 6 8 0 16zM69 62c4-6 10-6 12-5-1 3-6 7-12 5z" fill="#DDF4E6" stroke={ink} strokeWidth="1.4" />
    <circle cx="292" cy="46" r="15" fill="var(--r-desk)" stroke={ink} strokeWidth="1.8" /><path d="M292 37v9l6 4" stroke={ink} strokeWidth="1.6" strokeLinecap="round" fill="none" /><circle cx="292" cy="46" r="1.3" fill={ink} />
  </g>;
}

/** One figure where it stands, with what its seat puts round it: a desk and a page when it needs you, a desk, a lamp and
 *  a playing screen while working, a cushion while resting. The whole group is the button that opens them. */
function Seat({ x, id, who, mood, seat, second, dataId, beat, label, onOpen }: { x: number; id: string; who: art.Kind | 'chief'; mood: art.Mood; seat: A.Seat;
  second?: boolean; dataId?: string; beat: string; label: string; onOpen: () => void }) {
  const ink = 'var(--r-edge)', pose = art.poseOf(mood);
  const lift = seat === 'resting' && who !== 'pip' && who !== 'chief' ? 8 : 0;
  const svg = useMemo(() => who === 'chief'
    ? art.chiefSvg(pose, { vb: '24 30 176 210' }).replace('<svg ', `<svg x="${x - 35}" y="${G - 81}" width="70" height="84" `)
    : art.beanSvg(who, pose, { vb: '0 18 120 132' }).replace('<svg ', `<svg x="${x - 30}" y="${G - 61 - lift}" width="60" height="66" `), [who, pose, x, lift]);
  const fig = useRef<SVGGElement>(null);
  // A hop when their news lands (a new ring, mood or thing): once, never on the first paint, never with Reduce Motion.
  const was = useRef(beat);
  useEffect(() => {
    if (was.current === beat) return;
    was.current = beat;
    if (!reduced()) fig.current?.animate([{ translate: '0 0' }, { translate: '0 -10px', offset: 0.35 }, { translate: '0 0', offset: 0.7 }, { translate: '0 -3px', offset: 0.85 }, { translate: '0 0' }], { duration: 560, easing: 'ease-out' });
  }, [beat]);
  const desk = seat === 'needs' || seat === 'chat' || seat === 'working' || seat === 'failed';
  return <g className="o-cell" data-id={dataId} data-seat={seat} role="button" tabIndex={0} aria-label={label} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
    <rect x={x - 26} y={G - 100} width="52" height="104" fill="transparent" />
    {seat === 'working' && <ellipse cx={x} cy="150" rx="34" ry="14" fill={`url(#${id}lamp)`} opacity=".85" />}
    {desk && <g className="o-desk"><rect x={x - 21} y="150" width="42" height="5" rx="2" fill="var(--r-desk)" stroke={ink} strokeWidth="1.8" /><path d={`M${x - 16} 155V${G}M${x + 16} 155V${G}`} stroke={ink} strokeWidth="1.8" /></g>}
    {(seat === 'needs' || seat === 'chat') && <g><rect x={x - 11} y="131" width="22" height="18" rx="2" fill="var(--r-desk)" stroke={ink} strokeWidth="1.6" /><path d={`M${x - 7} 138h14M${x - 7} 143h9`} stroke={ink} strokeWidth="1.3" /></g>}
    {(seat === 'working' || seat === 'failed') && <g className="o-mon"><rect x={x - 16} y="120" width="32" height="22" rx="3" fill={seat === 'failed' ? '#FFE9E3' : 'var(--r-screen)'} stroke={ink} strokeWidth="1.7" />
      {seat === 'failed' ? <text x={x} y="136" textAnchor="middle" fontFamily="Inter" fontWeight="800" fontSize="13" fill="#F0482A">!</text> : <path d={`M${x - 3} 126l7 5-7 5z`} fill={ink} />}
      <path d={`M${x} 142v8`} stroke={ink} strokeWidth="1.7" /></g>}
    {lift > 0 && <ellipse cx={x} cy={G - 5} rx="22" ry="7" fill="var(--r-sofa)" stroke={ink} strokeWidth="1.6" />}
    <ellipse cx={x} cy={G + 2} rx="18" ry="3.2" fill={ink} opacity=".1" filter={`url(#${id}bl)`} />
    <g ref={fig} className={`o-sprite ink ${who} pose-${pose}${second ? ' second' : ''}`} dangerouslySetInnerHTML={{ __html: svg }} />
  </g>;
}

/** The tray in the room's corner, and its one speech bubble with today's count; the bubble leads to your things. */
function Tray({ id, n, bump }: { id: string; n: number; bump: boolean }) {
  const ink = 'var(--r-edge)';
  return <g>
    <g aria-hidden><path d={`M300 ${G}l3 -14h30l3 14z`} fill="var(--r-desk)" stroke={ink} strokeWidth="1.6" strokeLinejoin="round" /><path d={`M305 ${G - 9}h26`} stroke={ink} strokeWidth="1.3" />
      {n > 0 && <g><path d={`M306 ${G - 22}l12-2 2 12-12 2z`} fill="#fff" stroke={ink} strokeWidth="1.4" strokeLinejoin="round" /><path d={`M309 ${G - 17}l7-1`} stroke={ink} strokeWidth=".9" /></g>}</g>
    <Tag key={n} x={318} y={G - 58} text={`Tray · ${n}`} tail cls={`o-tray${bump ? ' bump' : ''}`} href="#/things" label={`Your tray: ${n} done today`} />
  </g>;
}

/** A label in the room: the accent pill for what needs you, or a white speech bubble with a tail. */
function Tag({ x, y, text, hot, tail, cls = '', href, label }: { x: number; y: number; text: string; hot?: boolean; tail?: boolean; cls?: string; href: string; label: string }) {
  const w = text.length * 6.6 + 22, ink = 'var(--r-edge)';
  const left = Math.min(x - w / 2, 356 - w);
  return <a className={`o-tag ${hot ? 'o-pill' : ''} ${cls}`} href={href} aria-label={label}>
    {tail && <path d={`M${x - 4} ${y + 10}l2 8 7-8`} fill="var(--solid)" stroke={ink} strokeWidth="1.3" strokeLinejoin="round" />}
    <rect x={left} y={y - 11} width={w} height="22" rx="11" fill={hot ? '#F0482A' : 'var(--solid)'} stroke={hot ? 'none' : ink} strokeWidth="1.3" />
    {tail && <path d={`M${x - 3} ${y + 9.4}h9`} stroke="var(--solid)" strokeWidth="2" />}
    <text x={left + w / 2} y={y + 4} textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="11" fill={hot ? '#fff' : 'var(--ink)'}>{text}</text>
  </a>;
}

/** Done hand-off: a page travels from the helper's desk to the tray, then the tray's count bumps. Reduce Motion skips
 *  the journey and lands on the end state, which the refresh already shows. */
function handOff(room: HTMLElement | null, ids: string[]) {
  const tray = room?.querySelector('.o-tray rect');
  if (!room || !tray || reduced()) return;
  const to = tray.getBoundingClientRect(), base = room.getBoundingClientRect();
  for (const id of new Set(ids)) {
    const from = room.querySelector(`.o-cell[data-id="${CSS.escape(id)}"] .o-sprite`)?.getBoundingClientRect();
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
