// The office at the top of the phone's Home: the Studio, an isometric room where Chief and each helper sit at their
// desks. The room is pictures drawn by scripts/office.mjs on the plan in ./studio.ts; the crew are the mascot sprites
// from web/src/art.ts (./marks.ts). Every word and mood comes from the shared view model, A.office and A.officeEvent
// in web/src/adapter.ts: a member's room holds only their own jobs, and a helper busy with someone else's reads
// "Busy with another job" and nothing more. Live events move the room between refreshes. It moves only when
// something lands, through ./motion.ts: a quiet room runs no animation and no timer.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Pressable, Text, View, type ViewStyle } from 'react-native';
import * as A from '../../web/src/adapter.ts';
import type { Json } from '../../web/src/api.ts';
import { PALS as COLOURS, type Kind, type Mood } from '../../web/src/art.ts';
import { color } from '../../web/src/tokens.ts';
import { onLive } from './link';
import { OFFICE, PALS } from './marks';
import * as motion from './motion';
import { CHIEF, CHIEF_LIFT, depth, HW, P, SLOTS, STAGE, standAt, TRAY, WALLED } from './studio';

type Look = typeof color.day;
type Box = [number, number, number, number];
type Place = { position: 'absolute'; left: number; top: number; width: number; height: number; zIndex: number };
type At = (x: number, y: number, w?: number, h?: number, z?: number) => Place;
const BOX: Record<string, Box> = require('../assets/office/pieces.json');
const SPRITE = 0.75; // stage points per sprite pixel: a pal (18 dots of 8 px) stands 108 points wide
const OUT = 'Out of reach for now';

/** How a helper reads to a screen reader, in the room's own words. */
const said = (c: A.OfficeMember) => (c.busyElsewhere ? `${c.name}, ${A.BUSY_ELSEWHERE.toLowerCase()}`
  : c.ring === 'needs' ? `${c.name} needs you` : c.ring === 'working' ? `${c.name}, working on ${c.status}` : `${c.name}, ${c.status.toLowerCase()}`);

/** The room, `width` points wide. Tapping a helper opens its desk (`onDesk`), Chief his chat, the tray the Things. */
export function Office({ state, night, offline, width, onChief, onDesk, onTray }: {
  state: Json; night: boolean; offline: boolean; width: number;
  onChief: () => void; onDesk: (c: A.OfficeMember) => void; onTray: () => void;
}) {
  const view = useOffice(state);
  // What this phone kept says how things were: while out of reach nobody claims to be busy (App.tsx OUT).
  const crew = offline ? view.crew.map((c) => ({ ...c, mood: 'rest' as Mood, ring: '' as const, busyElsewhere: false, ask: undefined })) : view.crew;
  const chief = offline ? { mood: 'rest' as Mood, line: OUT } : view.chief;
  const t = night ? color.night : color.day;
  const theme = night ? 'night' : 'day';
  const reduce = motion.useReduceMotion();
  const awake = motion.useAwake();
  // What was on the desks when the room opened is simply there; only things arriving later drop in.
  const seen = useRef<Set<string> | null>(null);
  seen.current ??= new Set(crew.flatMap((c) => c.things.map((f) => f.url)));
  const k = width / STAGE.w;
  const at: At = (x, y, w = 0, h = 0, z = 0) => ({ position: 'absolute', left: x * k, top: y * k, width: w * k, height: h * k, zIndex: z });
  const piece = (name: string, dx = 0, dy = 0, z = 0) => {
    const [x, y, w, h] = BOX[`${name}-${theme}`];
    return <Image key={`${name}@${dx},${dy}`} source={OFFICE[`${name}-${theme}`]} style={at(x + dx, y + dy, w, h, z)} />;
  };
  const shown = crew.slice(0, SLOTS.length); // ponytail: six desks; a bigger crew still reads in full in the lists below
  const [x0, y0] = P(...SLOTS[0]);
  const tray = P(TRAY[0] - 0.5, TRAY[1] + 1.25);
  const day = new Date().setHours(0, 0, 0, 0);
  const today = view.done.filter((d) => d.at >= day); // the tray holds today's, as Home's count does (A.homeCounts)
  const calm = offline ? OUT : crew.some((c) => c.ring) ? ''
    : `Nothing of yours on the go. ${crew.some((c) => c.busyElsewhere) ? 'Some of the crew are busy with other jobs.' : 'The crew is free.'}`;
  return (
    <View style={{ width, height: STAGE.h * k }}>
      <Image source={OFFICE[`room-${theme}`]} style={at(0, 0, STAGE.w, STAGE.h)} accessibilityIgnoresInvertColors />
      {shown.length <= WALLED && piece('sofa', 0, 0, depth(3.5, 5.1))}
      {shown.map((c, i) => {
        const [cx, cy] = SLOTS[i], [sx, sy] = P(cx, cy), dx = sx - x0, dy = sy - y0;
        return [
          piece('pool', dx, dy, 1),
          i < WALLED && piece(`wall-${c.kind}`, dx, dy, depth(cx, cy, -45)),
          <Pal key={`pal-${c.id}`} c={c} at={at} k={k} p={P(...standAt(SLOTS[i]))} z={depth(cx, cy, -25)} night={night} t={t}
            reduce={reduce} awake={awake} onPress={() => onDesk(c)} />,
          piece('desk', dx, dy, depth(cx, cy)),
          <Mug key={`mug-${c.id}`} kind={c.kind} style={at(...P(cx - 0.2, cy + 0.32, 28), 0, 0, depth(cx, cy, 1))} k={k} />,
          <View key={`screen-${c.id}`} aria-hidden pointerEvents="none" style={plane(at, P(cx + 0.22, cy - 0.235, 73), 0.74 * HW, 32, depth(cx, cy, 6))}>
            <Screen c={c} night={night} k={k} />
          </View>,
          ...onTheDesk(c, cx, cy).map(([f, spot, z, pinned]) => <View key={f.url} aria-hidden pointerEvents="none" style={plane(at, spot, pinned ? 0.5 * HW : 22, pinned ? 36 : 30, z, !pinned)}>
            <motion.Land fresh={!seen.current!.has(f.url)} reduce={reduce} awake={awake} style={{ flex: 1 }}>
              {pinned ? <Pin kind={f.kind} tint={COLOURS[c.kind]} k={k} /> : <Paper night={night} k={k} />}
            </motion.Land>
          </View>),
        ];
      })}
      <Chief mood={chief.mood} line={chief.line} at={at} k={k} night={night} reduce={reduce} awake={awake} onPress={onChief} />
      {piece('arm', 0, 0, depth(1.8, 8.1, 10))}
      {piece('tray', 0, 0, depth(...TRAY))}
      {today.slice(0, 4).map((d, i, all) => {
        const span = Math.min(2.5, (all.length - 1) * 0.62);
        const gx = TRAY[0] - 0.25 - span / 2 + (all.length > 1 ? (i * span) / (all.length - 1) : 0);
        return <View key={d.id} aria-hidden pointerEvents="none" style={plane(at, P(gx, TRAY[1] - 0.05 + (i % 2) * 0.14, 74), 0.56 * HW, 40, depth(gx, TRAY[1] + 0.2, 8))}>
          <TrayCard d={d} kind={crew.find((c) => c.id === d.helper)?.kind ?? 'pip'} night={night} k={k} />
        </View>;
      })}
      <View style={{ position: 'absolute', zIndex: 900, left: tray[0] * k - 80, top: tray[1] * k - 12, width: 160, alignItems: 'center' }}>
        <Pressable onPress={onTray} accessibilityRole="button" accessibilityLabel={`Your tray: ${today.length} done today`} hitSlop={10}>
          <Tag t={t}>{`Your tray · ${today.length}`}</Tag>
        </Pressable>
      </View>
      {!!calm && <View pointerEvents="none" style={{ position: 'absolute', zIndex: 900, left: 16, right: 16, top: STAGE.h * k * 0.46, alignItems: 'center' }}>
        <Tag t={t} quiet>{calm}</Tag>
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

/** A flat thing on a wall-like plane facing down-left (a screen, a picture), or lying on a desk top (`flat`). */
function plane(at: At, [x, y]: [number, number], w: number, h: number, z: number, flat = false): ViewStyle {
  return { ...at(x, y, w, h, z), transformOrigin: 'left top',
    transform: flat ? [{ scaleY: 0.5 }, { rotate: '45deg' }, { scale: Math.SQRT2 }] : [{ skewY: '26.565deg' }] };
}

/** What a helper has made for this job, where it sits: pictures and videos stand on the desk, pages lie on it (the
 *  latest two of each). A sheet shows on the screen instead. */
function onTheDesk(c: A.OfficeMember, cx: number, cy: number) {
  const pins = c.things.filter((f) => f.kind === 'image' || f.kind === 'video').slice(-2);
  const pages = c.things.filter((f) => f.kind === 'page' || f.kind === 'doc').slice(-2);
  return [
    ...pins.map((f, i): [A.FileView, [number, number], number, boolean] => [f, P(cx - 0.08 + i * 0.56, cy + 0.36 - i * 0.1, 64), depth(cx, cy, 8 + i), true]),
    ...pages.map((f, i): [A.FileView, [number, number], number, boolean] => [f, P(cx - 0.92 + i * 0.08, cy - 0.3 + i * 0.05, 30 + i * 3), depth(cx, cy, 7), false]),
  ];
}

/** A mascot standing in the room: the dots, a pale sticker edge behind them so the room never shows between the
 *  dots, a floor ring when working (green) or needing you (pink), and a hop and a blink when news lands. */
function Sprite({ id, w, h, k, night, blink }: { id: string; w: number; h: number; k: number; night: boolean; blink: boolean }) {
  const src = PALS[blink ? id.replace(/-(\w+)(-night)?$/, '-blink$2') : id] ?? PALS[id];
  const o = 2 * k; // a third of a dot
  return <View style={{ width: w, height: h }}>
    {[[o, o], [-o, -o], [o, -o], [-o, o]].map(([dx, dy]) =>
      <Image key={`${dx}${dy}`} source={src} style={{ position: 'absolute', left: dx, top: dy, width: w, height: h, tintColor: night ? '#211F26' : '#FFFFFF' }} />)}
    <Image source={src} style={{ position: 'absolute', width: w, height: h }} />
  </View>;
}

function Pal({ c, at, k, p: [x, y], z, night, t, reduce, awake, onPress }: {
  c: A.OfficeMember; at: At; k: number; p: [number, number]; z: number; night: boolean; t: Look; reduce: boolean; awake: boolean; onPress: () => void;
}) {
  const w = 144 * SPRITE * k, h = 136 * SPRITE * k;
  const blink = motion.useBlink(c.step, reduce, awake);
  const ring = c.ring === 'needs' ? t.pink : c.ring === 'working' ? t.green : '';
  const r = 42 * k; // the floor ring's half-width
  return <View style={{ ...at(x, y, 0, 0, z) }}>
    <View pointerEvents="none" style={{ position: 'absolute', left: -r, top: -r, width: 2 * r, height: 2 * r, borderRadius: r, backgroundColor: night ? '#0008' : '#54341A22', transform: [{ scaleY: 0.3 }] }} />
    {!!ring && <View pointerEvents="none" style={{ position: 'absolute', left: -r, top: -r, width: 2 * r, height: 2 * r, borderRadius: r, borderWidth: 2.5, borderColor: ring, opacity: c.ring === 'needs' ? 1 : 0.75, transform: [{ scaleY: 0.4 }] }} />}
    {c.ring === 'needs' && <motion.Pulse beat={c.ask?.id ?? c.status} reduce={reduce} awake={awake}
      style={{ position: 'absolute', left: -r, top: -r, width: 2 * r, height: 2 * r, borderRadius: r, borderWidth: 2, borderColor: t.pink }} />}
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={said(c)} hitSlop={8}
      style={{ position: 'absolute', left: -w / 2, top: -h - 18 * k, width: w, height: h }}>
      <motion.Hop beat={`${c.ring}|${c.mood}|${c.things.length}`} times={c.mood === 'happy' ? 2 : 1} reduce={reduce} awake={awake}>
        <Sprite id={`${c.kind}-${c.mood}`} w={w} h={h} k={k} night={night} blink={blink} />
      </motion.Hop>
    </Pressable>
  </View>;
}

function Chief({ mood, line, at, k, night, reduce, awake, onPress }: {
  mood: Mood; line: string; at: At; k: number; night: boolean; reduce: boolean; awake: boolean; onPress: () => void;
}) {
  const [x, y] = P(...CHIEF);
  const w = 176 * SPRITE * k, h = 184 * SPRITE * k;
  return <View style={at(x, y, 0, 0, depth(1.4, 7.6, 2))}>
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Chief: ${line}`} hitSlop={8}
      style={{ position: 'absolute', left: -w / 2, top: -h - CHIEF_LIFT * k, width: w, height: h }}>
      <motion.Hop beat={mood} reduce={reduce} awake={awake}>
        <Sprite id={`chief-${mood}${night ? '-night' : ''}`} w={w} h={h} k={k} night={night} blink={false} />
      </motion.Hop>
    </Pressable>
  </View>;
}

/** A mug in the helper's colour. */
function Mug({ kind, style, k }: { kind: Kind; style: ViewStyle; k: number }) {
  return <View pointerEvents="none" style={style}>
    <View style={{ position: 'absolute', left: -5 * k, top: -11 * k, width: 10 * k, height: 11 * k, borderRadius: 2 * k, backgroundColor: COLOURS[kind].dark }} />
  </View>;
}

/** The monitor: dark when free, soft lines when busy with another job, lines being typed while working, a sheet when
 *  one is on the go, pink with the question's mark when it needs you. */
function Screen({ c, night, k }: { c: A.OfficeMember; night: boolean; k: number }) {
  const t = night ? color.night : color.day;
  const face = { flex: 1, borderRadius: 3 * k, overflow: 'hidden' as const };
  const lines = (tone: string, ws: number[]) => <View style={{ ...face, paddingVertical: 5 * k, paddingHorizontal: 4 * k, gap: 3 * k, backgroundColor: '#2C2A39' }}>
    {ws.map((w, i) => <View key={i} style={{ height: 3 * k, borderRadius: 2 * k, width: `${w}%`, backgroundColor: tone }} />)}
  </View>;
  if (c.ring === 'needs') return <View style={{ ...face, alignItems: 'center', justifyContent: 'center', backgroundColor: night ? '#4A2233' : '#FBD9E4' }}>
    <Text style={{ color: t.pink, fontSize: 24 * k, lineHeight: 28 * k, fontWeight: '800' }}>{c.ask?.kind === 'spend' ? '$' : '!'}</Text>
  </View>;
  if (c.things.some((f) => f.kind === 'sheet')) return <View style={{ ...face, padding: 3 * k, gap: 2 * k, backgroundColor: night ? '#203027' : '#F4FBF6' }}>
    {[0, 1, 2, 3, 4].map((r) => <View key={r} style={{ flexDirection: 'row', gap: 2 * k }}>
      {[1.4, 2.4, 1].map((f, j) => <View key={j} style={{ flex: f, height: 4 * k, borderRadius: 2 * k, backgroundColor: r ? (night ? '#2F6B4A' : '#B9E3C8') : t.green }} />)}
    </View>)}
  </View>;
  if (c.ring === 'working') return lines('#A9A3C8', [80, 60, 90, 45]);
  if (c.busyElsewhere) return lines('#5E5A70', [70, 50, 85]);
  return <View style={{ ...face, backgroundColor: night ? '#16141B' : '#3A3645' }} />;
}

/** A picture or a video's first look, standing in a white frame, in its helper's colours. */
function Pin({ kind, tint, k }: { kind: A.FileView['kind']; tint: { body: string; dark: string }; k: number }) {
  return <View style={{ flex: 1, backgroundColor: '#fff', padding: 2 * k, paddingBottom: 5 * k, borderRadius: k }}>
    <View style={{ flex: 1, backgroundColor: tint.body, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', right: 0, bottom: 0, width: '55%', height: '45%', backgroundColor: tint.dark, opacity: 0.55 }} />
      {kind === 'video' && <Text style={{ color: '#fff', fontSize: 14 * k, lineHeight: 16 * k }}>▶</Text>}
    </View>
  </View>;
}

/** A page lying on the desk. */
function Paper({ night, k }: { night: boolean; k: number }) {
  const paper = night ? '#EDEAE4' : '#FFFFFF';
  return <View style={{ flex: 1, backgroundColor: paper, borderRadius: 2 * k, padding: 4 * k, gap: 4 * k, borderWidth: 0.5, borderColor: '#0002' }}>
    {[70, 90, 80, 60].map((w, i) => <View key={i} style={{ height: 1.5 * k, width: `${w}%`, backgroundColor: '#B9B3AA' }} />)}
  </View>;
}

/** Something finished today, on the tray: its first file's kind, or a tick. */
function TrayCard({ d, kind, night, k }: { d: A.Thing; kind: Kind; night: boolean; k: number }) {
  const f = d.files[0];
  const t = night ? color.night : color.day;
  if (f && (f.kind === 'image' || f.kind === 'video')) return <View style={{ flex: 1, borderWidth: 2 * k, borderColor: '#fff', borderRadius: 3 * k, backgroundColor: COLOURS[kind].body }} />;
  return <View style={{ flex: 1, borderRadius: 3 * k, alignItems: 'center', justifyContent: 'center', backgroundColor: night ? '#EDEAE4' : '#fff', borderWidth: 0.5, borderColor: '#0003' }}>
    <Text style={{ fontSize: 16 * k, lineHeight: 18 * k, fontWeight: '700', color: !f || f.kind === 'sheet' ? t.green : '#56525D' }}>{!f ? '✓' : f.kind === 'sheet' ? '▦' : '▤'}</Text>
  </View>;
}

/** A small label pill over the room, in the app's own type. */
function Tag({ t, quiet, children }: { t: Look; quiet?: boolean; children: ReactNode }) {
  return <View style={{ backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '100%',
    shadowColor: '#14121a', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 }}>
    <Text style={{ fontFamily: 'Inter', fontSize: quiet ? 13 : 12, lineHeight: quiet ? 18 : 16, fontWeight: quiet ? '500' : '600', color: quiet ? t.ink2 : t.ink, textAlign: 'center' }}>{children}</Text>
  </View>;
}
