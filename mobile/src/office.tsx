// The office at the top of the phone's Home: the B1 Studio room, the same one floor the web draws (web/src/office.tsx)
// on the same 360-unit grid, scaled to the phone's width: the wall with its night window, shelf and clock, each figure
// where A.floorPlan stands it (five spots in roster order, Chief just after whoever waits on you, "+N" for the rest),
// one accent pill over whoever's question matters most and one Tray bubble. Under it the strip names every figure left
// to right, and is the room's tappable, screen-reader index. The crew are the B1 drawings from web/src/art.ts
// (./marks.ts); the room's colours are tokens.ts `room`. Every word and count comes from the one A.office view Home
// also reads (useOffice). Motion lives in ./motion.ts: a calm loop per status, a hop when news lands and a done page
// carried to the tray, all on the native driver and none under Reduce Motion or in the background.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Pressable, Text, View, type ViewStyle } from 'react-native';
import * as A from '../../web/src/adapter.ts';
import type { Json } from '../../web/src/api.ts';
import { PALS as COLOURS, poseOf } from '../../web/src/art.ts';
import { color, room as ROOM } from '../../web/src/tokens.ts';
import { onLive } from './link';
import { PALS } from './marks';
import * as motion from './motion';

type Look = typeof color.day;
type Room = typeof ROOM.day;
// The room's grid, as on the web: 360 units across, the floor line at G, figures between L and R, the tray at the right.
const G = 196, H = 210, L = 32, R = 244, ACCENT = '#F0482A';
const spots = (k: number) => { const span = Math.min(R - L, (k - 1) * 58), x0 = (L + R) / 2 - span / 2; return Array.from({ length: k }, (_, i) => (k === 1 ? (L + R) / 2 : x0 + (i * span) / (k - 1))); };
type StripSeat = A.Seat | 'done' | 'here';
const STRIP: Record<StripSeat, string> = { needs: 'needs you', chat: 'needs you', working: 'working', failed: 'stuck', next: 'up next', resting: 'resting', free: 'free', done: 'done', here: 'here' };

/** How a helper reads to a screen reader, in the room's own words. */
const said = (c: A.OfficeMember) => {
  const k = A.seatOf(c);
  return k === 'needs' ? `${c.name} needs you: ${c.ask!.head}` : k === 'working' ? `${c.name}, working on ${c.status}` : k === 'free' || k === 'resting' ? `${c.name}, ${c.status.toLowerCase()}` : `${c.name}, ${A.SEAT_WORDS[k].toLowerCase()}`;
};

/** The room, `width` points wide, with its strip. Tapping a figure or its strip cell opens them (`onDesk`, Chief his
 *  profile), the pill its question (`onAsk`), the tray the Things, "+N" the whole crew. */
export function Office({ view, night, offline, width, onChief, onDesk, onAsk, onTray, onCrew }: {
  view: A.OfficeView; night: boolean; offline: boolean; width: number;
  onChief: () => void; onDesk: (c: A.OfficeMember) => void; onAsk: (c: A.Card) => void; onTray: () => void; onCrew: () => void;
}) {
  const crew = view.crew, chief = view.chief;
  const t = night ? color.night : color.day;
  const r = night ? ROOM.night : ROOM.day;
  const reduce = motion.useReduceMotion();
  const awake = motion.useAwake();
  const k = width / 360, u = (n: number) => n * k;
  const plan = A.floorPlan(crew);
  const chiefAsk = offline ? undefined : A.chiefAsks(view).sort((a, b) => A.askRank(a) - A.askRank(b))[0];
  const waits = plan.seats.filter(A.waitsOnYou).length;
  const order: (A.OfficeMember | 'chief')[] = [...plan.seats.slice(0, waits), 'chief', ...plan.seats.slice(waits)];
  const xs = spots(order.length);
  const urgent = plan.seats.filter((c) => c.ask).sort((a, b) => A.askRank(a.ask!) - A.askRank(b.ask!))[0];
  const pill = urgent && (!chiefAsk || A.askRank(urgent.ask!) <= A.askRank(chiefAsk)) ? { at: order.indexOf(urgent), ask: urgent.ask!, who: urgent.name }
    : chiefAsk ? { at: order.indexOf('chief'), ask: chiefAsk, who: 'Chief' } : null;
  const more = plan.more.length, moreBusy = plan.more.filter((c) => A.seatOf(c) === 'working').length;
  // A done page leaves from where the helper stood before the room re-laid them as done (the web's handOff): per helper,
  // their done count, where they stood last render, and where the current page started. Idempotent, so safe in render.
  const stood = useRef(new Map<string, { n: number; x: number; from: number }>()).current;
  const fromOf = (id: string, n: number, x: number) => {
    const e = stood.get(id), from = !e ? x : e.n !== n ? e.x : e.from;
    stood.set(id, { n, x, from });
    return from;
  };
  const ink = r.edge, line = (x: number, y: number, w: number, h: number, c = ink): ViewStyle => ({ position: 'absolute', left: u(x), top: u(y), width: u(w), height: u(h), backgroundColor: c });
  return (
    <View style={{ width }}>
      <View style={{ width, height: u(H), backgroundColor: r.wall, overflow: 'hidden' }}>
        <View pointerEvents="none" style={line(0, G, 360, H - G, r.floor)} />
        <View pointerEvents="none" style={line(0, G - 1, 360, 2)} />
        {/* the night window, the shelf with its books and plant, the clock */}
        <View pointerEvents="none" style={{ position: 'absolute', left: u(136), top: u(22), width: u(88), height: u(64), borderRadius: u(6), borderWidth: 2, borderColor: ink, backgroundColor: r.window }}>
          <View style={{ position: 'absolute', left: u(43) - 1, top: 0, bottom: 0, width: 2, backgroundColor: ink }} />
          <View style={{ position: 'absolute', top: u(31) - 1, left: 0, right: 0, height: 2, backgroundColor: ink }} />
          <View style={{ position: 'absolute', left: u(64), top: u(9), width: u(12), height: u(12), borderRadius: u(6), backgroundColor: '#FFE7A3' }} />
          {[[14, 14], [29, 22], [60, 48], [12, 50]].map(([x, y]) => <View key={x} style={{ position: 'absolute', left: u(x), top: u(y), width: 2, height: 2, borderRadius: 1, backgroundColor: '#fff' }} />)}
        </View>
        <View pointerEvents="none" style={line(18, 69, 70, 2)} />
        <View pointerEvents="none" style={{ ...line(26, 52, 9, 18, COLOURS.reel.body), borderWidth: 1.5, borderColor: ink, borderRadius: 2 }} />
        <View pointerEvents="none" style={{ ...line(36, 56, 8, 14, COLOURS.scout.body), borderWidth: 1.5, borderColor: ink, borderRadius: 2 }} />
        <View pointerEvents="none" style={{ ...line(62, 62, 14, 8, r.desk), borderWidth: 1.5, borderBottomWidth: 0, borderColor: ink }} />
        <View pointerEvents="none" style={{ ...line(64, 46, 10, 16, COLOURS.tracer.body), borderWidth: 1.4, borderColor: ink, borderTopRightRadius: u(10), borderBottomLeftRadius: u(10) }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: u(277), top: u(31), width: u(30), height: u(30), borderRadius: u(15), borderWidth: 2, borderColor: ink, backgroundColor: r.desk }}>
          <View style={{ position: 'absolute', left: u(15) - 3, top: u(5), width: 2, height: u(10), backgroundColor: ink }} />
          <View style={{ position: 'absolute', left: u(15) - 2, top: u(15) - 2, width: u(7), height: 2, backgroundColor: ink, transform: [{ rotate: '35deg' }] }} />
        </View>
        {order.map((m, i) => {
          const x = xs[i];
          if (m === 'chief') {
            const pose = poseOf(chief.mood);
            return <Pressable key="chief" onPress={onChief} accessibilityRole="button" accessibilityLabel={`Chief: ${chief.line}`} style={{ position: 'absolute', left: u(x - 40), top: u(G - 93), width: u(80), height: u(100) }}>
              <motion.Hop beat={chief.mood} reduce={reduce} awake={awake}><motion.Loop pose={pose} reduce={reduce} awake={awake}><Image source={PALS[`chief-${pose}`]} style={{ width: u(80), height: u(100) }} /></motion.Loop></motion.Hop>
            </Pressable>;
          }
          const seat = A.seatOf(m), pose = poseOf(m.mood), desk = seat === 'needs' || seat === 'chat' || seat === 'working' || seat === 'failed';
          const lift = seat === 'resting' && m.kind !== 'pip' ? 8 : 0;
          const img = <motion.Loop pose={pose} reduce={reduce} awake={awake}><Image source={PALS[`${m.kind}-${pose}`]} style={{ width: u(60), height: u(75) }} /></motion.Loop>;
          return <Pressable key={m.id} onPress={() => onDesk(m)} accessibilityRole="button" accessibilityLabel={said(m)} style={{ position: 'absolute', left: u(x - 30), top: u(G - 100), width: u(60), height: u(104) }}>
            {seat === 'working' && <View pointerEvents="none" style={{ position: 'absolute', left: u(-4), top: u(44), width: u(68), height: u(20), borderRadius: u(34), backgroundColor: '#FFE7A3', opacity: 0.45 }} />}
            {desk && <View pointerEvents="none" style={{ position: 'absolute', left: u(9), top: u(50), width: u(42), height: u(G - 150), borderLeftWidth: 2, borderRightWidth: 2, borderColor: ink, marginHorizontal: 0 }}>
              <View style={{ position: 'absolute', left: -u(5) - 2, right: -u(5) - 2, top: 0, height: u(5), backgroundColor: r.desk, borderWidth: 1.5, borderColor: ink, borderRadius: 2 }} />
            </View>}
            {(seat === 'needs' || seat === 'chat') && <View pointerEvents="none" style={{ position: 'absolute', left: u(19), top: u(31), width: u(22), height: u(18), backgroundColor: r.desk, borderWidth: 1.5, borderColor: ink, borderRadius: 2, paddingHorizontal: u(3), paddingTop: u(5), gap: u(3) }}>
              <View style={{ height: 1.3, backgroundColor: ink }} /><View style={{ height: 1.3, width: '60%', backgroundColor: ink }} /></View>}
            {(seat === 'working' || seat === 'failed') && <View pointerEvents="none" style={{ position: 'absolute', left: u(14), top: u(20), width: u(32), height: u(22), backgroundColor: seat === 'failed' ? '#FFE9E3' : r.screen, borderWidth: 1.7, borderColor: ink, borderRadius: 3, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: seat === 'failed' ? ACCENT : ink, fontSize: u(10), lineHeight: u(12), fontWeight: '800' }}>{seat === 'failed' ? '!' : '\u25B6'}</Text></View>}
            {lift > 0 && <View pointerEvents="none" style={{ position: 'absolute', left: u(8), top: u(91), width: u(44), height: u(14), borderRadius: u(22), backgroundColor: r.sofa, borderWidth: 1.5, borderColor: ink }} />}
            <motion.Hop beat={`${m.ring}|${m.mood}|${m.things.length}|${m.ask?.id ?? ''}`} times={m.mood === 'happy' ? 2 : 1} reduce={reduce} awake={awake} style={{ position: 'absolute', left: 0, top: u(30 - lift) }}>
              {m.second ? <View style={{ filter: [{ hueRotate: '48deg' }] }}>{img}</View> : img}
            </motion.Hop>
            {(() => { const n = view.done.filter((d) => d.helper === m.id).length, from = fromOf(m.id, n, x);
              return <motion.Fly beat={n} dx={u(318 - from)} dy={u(-20)} reduce={reduce} awake={awake}
              style={{ position: 'absolute', left: u(24 + from - x), top: u(40), width: 14, height: 18, backgroundColor: '#fff', borderWidth: 1.5, borderColor: ink, borderRadius: 2 }}><View /></motion.Fly>; })()}
          </Pressable>;
        })}
        {/* the tray in the corner and its one bubble */}
        <View pointerEvents="none" style={{ position: 'absolute', left: u(301), top: u(G - 14), width: u(34), height: u(14), backgroundColor: r.desk, borderWidth: 1.5, borderBottomWidth: 0, borderColor: ink, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
        <Pressable onPress={onTray} accessibilityRole="button" accessibilityLabel={`Your tray: ${view.counts.done} done today`} hitSlop={8} style={{ position: 'absolute', right: u(4), top: u(G - 69) }}>
          <motion.Hop beat={view.counts.done} reduce={reduce} awake={awake}><Tag t={t} k={k} ink={ink}>{`Tray · ${view.counts.done}`}</Tag></motion.Hop>
        </Pressable>
        {pill && <Pressable onPress={() => onAsk(pill.ask)} accessibilityRole="button" accessibilityLabel={`Review what ${pill.who} needs: ${pill.ask.head}`} hitSlop={6}
          style={{ position: 'absolute', left: u(Math.min(306, Math.max(46, xs[pill.at])) - 42), top: u(order[pill.at] === 'chief' ? 78 : 96), width: u(84), alignItems: 'center' }}>
          <Tag t={t} k={k} hot>{A.SEAT_WORDS.needs}</Tag>
        </Pressable>}
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1.5, borderColor: t.ink, backgroundColor: t.surface }}>
        {order.map((m, i) => {
          const sk: StripSeat = m === 'chief' ? (chiefAsk ? 'needs' : chief.mood === 'work' ? 'working' : 'here') : A.railWord(m, view).seat;
          const hot = sk === 'needs' || sk === 'chat';
          return <Pressable key={m === 'chief' ? 'chief' : m.id} onPress={() => (m === 'chief' ? onChief() : onDesk(m))} accessibilityRole="button"
            accessibilityLabel={m === 'chief' ? `Chief: ${offline ? 'asleep' : A.chiefWord(view)}` : said(m)}
            style={{ flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 7, paddingHorizontal: 2, borderLeftWidth: i ? 1 : 0, borderColor: t.line, backgroundColor: hot ? t.softAccent : 'transparent' }}>
            <Text numberOfLines={1} style={{ fontFamily: 'Inter', fontSize: 11.5, lineHeight: 14, fontWeight: '600', color: t.ink }}>{m === 'chief' ? 'Chief' : m.name}</Text>
            <Text numberOfLines={2} style={{ fontFamily: 'Inter', fontSize: 10.5, lineHeight: 13, fontWeight: '500', color: hot ? t.pink : t.mute, textAlign: 'center' }}>{STRIP[sk]}</Text>
          </Pressable>;
        })}
        {more > 0 && <Pressable onPress={onCrew} accessibilityRole="button" accessibilityLabel={`${more} more of the crew${moreBusy ? `, ${moreBusy} working` : ''}: see everyone`}
          style={{ flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 7, borderLeftWidth: 1, borderColor: t.line }}>
          <Text style={{ fontFamily: 'Inter', fontSize: 11.5, lineHeight: 14, fontWeight: '600', color: t.ink }}>{`+${more}`}</Text>
          <Text numberOfLines={1} style={{ fontFamily: 'Inter', fontSize: 10.5, lineHeight: 13, fontWeight: '500', color: t.mute }}>{moreBusy ? `${moreBusy} working` : 'more'}</Text>
        </Pressable>}
      </View>
    </View>
  );
}

/** The office view: the snapshot, moved by live events until the next refresh starts it again. Home reads it once and
 *  hands it to the hero counts, the room and Needs you, so they can never disagree. While out of reach, what this
 *  phone kept says how things were and nobody claims to be busy (App.tsx OUT). */
export function useOffice(state: Json, offline: boolean, away: string) {
  const base = useMemo(() => A.office(state), [state]);
  const [live, setLive] = useState<A.OfficeView | null>(null);
  const from = useRef(base);
  from.current = base;
  useEffect(() => { setLive(null); }, [base]);
  useEffect(() => onLive((e) => setLive((v) => A.officeEvent(v ?? from.current, e))), []);
  return offline ? A.officeAway(live ?? base, away) : live ?? base;
}

/** A label in the room: the accent pill for what needs you, or the white Tray bubble. */
function Tag({ t, k, hot, ink, children }: { t: Look; k: number; hot?: boolean; ink?: string; children: ReactNode }) {
  return <View style={{ backgroundColor: hot ? ACCENT : t.surface, borderColor: hot ? ACCENT : ink, borderWidth: hot ? 0 : 1.3, borderRadius: 999, height: 22 * k, minWidth: 22 * k, paddingHorizontal: 11 * k, justifyContent: 'center' }}>
    <Text numberOfLines={1} style={{ fontFamily: 'Inter', fontSize: Math.max(10, 11 * k), lineHeight: Math.max(12, 13 * k), fontWeight: '600', color: hot ? '#fff' : t.ink, textAlign: 'center' }}>{children}</Text>
  </View>;
}
