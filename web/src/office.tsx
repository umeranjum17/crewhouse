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
import { attempt, Face, Icon, Media, Pill, Steps, useDialogOwn } from './parts.tsx';

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
  // Where each helper stands now, in the room's current layout: the done page's start (below).
  const desks = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([en]) => { setWide(en.contentRect.width >= 560); desks.current = spritesIn(el); });
    ro.observe(el);
    const io = new IntersectionObserver(([en]) => el.classList.toggle('off', !en.isIntersecting));
    io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);

  // Whoever finished hands a page to the tray box, and the tray's count bumps. The page leaves from where their desk was
  // before the room re-laid them as done: measured after every change, every resize and the switch to the wide room
  // (whose first layout is measured before it is ever painted, so it must be measured again).
  const seen = useRef<A.OfficeView | null>(null);
  useEffect(() => {
    const was = seen.current, from = desks.current;
    seen.current = live;
    desks.current = spritesIn(box.current);
    if (!was) return;
    const got = A.handedIn(was, live);
    if (got.length) handOff(box.current, got, from);
  }, [live]);
  useEffect(() => { desks.current = spritesIn(box.current); }, [wide]);
  const trayWas = useRef<number | undefined>(undefined);
  useEffect(() => { trayWas.current = live.counts.done; }, [live.counts.done]);

  const r = night ? ROOM.night : ROOM.day;
  const vars = { '--r-wall': r.wall, '--r-floor': r.floor, '--r-desk': r.desk, '--r-edge': r.edge, '--r-screen': r.screen, '--r-sofa': r.sofa, '--r-window': r.window } as CSSProperties;
  const chiefAsk = A.chiefAsks(live).sort((a, b) => A.askRank(a) - A.askRank(b))[0];
  // One floor, left to right in the roster's order (whoever waits on you, then working, then the rest, resting last),
  // Chief standing just after whoever waits on you. Everyone stands at the mock's size in every state: the room
  // stands as many as the stage holds at MOCK scale or more, up to five, and counts the rest under "+N" (A.floorPlan).
  const trayText = `Tray · ${live.counts.done}`;
  const stand = (k: number) => {
    const plan = A.floorPlan(crew, k), waits = plan.seats.filter(A.waitsOnYou).length;
    const order: (A.OfficeMember | 'chief')[] = [...plan.seats.slice(0, waits), 'chief', ...plan.seats.slice(waits)];
    return { plan, order, ...lay(order, live, trayText) };
  };
  let fit = stand(A.SEATS);
  for (let k = A.SEATS - 1; k >= 1 && fit.s < MOCK; k--) fit = stand(k);
  const { plan, order, spots, s, X, Y } = fit;
  const spotOf = (m: A.OfficeMember | 'chief') => spots.find((p) => p.m === m)!;
  const trayAt = spots.find((p) => p.tray)!, trayX = trayAt.st === 'done' ? trayAt.x - 20 : trayAt.x;
  // One accent pill, over whoever's question matters most (money, then your name, then the rest; Chief's own last).
  const urgent = plan.seats.filter((c) => c.ask).sort((a, b) => A.askRank(a.ask!) - A.askRank(b.ask!))[0];
  const chat = plan.seats.find((c) => A.seatOf(c) === 'chat');
  const pill = urgent && (!chiefAsk || A.askRank(urgent.ask!) <= A.askRank(chiefAsk))
    ? { m: urgent as A.OfficeMember | 'chief', href: `#/ask/${urgent.ask!.id}`, label: `Review what ${urgent.name} needs: ${urgent.ask!.head}` }
    : chiefAsk ? { m: 'chief' as const, href: `#/ask/${chiefAsk.id}`, label: `Review what Chief needs: ${chiefAsk.head}` }
    : chat ? { m: chat as A.OfficeMember | 'chief', href: `#/h/${chat.id}`, label: `Reply to ${chat.name} in their chat` }
    : null;
  const more = plan.more.length, moreBusy = plan.more.filter((c) => A.seatOf(c) === 'working').length;
  const id = useId().replace(/:/g, '');
  const Y0 = wide ? -34 : 0, H = 210;

  return (
    <section className="office" aria-label="The office">
      <div ref={box} className={`o-room${wide ? ' wide' : ''}`} style={vars} data-scale={s.toFixed(3)}>
        <svg className="o-art" viewBox={`0 ${Y0} 360 ${H - Y0}`} preserveAspectRatio={wide ? 'xMidYMid meet' : 'none'} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id={`${id}bl`} x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="2" /></filter>
            <radialGradient id={`${id}lamp`} cx=".5" cy="0" r="1"><stop offset="0" stopColor="#FFE7A3" stopOpacity=".9" /><stop offset="1" stopColor="#FFE7A3" stopOpacity="0" /></radialGradient>
            <radialGradient id={`${id}glow`} cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#C9D6FF" stopOpacity=".5" /><stop offset="1" stopColor="#C9D6FF" stopOpacity="0" /></radialGradient>
          </defs>
          <Scene id={id} wide={wide} />
          <g transform={`translate(${X(0)} ${G}) scale(${s}) translate(0 ${-G})`}>
            <TrayBox x={trayX} n={live.counts.done} />
            {order.map((m) => m === 'chief'
              ? <Seat key="chief" spot={spotOf(m)} id={id} kind="chief" pose={art.poseOf(live.chief.mood)} seat={chiefAsk ? 'needs' : live.chief.mood === 'work' ? 'working' : 'free'} beat={live.chief.mood}
                  label={`Chief: ${live.chief.line}`} onOpen={() => setProfile(true)} />
              : <Seat key={m.id} spot={spotOf(m)} id={id} kind={m.kind} pose={art.poseOf(m.mood)} seat={A.seatOf(m)} second={m.second} dataId={m.id} beat={`${m.ring}|${m.mood}|${m.things.length}|${m.ask?.id ?? ''}`}
                  label={said(m) + (m.things.length ? `, made ${m.things.map((f) => KIND_WORDS[f.kind]).join(', ')}` : '')} onOpen={() => setOpen(m.id)} />)}
          </g>
          <Tag key={live.counts.done} x={X(trayX)} y={Y(G - 64)} text={trayText} tail cls={`o-tray${trayWas.current !== undefined && trayWas.current !== live.counts.done ? ' bump' : ''}`} href="#/things" label={`Your tray: ${live.counts.done} done today`} />
          {pill && <Tag x={X(spotOf(pill.m).x)} y={pill.m === 'chief' ? Y(G - 80.8) - 14 : Y(102)} text={A.SEAT_WORDS.needs} hot href={pill.href} label={pill.label} />}
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

/** Each figure stands at a station drawn for what they are doing (the B1 Studio scene, recipe/b1-staging-v3-office.html):
 *  waiting on you at a writing desk with a raised pen, working at a desk under a playing screen (Scribe writes a sheet
 *  instead), stuck at a screen with a "!", done by the tray, resting asleep on a cushion, anyone else standing by.
 *  PAD is the room each takes left and right of where they stand, the mock's own spacing. */
type Station = 'needs' | 'monitor' | 'writing' | 'failed' | 'done' | 'rest' | 'stand' | 'chief' | 'tray';
const PAD: Record<Station, [number, number]> = { needs: [48, 24], chief: [38, 26], monitor: [20, 58], failed: [20, 58], writing: [22, 28], done: [20, 18], rest: [22, 22], stand: [18, 18], tray: [48, 30] };
const stationOf = (c: A.OfficeMember, v: A.OfficeView): Station => {
  const k = A.seatOf(c);
  return k === 'needs' || k === 'chat' ? 'needs' : k === 'working' ? (c.kind === 'scribe' ? 'writing' : 'monitor') : k === 'failed' ? 'failed'
    : k === 'resting' ? 'rest' : stripSeat(c, v) === 'done' ? 'done' : 'stand';
};
const TALL: Station[] = ['chief', 'monitor', 'failed', 'needs'];
type Spot = { m: A.OfficeMember | 'chief' | 'tray'; st: Station; x: number; tray: boolean };
const G = 196, W = 346, MOCK = 0.85;   // the floor line, the stage's width, and the least row scale that reads as the mock's size
/** Left to right in the given order, the tray just before whoever finished (or before the resting); the row scales down
 *  about the floor line to fit, and centres when it is short. The Tray bubble never sits over a figure or past the
 *  room's edge: the tray keeps room for it beside anyone reaching its height (Chief's hat and cane reach 40 to his
 *  right, a screen, a raised pen and the pill above it) and at the room's end; it floats over a low neighbour as in the
 *  mock (a writer, the finished, the resting) while the row is at 3/4 size or more, where it clears their heads.
 *  ponytail: four passes for that room under scaling, exact enough for six stations. */
function lay(order: (A.OfficeMember | 'chief')[], v: A.OfficeView, trayText: string) {
  const sts = order.map((m) => (m === 'chief' ? 'chief' : stationOf(m, v)) as Station);
  let at = sts.indexOf('done');
  const items: { m: Spot['m']; st: Station; tray: boolean }[] = order.map((m, i) => ({ m, st: sts[i], tray: i === at }));
  if (at < 0) { const r = sts.indexOf('rest'); items.splice(r < 0 ? items.length : r, 0, { m: 'tray', st: 'tray', tray: true }); at = r < 0 ? items.length - 1 : r; }
  const half = (trayText.length * 6.6 + 22) / 2;
  let s = 1, spots: Spot[] = [], total = 0;
  for (let pass = 0; pass < 4; pass++) {
    let cur = 0;
    spots = items.map((it, i) => {
      let [l, r] = PAD[it.st];
      // The bubble is centred over the tray, 20 left of a done figure; its half plus a gap, unscaled, clears each neighbour.
      const b = (half + 4) / s, dx = it.st === 'done' ? 20 : 0;
      const tall = (n?: { st: Station }) => !n || s < 0.75 || TALL.includes(n.st);
      if (it.tray && tall(items[i - 1])) l = Math.max(l, (items[i - 1]?.st === 'chief' ? 14 : 0) + dx + b);
      if (it.tray && tall(items[i + 1])) r = Math.max(r, b - dx);
      const x = cur + l; cur = x + r;
      return { ...it, x };
    });
    total = cur; s = Math.min(1, W / total);
  }
  const x0 = 180 - (total * s) / 2;   // the crew centred under the window (x 180), as the mock
  return { spots, s, x0, X: (x: number) => x0 + x * s, Y: (y: number) => G + (y - G) * s };
}

/** A bean on the floor, feet at y: front on (two eyes, or shut asleep), or side on facing their work (one eye, a nose
 *  bump, a brow looking up at a screen or a lid looking down at a page). */
function Bean({ x, y = G, fill, h = 46, w = 30, side, gaze, sleep, id, children }: { x: number; y?: number; fill: string; h?: number; w?: number; side?: 'l' | 'r';
  gaze?: 'up' | 'down'; sleep?: boolean; id: string; children?: ReactNode }) {
  const ink = 'var(--r-edge)', top = y - h, s = side === 'l' ? -1 : 1;
  const ex = x + s * (w / 2 - 6), ey = top + (gaze === 'up' ? 8 : 11), ny = top + 13, nx = x + s * Math.sqrt((w / 2) ** 2 - (ny - top - w / 2) ** 2);
  const line = { stroke: ink, strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' as const };
  return <>
    <ellipse cx={x} cy={y + 2} rx={w * 0.62} ry="3.2" fill={ink} opacity=".1" filter={`url(#${id}bl)`} />
    <path d={`M${x - w / 2} ${y}V${top + w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${y}z`} fill={fill} stroke={ink} strokeWidth="1.8" strokeLinejoin="round" />
    {side ? <>
      <ellipse cx={ex + s * 0.5} cy={ey + (gaze === 'up' ? -0.6 : 0.6)} rx="1.9" ry="2.3" fill={ink} />
      <path d={gaze === 'up' ? `M${ex - 3.5 * s} ${ey - 4.5}q${3.5 * s} -2.2 ${7 * s} -.8` : `M${ex - 3 * s} ${ey - 3}q${3 * s} -.8 ${6 * s} 1.4`} {...line} strokeWidth={1.4} />
      <path d={`M${nx} ${ny - 1.8}q${2.4 * s} 1.8 0 3.6`} fill={fill} stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
    </> : sleep ? <path d={`M${x - 7} ${top + 17}q3 2 6 0M${x + 2} ${top + 17}q3 2 6 0`} {...line} />
      : <><circle cx={x - 5} cy={top + 16} r="1.9" fill={ink} /><circle cx={x + 5} cy={top + 16} r="1.9" fill={ink} /></>}
    {children}
  </>;
}
const Desk = ({ x, w }: { x: number; w: number }) => <g className="o-desk"><rect x={x} y="150" width={w} height="5" rx="2" fill="var(--r-desk)" stroke="var(--r-edge)" strokeWidth="1.8" />
  <path d={`M${x + 6} 155V${G}M${x + w - 6} 155V${G}`} stroke="var(--r-edge)" strokeWidth="1.8" /></g>;

/** One station: its furniture and the figure, the whole group the button that opens them. */
function Seat({ spot, id, kind, pose, seat, second, dataId, beat, label, onOpen }: { spot: Spot; id: string; kind: art.Kind | 'chief'; pose: art.Pose; seat: A.Seat;
  second?: boolean; dataId?: string; beat: string; label: string; onOpen: () => void }) {
  const { x, st } = spot, ink = 'var(--r-edge)', red = '#F0482A', fill = kind === 'chief' ? '#fff' : art.PALS[kind].body;
  const chief = useMemo(() => (kind === 'chief' ? art.chiefSvg(pose, { vb: '24 30 176 210' }).replace('<svg ', `<svg x="${x - 30.4}" y="${G - 80.8}" width="70.4" height="84" `) : ''), [kind, pose, x]);
  const fig = useRef<SVGGElement>(null);
  // A hop when their news lands (a new ring, mood or thing): once, never on the first paint, never with Reduce Motion.
  const was = useRef(beat);
  useEffect(() => {
    if (was.current === beat) return;
    was.current = beat;
    if (!reduced()) fig.current?.animate([{ translate: '0 0' }, { translate: '0 -10px', offset: 0.35 }, { translate: '0 0', offset: 0.7 }, { translate: '0 -3px', offset: 0.85 }, { translate: '0 0' }], { duration: 560, easing: 'ease-out' });
  }, [beat]);
  const [l, r] = PAD[st];
  const sprite = (body: ReactNode) => <g ref={fig} className={`o-sprite ${kind} st-${st}${second ? ' second' : ''}`}>{body}</g>;
  return <g className="o-cell" data-id={dataId} data-seat={seat} role="button" tabIndex={0} aria-label={label} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
    <rect x={x - l} y={G - 100} width={l + r} height="104" fill="transparent" />
    {st === 'chief' && <><ellipse cx={x} cy={G + 2} rx="22" ry="3.2" fill={ink} opacity=".1" filter={`url(#${id}bl)`} /><g ref={fig} className={`o-sprite ink chief pose-${pose}`} dangerouslySetInnerHTML={{ __html: chief }} /></>}
    {st === 'needs' && <>
      <Desk x={x - 48} w={72} />
      <rect x={x - 40} y="132" width="22" height="18" rx="2" fill="var(--r-desk)" stroke={ink} strokeWidth="1.6" /><path d={`M${x - 36} 139h14M${x - 36} 144h9`} stroke={ink} strokeWidth="1.3" />
      {sprite(<Bean x={x} fill={fill} id={id}><g className="o-wave"><path d={`M${x + 15} ${G - 30}l12-20`} stroke={ink} strokeWidth="1.8" strokeLinecap="round" /><circle cx={x + 28} cy={G - 52} r="3.5" fill={red} stroke={ink} strokeWidth="1.5" /></g></Bean>)}
    </>}
    {(st === 'monitor' || st === 'failed') && <>
      <Desk x={x - 20} w={78} />
      {st === 'monitor' && <ellipse cx={x + 30} cy="150" rx="40" ry="16" fill={`url(#${id}lamp)`} opacity=".85" />}
      <g className="o-mon"><rect x={x + 16} y="118" width="34" height="24" rx="3" fill={st === 'failed' ? '#FFE9E3' : 'var(--r-screen)'} stroke={ink} strokeWidth="1.7" />
        {st === 'failed' ? <text x={x + 33} y="135" textAnchor="middle" fontFamily="Inter" fontWeight="800" fontSize="13" fill={red}>!</text> : <path d={`M${x + 30} 125l7 5-7 5z`} fill={ink} />}
        <path d={`M${x + 33} 142v8`} stroke={ink} strokeWidth="1.7" /></g>
      {/* At work the helper faces you under the playing screen, as the B1 mock (Reel in their headphones); stuck, they turn to the "!". */}
      {sprite(<g className={st === 'monitor' ? 'o-nod' : undefined}><Bean x={x} fill={fill} side={st === 'failed' ? 'r' : undefined} gaze={st === 'failed' ? 'up' : undefined} id={id}>
        {kind === 'reel' && (st === 'failed'
          ? <><path d={`M${x - 6} 158C${x - 7} 146 ${x + 6} 145 ${x + 10} 151`} stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" /><rect x={x - 10.5} y="157" width="9" height="13" rx="4" fill={ink} /></>
          : <><path d={`M${x - 15} 167C${x - 15} 144 ${x + 15} 144 ${x + 15} 167`} stroke={ink} strokeWidth="2.4" fill="none" strokeLinecap="round" /><rect x={x - 18} y="162" width="6" height="11" rx="3" fill={ink} /><rect x={x + 12} y="162" width="6" height="11" rx="3" fill={ink} /></>)}
      </Bean></g>)}
    </>}
    {st === 'writing' && <>
      <ellipse cx={x + 2} cy="150" rx="30" ry="12" fill={`url(#${id}lamp)`} opacity=".7" />
      <Desk x={x - 18} w={46} />
      <path d={`M${x - 6} 150l10-6 10 6z`} fill="var(--r-desk)" stroke={ink} strokeWidth="1.4" />
      {/* Writing at the desk, facing you, the pen moving on the page beside the note (the B1 mock), held in the left hand
          so the Tray bubble that floats over this desk never covers it; the mirror keeps the loop's motion. */}
      <g transform={`translate(${2 * x} 0) scale(-1 1)`}><path className="o-pen" d={`M${x + 12} 147l9-14`} stroke={ink} strokeWidth="1.8" strokeLinecap="round" /></g>
      {sprite(<Bean x={x} h={44} fill={fill} id={id} />)}
    </>}
    {st === 'done' && sprite(<Bean x={x} h={40} fill={fill} side="l" gaze="down" id={id}>
      <path d={`M${x + 2} ${G - 14}l3 3 6-6`} stroke={ink} strokeWidth="1.7" fill="none" strokeLinecap="round" /><path d={`M${x - 14} ${G - 18}q-5-4-7-11`} stroke={ink} strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </Bean>)}
    {st === 'rest' && <>
      <ellipse cx={x} cy={G - 6} rx="22" ry="8" fill={fill} stroke={ink} strokeWidth="1.6" />
      {sprite(<g className="o-breath"><Bean x={x} y={G - 10} h={30} w={26} sleep fill={fill} id={id} /></g>)}
      <g className="o-zz" fontFamily="Instrument Serif, Georgia, serif" fontStyle="italic" fill={ink}><text x={x - 2} y={G - 46} fontSize="13" opacity=".6">z</text><text x={x + 5} y={G - 55} fontSize="10" opacity=".45">z</text></g>
    </>}
    {st === 'stand' && sprite(<Bean x={x} fill={fill} id={id} />)}
  </g>;
}

/** The tray on the floor (beside whoever finished, or on its own spot), with a page in it once anything is done. */
function TrayBox({ x, n }: { x: number; n: number }) {
  const ink = 'var(--r-edge)';
  return <g aria-hidden className="o-traybox"><path d={`M${x - 16} ${G}l3 -14h26l3 14z`} fill="var(--r-desk)" stroke={ink} strokeWidth="1.6" strokeLinejoin="round" /><path d={`M${x - 11} ${G - 9}h22`} stroke={ink} strokeWidth="1.3" />
    {n > 0 && <g><path d={`M${x - 10} ${G - 22}l12-2 2 12-12 2z`} fill="#fff" stroke={ink} strokeWidth="1.4" strokeLinejoin="round" /><path d={`M${x - 7} ${G - 17}l7-1`} stroke={ink} strokeWidth=".9" /></g>}</g>;
}

/** A label in the room: the accent pill for what needs you, or a white speech bubble with a tail. */
function Tag({ x, y, text, hot, tail, cls = '', href, label }: { x: number; y: number; text: string; hot?: boolean; tail?: boolean; cls?: string; href: string; label: string }) {
  const w = text.length * 6.6 + 22, ink = 'var(--r-edge)';
  const left = Math.max(4, Math.min(x - w / 2, 356 - w));
  return <a className={`o-tag ${hot ? 'o-pill' : ''} ${cls}`} href={href} aria-label={label}>
    {tail && <path d={`M${x - 4} ${y + 10}l2 8 7-8`} fill="var(--solid)" stroke={ink} strokeWidth="1.3" strokeLinejoin="round" />}
    <rect x={left} y={y - 11} width={w} height="22" rx="11" fill={hot ? '#F0482A' : 'var(--solid)'} stroke={hot ? 'none' : ink} strokeWidth="1.3" />
    {tail && <path d={`M${x - 3} ${y + 9.4}h9`} stroke="var(--solid)" strokeWidth="2" />}
    <text x={left + w / 2} y={y + 4} textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="11" fill={hot ? '#fff' : 'var(--ink)'}>{text}</text>
  </a>;
}

/** Done hand-off: a page travels from the helper's desk into the tray box on the floor, then the tray's count bumps. Reduce Motion skips
 *  the journey and lands on the end state, which the refresh already shows. */
function handOff(room: HTMLElement | null, ids: string[], desks: Map<string, { x: number; y: number }>) {
  const tray = room?.querySelector('.o-traybox > path');   // the box itself, not the page already in it
  if (!room || !tray || reduced()) return;
  // The page is drawn at the figures' size (14x18 room units at the row's scale, as at 390 where it reads with the
  // beans), and ends centred on the box's mouth, its lower part inside, so it reads as dropped in.
  const k = ((room.querySelector('.o-art') as SVGSVGElement).getScreenCTM()?.a ?? 1) * Number(room.dataset.scale ?? 1), pw = 14 * k, ph = 18 * k;
  const t = tray.getBoundingClientRect(), base = room.getBoundingClientRect(), to = { x: t.left - base.left + t.width / 2 - pw / 2, y: t.top - base.top - ph / 2 - k };
  for (const id of new Set(ids)) {
    const from = desks.get(id);
    if (!from) continue;
    const page = document.createElement('i');
    page.className = 'o-flyer';
    page.dataset.from = id;
    const x = from.x - pw / 2;   // centred over the helper's head, where they stood
    Object.assign(page.style, { left: `${x}px`, top: `${from.y}px`, width: `${pw}px`, height: `${ph}px` });
    room.appendChild(page);
    page.animate([{ transform: 'none', opacity: 1 }, { opacity: 1, offset: .9 }, { transform: `translate(${to.x - x}px, ${to.y - from.y}px) scale(.8) rotate(8deg)`, opacity: 0 }], { duration: 1300, easing: 'ease-in-out' }).finished.finally(() => page.remove());
  }
}
/** Where each helper stands in the room now, relative to the room's box: the hand-off's start next time. */
const spritesIn = (room: HTMLElement | null) => {
  const base = room?.getBoundingClientRect();
  return new Map(Array.from(room?.querySelectorAll<SVGGraphicsElement>('.o-cell[data-id] .o-sprite') ?? []).map((e) => {
    const r = e.getBoundingClientRect();
    return [(e.closest('.o-cell') as HTMLElement).dataset.id!, { x: r.left - base!.left + r.width / 2, y: r.top - base!.top }] as const;
  }));
};

/** Chief up close: how to reach him, the crew's computers (watching first), and what the crew made today. */
function ChiefSheet({ live, state, roles, onClose }: { live: A.OfficeView; state: Json; roles: Map<string, A.Helper>; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // B1 desk: the card opens beside the Chief you tapped (the focused opener), kept inside the window.
  const [at] = useState(() => { const r = document.activeElement?.closest('button')?.getBoundingClientRect();
    return r ? { '--pop-x': `${Math.round(Math.max(12, Math.min(r.right - 16, innerWidth - 384)))}px`, '--pop-y': `${Math.round(Math.max(72, Math.min(r.top, innerHeight - 560)))}px` } : undefined; });
  useDialogOwn(box, onClose);
  const [phones, setPhones] = useState<number | null>(null);
  useEffect(() => { api.phones().then((p) => setPhones(p.length)).catch(() => setPhones(null)); }, []);
  // A crew computer shows while its helper is working on it; the picture of it is the live view itself, one tap away.
  const computers = live.crew.filter((c) => roles.get(c.id)?.computer && A.seatOf(c) === 'working');
  const made = A.things(state).slice(0, 4);
  const word = A.chiefWord(live);
  // What happened lately, from the state alone: questions put to you and jobs that landed in the tray.
  const recent = [...live.needs.map((c) => ({ key: `a${c.id}`, at: c.at, text: c.head, href: `#/ask/${c.id}` })),
    ...live.done.map((t) => ({ key: `t${t.id}`, at: t.at, text: `${roles.get(t.helper)?.name ?? 'The crew'} finished ${t.title || 'a job'}`, href: `#/things/t${t.id}` }))]
    .sort((x, y) => y.at - x.at).slice(0, 3);
  return (
    <div className={`scrim o-scrim o-pop${at ? ' at' : ''}`} style={at as CSSProperties} onClick={onClose}>
      <div ref={box} className="o-sheet o-profile" role="dialog" aria-modal aria-label="Chief" onClick={(e) => e.stopPropagation()}>
        <header className="o-sh-head">
          <Face who="chief" size={64} />
          <span className="grow"><h2>Chief</h2><span className="mute small">Runs your crew</span>
            <span className={`o-state ${word === 'Needs you' ? 'needs' : word === 'Working' ? 'work' : ''}`}><i />{word === 'Working' ? 'Working now' : word}</span></span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="o-sec"><div className="o-eyebrow">Ways to reach</div>
          <div className="card list">
            <a className="row-item" href="#/chief" onClick={onClose}><span className="o-ic"><Icon name="chief" size={18} /></span><span className="grow">Message in Chat</span><Icon name="next" /></a>
            <a className="row-item" href="#/settings" onClick={onClose}><span className="o-ic"><Icon name="phone" size={18} /></span><span className="grow">On your phone<small className="mute block">{phones ? `${phones} paired` : 'Not set up'}</small></span>{phones ? <Icon name="next" /> : <b className="o-setup">Set up</b>}</a>
          </div></div>
        <div className="o-sec"><div className="o-eyebrow">Crew computers</div>
          {computers.length ? <div className="card list">{computers.map((c) => <a key={c.id} className="row-item" href={`#/h/${c.id}/screen`} onClick={onClose}>
            <span className="o-thumb" aria-hidden><Face who={{ kind: c.kind, name: c.name, mood: c.mood }} size={30} /><small>Watch</small></span>
            <span className="grow"><b>{c.name}'s computer</b><small className="mute block clamp1">{roles.get(c.id)?.driving ? 'You have the wheel' : c.step || c.status}</small><span className="o-live"><i />Live</span></span><Icon name="next" /></a>)}</div>
            : <p className="o-note">No crew computer is running right now.</p>}</div>
        <div className="o-sec"><div className="o-eyebrow">Recent activity</div>
          {recent.length ? <div className="card list">{recent.map((r) => <a key={r.key} className="row-item" href={r.href} onClick={onClose}><span className="grow clamp1">{r.text}</span><time className="mute small">{A.clock(r.at)}</time></a>)}</div>
            : <p className="o-note">Nothing yet today.</p>}</div>
        <div className="o-sec"><div className="o-eyebrow">Outputs</div>
          {made.length ? <div className="o-made">{made.map((m) => <a key={m.id} className="card" href={`#/things/t${m.id}`} onClick={onClose}><b>{m.title}</b><small className="mute">From {roles.get(m.helper)?.name ?? 'the crew'}{m.files[0] ? ` · ${KIND_WORDS[m.files[0].kind].replace(/^an? /, '')}` : ''}</small></a>)}</div>
            : <p className="o-note">Nothing made yet.</p>}</div>
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
