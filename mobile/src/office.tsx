// The office at the top of the phone's Home: one flat room, front on like a cut-open dollhouse, the same room the web
// draws (web/src/office.tsx, same sizes in points). A.floorPlan (web/src/adapter.ts) hot-desks it: the room never
// grows, four desks go to whoever waits on you and then whoever is working, a three-seat lounge takes the rest and
// "+N" counts everyone else. Under the room the dock is its tappable, screen-reader index: every helper the one who
// matters most first (A.roster), so whoever is only counted under "+N" is still one tap away. The crew are the
// mascot sprites from web/src/art.ts (./marks.ts); the room's colours are tokens.ts `room`. Every word, count and
// Review comes from the one A.office view Home also reads (useOffice). It moves only when something lands, through
// ./motion.ts: a quiet room runs no animation or timer.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';
import * as A from '../../web/src/adapter.ts';
import type { Json } from '../../web/src/api.ts';
import { PALS as COLOURS } from '../../web/src/art.ts';
import { color, room as ROOM } from '../../web/src/tokens.ts';
import { onLive } from './link';
import { PALS } from './marks';
import * as motion from './motion';

type Look = typeof color.day;
type Room = typeof ROOM.day;
const DESK_H = 156, LOUNGE_H = 96, FLOOR = 12, COLS = 3;

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
      {Array.from({ length: Math.ceil(width / 24) }, (_, i) => <View key={i} pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: i * 24 + 18, width: 6, backgroundColor: r.stripe }} />)}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingTop: 8, minHeight: 34 }}>
        <Pressable onPress={onTray} accessibilityRole="button" accessibilityLabel={`Your tray: ${view.counts.done} done today`} hitSlop={8} style={{ marginLeft: 'auto' }}>
          <Tag t={t}>{`Your tray · ${view.counts.done}`}</Tag>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Cell w={dw} h={DESK_H} r={r} label={`Chief: ${chief.line}`} onPress={onChief} onReview={chiefAsk ? () => onAsk(chiefAsk) : undefined}>
          <View pointerEvents="none" style={{ position: 'absolute', left: dw / 2 - 46, bottom: FLOOR, width: 92, height: 58, backgroundColor: r.sofa, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomWidth: 6, borderColor: r.sofaDark }} />
          <motion.Hop beat={chief.mood} reduce={reduce} awake={awake} style={{ position: 'absolute', left: dw / 2 - 36, bottom: 20 }}>
            <Image source={PALS[`chief-${chief.mood}${night ? '-night' : ''}`]} style={{ width: 72, height: 75 }} />
          </motion.Hop>
          <View pointerEvents="none" style={{ position: 'absolute', left: dw / 2 - 54, bottom: FLOOR, width: 108, height: 16, backgroundColor: r.sofa, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomWidth: 4, borderColor: r.sofaDark }} />
          {chiefAsk ? <Bubble t={t} tone={t.pink} name="Chief"><Review t={t} night={night} label={`Review what Chief needs: ${chiefAsk.head}`} onPress={() => onAsk(chiefAsk)} /></Bubble>
            : <Bubble t={t} tone={chief.mood === 'work' && !offline ? t.green : t.line2} name="Chief" line={offline ? 'Asleep' : chief.mood === 'work' ? 'Working' : 'On watch'} />}
        </Cell>
        {Array.from({ length: nooks }, (_, i) => plan.desks[i]).map((c, i) => {
          if (!c) return <Cell key={`nook${i}`} w={dw} h={DESK_H} r={r}><Desk w={dw} r={r} /><Monitor w={dw} r={r}><View style={{ flex: 1, backgroundColor: r.screen }} /></Monitor></Cell>;
          const k = A.seatOf(c);
          return <Cell key={c.id} w={dw} h={DESK_H} r={r} label={said(c)} onPress={() => onDesk(c)} onReview={c.ask ? () => onAsk(c.ask!) : undefined}>
            <motion.Hop beat={`${c.ring}|${c.mood}|${c.things.length}|${c.ask?.id ?? ''}`} times={c.mood === 'happy' ? 2 : 1} reduce={reduce} awake={awake}
              style={{ position: 'absolute', left: dw / 2 - 46, bottom: 26 }}>
              <Pal id={`${c.kind}-${c.mood}`} dot={3} step={c.step} reduce={reduce} awake={awake} second={c.second} />
            </motion.Hop>
            <Desk w={dw} r={r} />
            <Monitor w={dw} r={r}><Screen c={c} t={t} r={r} /></Monitor>
            {c.things.length > 0 && <View pointerEvents="none" style={{ position: 'absolute', right: dw * 0.14, top: 70, flexDirection: 'row', gap: 3, alignItems: 'flex-end' }}>
              {c.things.slice(-2).map((f) => <motion.Land key={f.url} fresh={!seen.current!.has(f.url)} reduce={reduce} awake={awake}>
                {f.kind === 'image' || f.kind === 'video'
                  ? <View style={{ width: 15, height: 15, backgroundColor: COLOURS[c.kind].body, borderWidth: 2, borderColor: '#fff' }} />
                  : <View style={{ width: 13, height: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: r.edge, paddingHorizontal: 2, paddingTop: 3, gap: 1 }}>
                    {[0, 1, 2].map((i) => <View key={i} style={{ height: 1, backgroundColor: '#B9B3AA' }} />)}
                  </View>}
              </motion.Land>)}
            </View>}
            {c.ask
              ? <Bubble t={t} tone={t.pink} name={c.name}><Review t={t} night={night} label={`Review what ${c.name} needs: ${c.ask.head}`} onPress={() => onAsk(c.ask!)} /></Bubble>
              : <Bubble t={t} tone={k === 'chat' ? t.pink : t.green} name={c.name} line={A.SEAT_WORDS[k]} typing={k === 'working'} />}
          </Cell>;
        })}
        {Array.from({ length: spare }, (_, i) => <Cell key={`spare${i}`} w={dw} h={DESK_H} r={r}>
          <View style={{ position: 'absolute', left: dw / 2 - 27, top: 22, width: 54, height: 44, backgroundColor: r.window, borderWidth: 4, borderColor: r.frame }}>
            <View style={{ position: 'absolute', left: 21.5, top: 0, bottom: 0, width: 3, backgroundColor: r.frame }} />
            <View style={{ position: 'absolute', top: 16.5, left: 0, right: 0, height: 3, backgroundColor: r.frame }} />
          </View>
          <View style={{ position: 'absolute', left: dw / 2 - 18, bottom: FLOOR + 16, width: 36, height: 26, borderRadius: 14, backgroundColor: r.leaf }} />
          <View style={{ position: 'absolute', left: dw / 2 - 10, bottom: FLOOR, width: 20, height: 18, backgroundColor: r.pot }} />
        </Cell>)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: A.LOUNGE_SEATS }, (_, i) => plan.lounge[i]).map((c, i) => c ? <Cell key={c.id} w={lw} h={LOUNGE_H} r={r} lounge label={said(c)} onPress={() => onDesk(c)}>
          <motion.Hop beat={`${c.ring}|${c.mood}`} reduce={reduce} awake={awake} style={{ position: 'absolute', left: lw / 2 - 20, bottom: 42 }}>
            <Pal id={`${c.kind}-${c.mood}`} dot={2} second={c.second} />
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
      </View>
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
          <Pal id={`${c.kind}-${c.mood}`} dot={1.6} second={c.second} />
        </View>
        <Text numberOfLines={1} style={{ fontFamily: 'Inter', fontSize: 11.5, lineHeight: 14, fontWeight: '600', color: t.ink, maxWidth: 56 }}>{c.name}</Text>
      </Pressable>;
    })}
  </ScrollView>;
}

const dot = (t: Look, k: A.Seat) => (k === 'needs' || k === 'chat' ? t.pink : k === 'working' ? t.green : k === 'failed' ? t.danger : k === 'next' ? t.amber : t.line2);

/** Review, inside a seat's card: opens the same sheet as Needs you. */
function Review({ t, night, label, onPress }: { t: Look; night: boolean; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={{ backgroundColor: t.pink, borderRadius: 999, paddingVertical: 3 }}>
    <Text style={{ fontFamily: 'Inter', fontSize: 12, lineHeight: 16, fontWeight: '600', color: night ? '#1B1A1F' : '#FFFFFF', textAlign: 'center' }}>Review ›</Text>
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
    {lounge && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 30, height: 20, backgroundColor: r.sofaDark }} />}
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: FLOOR + 3, backgroundColor: r.floor, borderTopWidth: 3, borderColor: r.skirt }}>
      {Array.from({ length: Math.floor(w / 32) }, (_, i) => <View key={i} style={{ position: 'absolute', left: i * 32 + 30, top: 0, bottom: 0, width: 2, backgroundColor: r.seam }} />)}
    </View>
  </>;
  if (!onPress) return <View style={{ width: w, height: h }}>{floor}{children}</View>;
  // A screen reader reads the seat as one button, so the Review inside it is offered as the seat's own action too.
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ width: w, height: h }}
    accessibilityActions={onReview ? [{ name: 'review', label: 'Review' }] : undefined} onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'review') onReview?.(); }}>{floor}{children}</Pressable>;
}

/** A mascot sprite, `dot` points a pixel (the PNGs carry an ink edge a pixel wide), blinking for a moment on news. */
function Pal({ id, dot, step, reduce = true, awake = false, second }: { id: string; dot: number; step?: string; reduce?: boolean; awake?: boolean; second?: boolean }) {
  const blink = motion.useBlink(step, reduce, awake);
  const src = PALS[blink ? id.replace(/-(\w+)$/, '-blink') : id] ?? PALS[id];
  // Another helper of a kind is hue-shifted, as on the web (where the platform has no filter, its name still shows).
  const img = <Image source={src} style={{ width: 20 * dot, height: 19 * dot }} />;
  return second ? <View style={{ filter: [{ hueRotate: '48deg' }] }}>{img}</View> : img;
}

function Desk({ w, r }: { w: number; r: Room }) {
  return <View pointerEvents="none" style={{ position: 'absolute', left: w * 0.1, right: w * 0.1, bottom: FLOOR, height: 24, backgroundColor: r.desk, borderTopWidth: 4, borderTopColor: r.top, borderBottomWidth: 3, borderBottomColor: r.edge, alignItems: 'center' }}>
    <View style={{ marginTop: 7, width: '26%', height: 3, backgroundColor: r.edge }} />
  </View>;
}

function Monitor({ w, r, children }: { w: number; r: Room; children: ReactNode }) {
  return <View pointerEvents="none" style={{ position: 'absolute', right: w * 0.14, bottom: 36, width: 30, height: 22, backgroundColor: r.bezel, padding: 3 }}>
    {children}
    <View style={{ position: 'absolute', left: 11, bottom: -4, width: 8, height: 4, backgroundColor: r.bezel }} />
  </View>;
}

/** The monitor's face: dark when free, lines while working, pink with the question's mark when it needs her. */
function Screen({ c, t, r }: { c: A.OfficeMember; t: Look; r: Room }) {
  if (A.waitsOnYou(c)) return <View style={{ flex: 1, backgroundColor: `${t.pink}55`, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: t.pink, fontSize: 12, lineHeight: 13, fontWeight: '800' }}>{c.ask?.kind === 'spend' ? '$' : '!'}</Text>
  </View>;
  return <View style={{ flex: 1, backgroundColor: r.screen, padding: 2, gap: 2, justifyContent: 'center' }}>
    {c.ring === 'working' && [80, 55, 70].map((w) => <View key={w} style={{ height: 2, width: `${w}%`, backgroundColor: '#A9A3C8' }} />)}
  </View>;
}

function Sofa({ r }: { r: Room }) {
  return <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 34, height: 14, backgroundColor: r.sofa, borderBottomWidth: 3, borderColor: r.sofaDark }} />;
}

/** The card over a seat: a name and one line, the typing dots while working, or what `children` puts under the name
 *  (the Review). Two lines at most, inside its own seat. */
function Bubble({ t, tone, name, line, typing, children }: { t: Look; tone: string; name: string; line?: string; typing?: boolean; children?: ReactNode }) {
  const tail: ViewStyle = { position: 'absolute', left: '50%', bottom: -5, marginLeft: -4, width: 8, height: 8, backgroundColor: t.surface, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: tone, transform: [{ rotate: '45deg' }] };
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 4, right: 4, top: 6, backgroundColor: t.surface, borderWidth: 1.5, borderColor: tone, borderRadius: 12, paddingHorizontal: 7, paddingTop: 4, paddingBottom: 5, gap: 3 }}>
    <View pointerEvents="none" style={tail} />
    <Text numberOfLines={1} style={{ fontFamily: 'Inter', fontSize: 12.5, lineHeight: 15, fontWeight: '600', color: t.ink }}>{name}</Text>
    {children ?? <View pointerEvents="none" style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
      {typing ? <View style={{ flexDirection: 'row', gap: 2 }}>{[0, 1, 2].map((i) => <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: t.green, opacity: 0.7 }} />)}</View>
        : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone === t.line2 ? t.line2 : tone }} />}
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
