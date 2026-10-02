// The office at the top of the phone's Home: one flat room, front on like a cut-open dollhouse, the same room the web
// draws (web/src/office.tsx, same sizes in points). A.floorPlan (web/src/adapter.ts) hot-desks it: the room never
// grows, four desks go to whoever waits on you and then whoever is working, a three-seat lounge takes the rest and
// "+N" counts everyone else. Under the room the dock is its tappable, screen-reader index: every helper the one who
// matters most first (A.roster), so whoever is only counted under "+N" is still one tap away. The crew are the
// B1 drawings from web/src/art.ts (./marks.ts); the room's colours are tokens.ts `room`. Every word, count and
// Review comes from the one A.office view Home also reads (useOffice). Motion lives in ./motion.ts: a calm loop per
// status, a hop when news lands and a done page carried to the tray, all on the native driver and none under Reduce
// Motion or in the background.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';
import * as A from '../../web/src/adapter.ts';
import type { Json } from '../../web/src/api.ts';
import { PALS as COLOURS, poseOf } from '../../web/src/art.ts';
import { color, room as ROOM } from '../../web/src/tokens.ts';
import { onLive } from './link';
import { PALS } from './marks';
import * as motion from './motion';

type Look = typeof color.day;
type Room = typeof ROOM.day;
// A bubble's foot sits BUB above the seat's floor: over the figure's head and the things on the wall, under nothing.
const DESK_H = 156, LOUNGE_H = 96, FLOOR = 12, COLS = 3, WALL_H = 64, BUB = 106;

/** How a helper reads to a screen reader, in the room's own words. */
const said = (c: A.OfficeMember) => {
  const k = A.seatOf(c);
  return k === 'needs' ? `${c.name} needs you: ${c.ask!.head}` : k === 'working' ? `${c.name}, working on ${c.status}` : k === 'free' || k === 'resting' ? `${c.name}, ${c.status.toLowerCase()}` : `${c.name}, ${A.SEAT_WORDS[k].toLowerCase()}`;
};

/** The room, `width` points wide, with its dock. Tapping a helper opens its desk (`onDesk`), Review its question
 *  (`onAsk`), Chief his chat, the tray the Things, "+N" the whole crew. */
export function Office({ view, night, offline, width, onChief, onDesk, onAsk, onTray, onCrew }: {
  view: A.OfficeView; night: boolean; offline: boolean; width: number;
  onChief: () => void; onDesk: (c: A.OfficeMember) => void; onAsk: (c: A.Card) => void; onTray: () => void; onCrew: () => void;
}) {
  const crew = view.crew, chief = view.chief;
  const t = night ? color.night : color.day;
  const r = night ? ROOM.night : ROOM.day;
  const reduce = motion.useReduceMotion();
  const awake = motion.useAwake();
  // What was on the desks when the room opened is simply there; only things arriving later drop in.
  const seen = useRef<Set<string> | null>(null);
  seen.current ??= new Set(crew.flatMap((c) => c.things.map((f) => f.url)));
  const plan = A.floorPlan(crew);
  const nooks = Math.max(A.NOOKS, plan.desks.length);
  const spare = (COLS - ((nooks + 1) % COLS)) % COLS;
  // Whole points: fractional seats add up past the row in Yoga's floats and wrap the last one onto a line of its own.
  const dw = Math.floor(width / COLS), lw = Math.floor(width / (A.LOUNGE_SEATS + 1));
  const chiefAsk = offline ? undefined : A.chiefAsks(view).sort((a, b) => A.askRank(a) - A.askRank(b))[0];
  const more = plan.more.length, moreBusy = plan.more.filter((c) => A.seatOf(c) === 'working').length;
  return (
    <View style={{ width }}>
    <View style={{ width, backgroundColor: r.wall, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingTop: 8, minHeight: 34 }}>
        <Pressable onPress={onTray} accessibilityRole="button" accessibilityLabel={`Your tray: ${view.counts.done} done today`} hitSlop={8} style={{ marginLeft: 'auto' }}>
          <motion.Hop beat={view.counts.done} reduce={reduce} awake={awake}><Tag t={t}>{`Your tray · ${view.counts.done}`}</Tag></motion.Hop>
        </Pressable>
      </View>
      <Wall w={width} r={r} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Cell w={dw} h={DESK_H} r={r} label={`Chief: ${chief.line}`} onPress={onChief} onReview={chiefAsk ? () => onAsk(chiefAsk) : undefined}>
          <motion.Hop beat={chief.mood} reduce={reduce} awake={awake} style={{ position: 'absolute', left: dw / 2 - 30, bottom: FLOOR }}>
            <motion.Loop pose={poseOf(chief.mood)} reduce={reduce} awake={awake}><Image source={PALS[`chief-${poseOf(chief.mood)}`]} style={{ width: 60, height: 75 }} /></motion.Loop>
          </motion.Hop>
          {chiefAsk ? <Bubble t={t} tone={t.line2} name="Chief"><Cue t={t} label={`Review what Chief needs: ${chiefAsk.head}`} onPress={() => onAsk(chiefAsk)} /></Bubble>
            : <Bubble t={t} tone={chief.mood === 'work' && !offline ? t.green : t.line2} name="Chief" line={offline ? 'Asleep' : A.chiefWord(view)} />}
        </Cell>
        {Array.from({ length: nooks }, (_, i) => plan.desks[i]).map((c, i) => {
          if (!c) return <Cell key={`nook${i}`} w={dw} h={DESK_H} r={r}><Desk w={dw} r={r} /><Monitor w={dw} r={r}><View style={{ flex: 1, backgroundColor: r.screen }} /></Monitor></Cell>;
          const k = A.seatOf(c);
          return <Cell key={c.id} w={dw} h={DESK_H} r={r} label={said(c)} onPress={() => onDesk(c)} onReview={c.ask ? () => onAsk(c.ask!) : undefined}>
            <motion.Hop beat={`${c.ring}|${c.mood}|${c.things.length}|${c.ask?.id ?? ''}`} times={c.mood === 'happy' ? 2 : 1} reduce={reduce} awake={awake}
              style={{ position: 'absolute', left: dw / 2 - 46, bottom: FLOOR }}>
              <Pal kind={c.kind} mood={c.mood} size={48} reduce={reduce} awake={awake} second={c.second} />
            </motion.Hop>
            {c.kind === 'reel' && k === 'working' && <motion.Note reduce={reduce} awake={awake} style={{ position: 'absolute', left: dw / 2 - 2, bottom: 62 }}>
              <Text style={{ fontSize: 15, lineHeight: 16, fontWeight: '700', color: r.edge }}>{'\u266A'}</Text>
            </motion.Note>}
            {c.things.length > 0 && <motion.Fly beat={c.things.length} dx={width - 70 - (dw * ((i + 1) % COLS) + dw * 0.86 - 24)} dy={-(DESK_H * Math.floor((i + 1) / COLS) + WALL_H + 78)} reduce={reduce} awake={awake}
              style={{ position: 'absolute', right: dw * 0.14 + 10, top: 80, width: 14, height: 18, backgroundColor: '#fff', borderWidth: 1.5, borderColor: r.edge, borderRadius: 2 }}><View /></motion.Fly>}
            <Desk w={dw} r={r} />
            <Monitor w={dw} r={r}><Screen c={c} t={t} r={r} /></Monitor>
            {c.things.length > 0 && <View pointerEvents="none" style={{ position: 'absolute', right: dw * 0.14, bottom: 84, flexDirection: 'row', gap: 3, alignItems: 'flex-end' }}>
              {c.things.slice(-2).map((f) => <motion.Land key={f.url} fresh={!seen.current!.has(f.url)} reduce={reduce} awake={awake}>
                {f.kind === 'image' || f.kind === 'video'
                  ? <View style={{ width: 15, height: 15, backgroundColor: COLOURS[c.kind].body, borderWidth: 2, borderColor: '#fff' }} />
                  : <View style={{ width: 13, height: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: r.edge, paddingHorizontal: 2, paddingTop: 3, gap: 1 }}>
                    {[0, 1, 2].map((i) => <View key={i} style={{ height: 1, backgroundColor: '#B9B3AA' }} />)}
                  </View>}
              </motion.Land>)}
            </View>}
            {c.ask
              ? <Bubble t={t} tone={t.line2} name={c.name} tail={-22}><Cue t={t} label={`Review what ${c.name} needs: ${c.ask.head}`} onPress={() => onAsk(c.ask!)} /></Bubble>
              : <Bubble t={t} tone={k === 'chat' ? t.line2 : t.green} dot={k === 'chat' ? t.pink : undefined} name={c.name} line={A.SEAT_WORDS[k]} typing={k === 'working'} tail={-22} />}
          </Cell>;
        })}
        {Array.from({ length: spare }, (_, i) => <Cell key={`spare${i}`} w={dw} h={DESK_H} r={r}>
          <View style={{ position: 'absolute', left: dw / 2 - 27, top: 22, width: 54, height: 44, backgroundColor: r.window, borderWidth: 2, borderColor: r.frame, borderRadius: 4 }}>
            <View style={{ position: 'absolute', left: 24, top: 0, bottom: 0, width: 2, backgroundColor: r.frame }} />
            <View style={{ position: 'absolute', top: 19, left: 0, right: 0, height: 2, backgroundColor: r.frame }} />
          </View>
          <View style={{ position: 'absolute', left: dw / 2 - 6, bottom: FLOOR + 14, width: 12, height: 20, borderWidth: 2, borderColor: r.leaf, borderTopRightRadius: 12, borderBottomLeftRadius: 12 }} />
          <View style={{ position: 'absolute', left: dw / 2 - 9, bottom: FLOOR, width: 18, height: 16, backgroundColor: r.pot, borderWidth: 2, borderBottomWidth: 0, borderColor: r.edge, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
        </Cell>)}
      </View>
      {/* The lounge only when someone sits there or "+N" counts more: an empty sofa row means nothing to her. */}
      {(plan.lounge.length > 0 || more > 0) && <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: A.LOUNGE_SEATS }, (_, i) => plan.lounge[i]).map((c, i) => c ? <Cell key={c.id} w={lw} h={LOUNGE_H} r={r} lounge label={said(c)} onPress={() => onDesk(c)}>
          <motion.Hop beat={`${c.ring}|${c.mood}`} reduce={reduce} awake={awake} style={{ position: 'absolute', left: lw / 2 - 16, bottom: 40 }}>
            <Pal kind={c.kind} mood={c.mood} size={32} reduce={reduce} awake={awake} second={c.second} />
          </motion.Hop>
          <Sofa r={r} />
          <View pointerEvents="none" style={{ position: 'absolute', left: 3, right: 3, bottom: 14, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot(t, A.seatOf(c)) }} />
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: 'Inter', fontSize: 11.5, lineHeight: 14, fontWeight: '600', color: t.ink, backgroundColor: t.surface,
              borderRadius: 999, borderWidth: 1, borderColor: t.line, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' }}>{c.name}</Text>
          </View>
        </Cell> : <Cell key={`sofa${i}`} w={lw} h={LOUNGE_H} r={r} lounge><Sofa r={r} /></Cell>)}
        <Cell w={lw} h={LOUNGE_H} r={r} lounge>
          <Sofa r={r} />
          {more > 0 && <Pressable onPress={onCrew} accessibilityRole="button" accessibilityLabel={`${more} more of the crew${moreBusy ? `, ${moreBusy} working` : ''}: see everyone`}
            style={{ position: 'absolute', top: 14, left: 6, right: 6, bottom: 18, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.line2, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'Inter', fontSize: 12.5, lineHeight: 16, fontWeight: '600', color: t.ink, textAlign: 'center' }}>{`+${more}`}</Text>
            {moreBusy > 0 && <Text style={{ fontFamily: 'Inter', fontSize: 10.5, lineHeight: 13, fontWeight: '500', color: t.ink2, textAlign: 'center' }}>{`${moreBusy} working`}</Text>}
          </Pressable>}
        </Cell>
      </View>}
    </View>
    {crew.length > 0 && <Dock view={view} t={t} onDesk={onDesk} />}
    </View>
  );
}

/** The room's index: one button per helper, the one who matters most first, each named with its office word. */
function Dock({ view, t, onDesk }: { view: A.OfficeView; t: Look; onDesk: (c: A.OfficeMember) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Your crew" contentContainerStyle={{ gap: 10, paddingHorizontal: 10, paddingVertical: 10 }}>
    {A.roster(view.crew).map((c) => {
      const k = A.seatOf(c);
      return <Pressable key={c.id} onPress={() => onDesk(c)} accessibilityRole="button" accessibilityLabel={`${c.name}, ${A.SEAT_WORDS[k].toLowerCase()}`} style={{ alignItems: 'center', gap: 4, width: 56 }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: k === 'needs' || k === 'chat' ? t.pink : k === 'working' ? t.green : t.line, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Image source={PALS[`head-${c.kind}-${poseOf(c.mood)}`]} style={{ width: 38, height: 38 }} />
        </View>
        <Text numberOfLines={1} style={{ fontFamily: 'Inter', fontSize: 11.5, lineHeight: 14, fontWeight: '600', color: t.ink, maxWidth: 56 }}>{c.name}</Text>
      </Pressable>;
    })}
  </ScrollView>;
}

const dot = (t: Look, k: A.Seat) => (k === 'needs' || k === 'chat' ? t.pink : k === 'working' ? t.green : k === 'failed' ? t.danger : k === 'next' ? t.amber : t.line2);

/** Waiting on you, said quietly inside a seat's card: a pink dot and "Needs you", opening the same sheet as Needs you
 *  (which already lists the row), never a filled button per seat. */
function Cue({ t, label, onPress }: { t: Look; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.pink }} />
    <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'Inter', fontSize: 11, lineHeight: 14, fontWeight: '500', color: t.ink }}>{A.SEAT_WORDS.needs}</Text>
  </Pressable>;
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

/** One seat: the plank floor and skirting under it (seats side by side make one floor), the lounge's sofa back, and
 *  the whole seat as the tap target when it holds someone. */
function Cell({ w, h, r, lounge, label, onPress, onReview, children }: { w: number; h: number; r: Room; lounge?: boolean; label?: string; onPress?: () => void; onReview?: () => void; children: ReactNode }) {
  const floor = <>
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: FLOOR + 2, backgroundColor: r.floor, borderTopWidth: 2, borderColor: r.skirt }} />
  </>;
  if (!onPress) return <View style={{ width: w, height: h }}>{floor}{children}</View>;
  // A screen reader reads the seat as one button, so the Review inside it is offered as the seat's own action too.
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ width: w, height: h }}
    accessibilityActions={onReview ? [{ name: 'review', label: 'Review' }] : undefined} onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'review') onReview?.(); }}>{floor}{children}</Pressable>;
}

/** A mascot sprite, `dot` points a pixel (the PNGs carry an ink edge a pixel wide), blinking for a moment on news. */
/** A helper whole, `size` points wide, wearing their status loop. */
function Pal({ kind, mood, size, reduce = true, awake = false, second }: { kind: A.OfficeMember['kind']; mood: A.OfficeMember['mood']; size: number; reduce?: boolean; awake?: boolean; second?: boolean }) {
  const pose = poseOf(mood);
  // Another helper of a kind is hue-shifted, as on the web (where the platform has no filter, its name still shows).
  const img = <motion.Loop pose={pose} reduce={reduce} awake={awake}><Image source={PALS[`${kind}-${pose}`]} style={{ width: size, height: size * 1.25 }} /></motion.Loop>;
  return second ? <View style={{ filter: [{ hueRotate: '48deg' }] }}>{img}</View> : img;
}

/** A desk in ink: a top board on two legs, open underneath so whoever sits there shows through. */
function Desk({ w, r }: { w: number; r: Room }) {
  return <View pointerEvents="none" style={{ position: 'absolute', left: w * 0.08, right: w * 0.08, bottom: FLOOR, height: 34, borderColor: r.edge, borderLeftWidth: 2, borderRightWidth: 2, borderTopWidth: 0 }}>
    <View style={{ position: 'absolute', left: -2, right: -2, top: 0, height: 7, backgroundColor: r.desk, borderWidth: 2, borderColor: r.edge, borderRadius: 3 }} />
  </View>;
}

/** The wall above the desks, in the room's ink: a shelf, the night window and the clock. Scenery only. */
function Wall({ w, r }: { w: number; r: Room }) {
  const c = w / 2;
  return <View pointerEvents="none" style={{ height: WALL_H, marginTop: -26 }}>
    <View style={{ position: 'absolute', left: c - 150, top: 49, width: 70, height: 2, backgroundColor: r.edge }} />
    <View style={{ position: 'absolute', left: c - 140, top: 34, width: 9, height: 16, borderRadius: 1.5, borderWidth: 2, borderColor: r.edge, backgroundColor: COLOURS.reel.body }} />
    <View style={{ position: 'absolute', left: c - 128, top: 38, width: 8, height: 12, borderRadius: 1.5, borderWidth: 2, borderColor: r.edge, backgroundColor: COLOURS.scout.body }} />
    <View style={{ position: 'absolute', left: c - 34, top: 8, width: 68, height: 48, borderRadius: 4, borderWidth: 2, borderColor: r.frame, backgroundColor: r.window }}>
      <View style={{ position: 'absolute', left: 31, top: 0, bottom: 0, width: 2, backgroundColor: r.frame }} />
      <View style={{ position: 'absolute', top: 21, left: 0, right: 0, height: 2, backgroundColor: r.frame }} />
      <View style={{ position: 'absolute', right: 8, top: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF3C8' }} />
    </View>
    <View style={{ position: 'absolute', left: c + 97, top: 17, width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: r.edge }}>
      <View style={{ position: 'absolute', left: 10, top: 4, width: 2, height: 8, backgroundColor: r.edge }} />
      <View style={{ position: 'absolute', left: 11, top: 11, width: 6, height: 2, backgroundColor: r.edge }} />
    </View>
  </View>;
}

function Monitor({ w, r, children }: { w: number; r: Room; children: ReactNode }) {
  return <View pointerEvents="none" style={{ position: 'absolute', right: w * 0.14, bottom: 52, width: 34, height: 26, borderWidth: 2, borderColor: r.bezel, borderRadius: 4, backgroundColor: r.screen, padding: 2 }}>
    {children}
    <View style={{ position: 'absolute', left: 14, bottom: -8, width: 2, height: 6, backgroundColor: r.bezel }} />
  </View>;
}

/** The monitor's face: dark when free, lines while working, pink with the question's mark when it needs her. */
function Screen({ c, t, r }: { c: A.OfficeMember; t: Look; r: Room }) {
  if (A.waitsOnYou(c)) return <View style={{ flex: 1, backgroundColor: '#FFE9E3', alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: t.pink, fontSize: 12, lineHeight: 13, fontWeight: '800' }}>{c.ask?.kind === 'spend' ? '$' : '!'}</Text>
  </View>;
  return <View style={{ flex: 1, backgroundColor: r.screen, padding: 2, gap: 2, justifyContent: 'center' }}>
    {c.ring === 'working' && [80, 55, 70].map((w) => <View key={w} style={{ height: 2, width: `${w}%`, backgroundColor: r.edge, opacity: 0.55 }} />)}
  </View>;
}

function Sofa({ r }: { r: Room }) {
  return <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 30, height: 16, backgroundColor: r.sofa, borderTopWidth: 2, borderBottomWidth: 2, borderColor: r.sofaDark }} />;
}

/** The card over a seat, its foot just above the figure and what they made, its tail `tail` points off centre at the
 *  figure: a name and one line, the typing dots while working, or what `children` puts under the name (the quiet
 *  needs-you cue). Two lines at most, inside its own seat. */
function Bubble({ t, tone, dot: mark, name, line, typing, tail: off = 0, children }: { t: Look; tone: string; dot?: string; name: string; line?: string; typing?: boolean; tail?: number; children?: ReactNode }) {
  const tail: ViewStyle = { position: 'absolute', left: '50%', bottom: -5, marginLeft: off - 4, width: 8, height: 8, backgroundColor: t.surface, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: tone, transform: [{ rotate: '45deg' }] };
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 4, right: 4, bottom: BUB, backgroundColor: t.surface, borderWidth: 1.5, borderColor: tone, borderRadius: 12, paddingHorizontal: 7, paddingTop: 4, paddingBottom: 5, gap: 3 }}>
    <View pointerEvents="none" style={tail} />
    <Text numberOfLines={1} style={{ fontFamily: 'Inter', fontSize: 12.5, lineHeight: 15, fontWeight: '600', color: t.ink }}>{name}</Text>
    {children ?? <View pointerEvents="none" style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
      {typing ? <View style={{ flexDirection: 'row', gap: 2 }}>{[0, 1, 2].map((i) => <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: t.green, opacity: 0.7 }} />)}</View>
        : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: mark ?? tone }} />}
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'Inter', fontSize: 11, lineHeight: 14, fontWeight: '500', color: t.ink2 }}>{line}</Text>
    </View>}
  </View>;
}

/** A small label pill over the room, in the app's own type. */
function Tag({ t, children }: { t: Look; children: ReactNode }) {
  return <View style={{ backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
    <Text style={{ fontFamily: 'Inter', fontSize: 12, lineHeight: 16, fontWeight: '600', color: t.ink, textAlign: 'center' }}>{children}</Text>
  </View>;
}
