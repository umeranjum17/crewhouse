// The office at the top of the phone's Home: one flat room, front on like a cut-open dollhouse, the same room the web
// draws (web/src/office.tsx, same sizes in points). A.floorPlan (web/src/adapter.ts) says who sits where at any crew
// size: a desk for Chief and each helper on a job of yours, the lounge sofa for everyone else, "+N more" past two rows
// of each, so a bubble lives in its own seat and never covers another. The crew are the mascot sprites from
// web/src/art.ts (./marks.ts); the room's colours are tokens.ts `room`. Every word and mood comes from A.office and
// A.officeEvent: a member's room holds only their own jobs, and a helper busy with someone else's reads "Busy with
// another job" and nothing more. It moves only when something lands, through ./motion.ts: a quiet room runs no
// animation and no timer.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Pressable, Text, View, type ViewStyle } from 'react-native';
import * as A from '../../web/src/adapter.ts';
import type { Json } from '../../web/src/api.ts';
import { PALS as COLOURS, type Mood } from '../../web/src/art.ts';
import { color, room as ROOM } from '../../web/src/tokens.ts';
import { onLive } from './link';
import { PALS } from './marks';
import * as motion from './motion';

type Look = typeof color.day;
type Room = typeof ROOM.day;
const OUT = 'Out of reach for now';
const DESK_H = 156, LOUNGE_H = 96, FLOOR = 12;

/** How a helper reads to a screen reader, in the room's own words. */
const said = (c: A.OfficeMember) => (c.busyElsewhere ? `${c.name}, ${A.BUSY_ELSEWHERE.toLowerCase()}`
  : A.waitsOnYou(c) ? `${c.name} needs you` : c.ring === 'working' ? `${c.name}, working on ${c.status}` : `${c.name}, ${c.status.toLowerCase()}`);

/** The room, `width` points wide. Tapping a helper opens its desk (`onDesk`), Review its question (`onAsk`), Chief his
 *  chat, the tray the Things. */
export function Office({ state, night, offline, width, onChief, onDesk, onAsk, onTray }: {
  state: Json; night: boolean; offline: boolean; width: number;
  onChief: () => void; onDesk: (c: A.OfficeMember) => void; onAsk: (c: A.Card) => void; onTray: () => void;
}) {
  const view = useOffice(state);
  // What this phone kept says how things were: while out of reach nobody claims to be busy (App.tsx OUT).
  const crew = offline ? view.crew.map((c) => ({ ...c, mood: 'rest' as Mood, ring: '' as const, busyElsewhere: false, ask: undefined, status: OUT, step: '', steps: [] })) : view.crew;
  const chief = offline ? { mood: 'rest' as Mood, line: OUT } : view.chief;
  const t = night ? color.night : color.day;
  const r = night ? ROOM.night : ROOM.day;
  const reduce = motion.useReduceMotion();
  const awake = motion.useAwake();
  const [all, setAll] = useState(false);
  // What was on the desks when the room opened is simply there; only things arriving later drop in.
  const seen = useRef<Set<string> | null>(null);
  seen.current ??= new Set(crew.flatMap((c) => c.things.map((f) => f.url)));
  const plan = A.floorPlan(crew, width, all);
  const folds = all && A.floorPlan(crew, width).more > 0;
  // Whole points: fractional seats add up past the row in Yoga's floats and wrap the last one onto a line of its own.
  const dw = Math.floor(width / plan.cols), lw = Math.floor(width / plan.loungeCols);
  const day = new Date().setHours(0, 0, 0, 0);
  const today = view.done.filter((d) => d.at >= day).length; // the tray holds today's, as Home's count does (A.homeCounts)
  const calm = offline ? OUT : crew.some((c) => c.ring || c.ask) ? '' : !crew.length ? 'Nothing on the go yet.'
    : `Nothing of yours on the go. ${crew.some((c) => c.busyElsewhere) ? 'Some of the crew are busy with other jobs.' : 'The crew is free.'}`;
  const sofas = (plan.loungeCols - ((plan.lounge.length + (plan.more > 0 || folds ? 1 : 0)) % plan.loungeCols)) % plan.loungeCols;
  const byId = new Map(view.crew.map((c) => [c.id, c]));
  return (
    <View style={{ width, backgroundColor: r.wall, overflow: 'hidden' }}>
      {Array.from({ length: Math.ceil(width / 24) }, (_, i) => <View key={i} pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: i * 24 + 18, width: 6, backgroundColor: r.stripe }} />)}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingTop: 8, minHeight: 34 }}>
        {!!calm && <Text style={{ flex: 1, fontFamily: 'Inter', fontSize: 12.5, lineHeight: 16, fontWeight: '500', color: t.ink2 }}>{calm}</Text>}
        <Pressable onPress={onTray} accessibilityRole="button" accessibilityLabel={`Your tray: ${today} done today`} hitSlop={8} style={{ marginLeft: 'auto' }}>
          <Tag t={t}>{`Your tray · ${today}`}</Tag>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Cell w={dw} h={DESK_H} r={r} label={`Chief: ${chief.line}`} onPress={onChief}>
          <View pointerEvents="none" style={{ position: 'absolute', left: dw / 2 - 46, bottom: FLOOR, width: 92, height: 58, backgroundColor: r.sofa, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomWidth: 6, borderColor: r.sofaDark }} />
          <motion.Hop beat={view.chief.mood} reduce={reduce} awake={awake} style={{ position: 'absolute', left: dw / 2 - 36, bottom: 20 }}>
            <Image source={PALS[`chief-${chief.mood}${night ? '-night' : ''}`]} style={{ width: 72, height: 75 }} />
          </motion.Hop>
          <View pointerEvents="none" style={{ position: 'absolute', left: dw / 2 - 54, bottom: FLOOR, width: 108, height: 16, backgroundColor: r.sofa, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomWidth: 4, borderColor: r.sofaDark }} />
          <Bubble t={t} tone={view.chief.mood === 'ask' && !offline ? t.pink : view.chief.mood === 'work' && !offline ? t.green : t.line2} name="Chief" line={chief.line} />
        </Cell>
        {plan.desks.map((c) => {
          const live = byId.get(c.id) ?? c;
          const needs = A.waitsOnYou(c);
          return <Cell key={c.id} w={dw} h={DESK_H} r={r} label={said(c)} onPress={() => onDesk(c)} onReview={needs && c.ask ? () => onAsk(c.ask!) : undefined}>
            <motion.Hop beat={`${live.ring}|${live.mood}|${live.things.length}|${live.ask?.id ?? ''}`} times={live.mood === 'happy' ? 2 : 1} reduce={reduce} awake={awake}
              style={{ position: 'absolute', left: dw / 2 - 46, bottom: 26 }}>
              <Pal id={`${c.kind}-${c.mood}`} dot={3} step={live.step} reduce={reduce} awake={awake} />
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
            {needs && c.ask
              ? <Bubble t={t} tone={t.pink} name={c.name}>
                <Pressable onPress={() => onAsk(c.ask!)} accessibilityRole="button" accessibilityLabel={`Review what ${c.name} needs: ${c.ask.head}`} hitSlop={6}
                  style={{ backgroundColor: t.pink, borderRadius: 999, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: 'Inter', fontSize: 12, lineHeight: 16, fontWeight: '600', color: night ? '#1B1A1F' : '#FFFFFF', textAlign: 'center' }}>Review ›</Text>
                </Pressable>
              </Bubble>
              : <Bubble t={t} tone={c.ring === 'working' ? t.green : t.line2} name={c.name} line={c.step || c.status} typing={c.ring === 'working'} />}
          </Cell>;
        })}
        {Array.from({ length: plan.spare }, (_, i) => <Cell key={`spare${i}`} w={dw} h={DESK_H} r={r}>
          {i % 2 ? <><Desk w={dw} r={r} /><Monitor w={dw} r={r}><View style={{ flex: 1, backgroundColor: r.screen }} /></Monitor></>
            : <>
              <View style={{ position: 'absolute', left: dw / 2 - 27, top: 22, width: 54, height: 44, backgroundColor: r.window, borderWidth: 4, borderColor: r.frame }}>
                <View style={{ position: 'absolute', left: 21.5, top: 0, bottom: 0, width: 3, backgroundColor: r.frame }} />
                <View style={{ position: 'absolute', top: 16.5, left: 0, right: 0, height: 3, backgroundColor: r.frame }} />
              </View>
              <View style={{ position: 'absolute', left: dw / 2 - 18, bottom: FLOOR + 16, width: 36, height: 26, borderRadius: 14, backgroundColor: r.leaf }} />
              <View style={{ position: 'absolute', left: dw / 2 - 10, bottom: FLOOR, width: 20, height: 18, backgroundColor: r.pot }} />
            </>}
        </Cell>)}
      </View>
      {(plan.lounge.length > 0 || plan.more > 0 || folds) && <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {plan.lounge.map((c) => <Cell key={c.id} w={lw} h={LOUNGE_H} r={r} lounge label={said(c)} onPress={() => onDesk(c)}>
          <motion.Hop beat={`${byId.get(c.id)?.ring}|${byId.get(c.id)?.mood}|${c.busyElsewhere}`} reduce={reduce} awake={awake} style={{ position: 'absolute', left: lw / 2 - 20, bottom: 42 }}>
            <Pal id={`${c.kind}-${c.mood}`} dot={2} />
          </motion.Hop>
          <Sofa r={r} />
          <View pointerEvents="none" style={{ position: 'absolute', left: 3, right: 3, bottom: 14, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.status === 'Up next' ? t.amber : c.busyElsewhere ? t.mute : t.line2 }} />
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: 'Inter', fontSize: 11.5, lineHeight: 14, fontWeight: '600', color: t.ink, backgroundColor: t.surface,
              borderRadius: 999, borderWidth: 1, borderColor: t.line, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' }}>{c.name}</Text>
          </View>
        </Cell>)}
        {(plan.more > 0 || folds) && <Cell w={lw} h={LOUNGE_H} r={r} lounge>
          <Sofa r={r} />
          <Pressable onPress={() => setAll(!folds)} accessibilityRole="button" accessibilityLabel={folds ? 'Show fewer of the crew' : `Show ${plan.more} more of the crew`}
            style={{ position: 'absolute', top: 14, left: 6, right: 6, bottom: 18, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.line2, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'Inter', fontSize: 12.5, lineHeight: 16, fontWeight: '600', color: t.ink, textAlign: 'center' }}>{folds ? 'Show fewer' : `+${plan.more} more`}</Text>
          </Pressable>
        </Cell>}
        {Array.from({ length: sofas }, (_, i) => <Cell key={`sofa${i}`} w={lw} h={LOUNGE_H} r={r} lounge><Sofa r={r} /></Cell>)}
      </View>}
    </View>
  );
}

/** The office view: the snapshot, moved by live events until the next refresh starts it again. */
function useOffice(state: Json) {
  const base = useMemo(() => A.office(state, { busyElsewhere: true }), [state]);
  const [live, setLive] = useState<A.OfficeView | null>(null);
  const from = useRef(base);
  from.current = base;
  useEffect(() => { setLive(null); }, [base]);
  useEffect(() => onLive((e) => setLive((v) => A.officeEvent(v ?? from.current, e))), []);
  return live ?? base;
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
function Pal({ id, dot, step, reduce = true, awake = false }: { id: string; dot: number; step?: string; reduce?: boolean; awake?: boolean }) {
  const blink = motion.useBlink(step, reduce, awake);
  const src = PALS[blink ? id.replace(/-(\w+)$/, '-blink') : id] ?? PALS[id];
  return <Image source={src} style={{ width: 20 * dot, height: 19 * dot }} />;
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
