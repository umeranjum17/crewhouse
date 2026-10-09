// The office as a grouped list (Term look): Needs you / At work / Done today / Resting, every helper in exactly
// one group. Each row shows the helmet in its mood, the current line, one meta line and the one action (the ask's
// own yes, which opens its review). Tapping a row opens that helper's desk. Every word and count comes from the one
// A.office view Home also reads (useOffice). The helmets are still: the think-scan shows while working and nothing
// moves, so the old animation battery budget holds with no code for it.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as A from '../../web/src/adapter.ts';
import type { Json } from '../../web/src/api.ts';
import { helmetDots, helmetOf, type Mood } from '../../web/src/art.ts';
import { color } from '../../web/src/tokens.ts';
import { onLive } from './link';

type Look = typeof color.day;
const today = () => new Date().setHours(0, 0, 0, 0);
/** The latest thing this helper landed today, if any. */
const landed = (c: A.OfficeMember, v: A.OfficeView) =>
  v.done.filter((t) => t.helper === c.id && t.at >= today()).sort((a, b) => b.at - a.at)[0];

type Group = 'needs' | 'work' | 'done' | 'rest';
const TITLES: Record<Group, string> = { needs: 'Waiting', work: 'At work', done: 'Done today', rest: 'Resting' };
/** The Office count line the phone header reads: needs-you rows, at work, done today and resting. The member
 *  buckets partition the crew; the needs number counts every row. */
export const summaryOf = (v: A.OfficeView): string => {
  const needy = v.crew.filter(A.waitsOnYou);
  const work = v.crew.filter((c) => !A.waitsOnYou(c) && ['working', 'quiet'].includes(A.seatOf(c)));
  const done = v.crew.filter((c) => !A.waitsOnYou(c) && !['working', 'quiet', 'failed'].includes(A.seatOf(c)) && landed(c, v));
  const rest = v.crew.length - needy.length - work.length - done.length;
  const n = v.counts.needs;
  return `${n} ${n === 1 ? 'needs' : 'need'} you · ${work.length} at work · ${done.length} done · ${rest} resting`;
};

/** Every helper lands in exactly one group: waiting on you, at work on an open job, done today, or resting. */
const groupOf = (c: A.OfficeMember, v: A.OfficeView): Group => {
  if (A.waitsOnYou(c)) return 'needs';
  const seat = A.seatOf(c);
  if (seat === 'working' || seat === 'quiet') return 'work';
  if (seat !== 'failed' && landed(c, v)) return 'done';
  return 'rest';
};

/** The helmet as dots (art.helmetDots): the phone sets no text in mono, so the shading rides on dot opacity. The
 *  think-scan shows centred while working (a fixed beat); nothing animates. */
function Helmet({ mood, night, size }: { mood: Mood; night: boolean; size: number }) {
  const mode = helmetOf(mood), cols = 20;
  const { rows, pal } = helmetDots(cols, mode, night, mode === 'think' ? 12 : 0);
  const d = size / cols;
  return (
    <View accessible={false} style={{ width: size }}>
      {rows.map((r, y) => (
        <View key={y} style={{ flexDirection: 'row' }}>
          {[...r].map((k, x) => <View key={x} style={{ width: d, height: d, padding: d * 0.06 }}>{pal[k] ? <View style={{ flex: 1, borderRadius: d, backgroundColor: pal[k] }} /> : null}</View>)}
        </View>
      ))}
    </View>
  );
}

/** The row's state word, in the board's own sentence case. */
function State({ c, v, t }: { c: A.OfficeMember; v: A.OfficeView; t: Look }) {
  const g = groupOf(c, v);
  const done = g === 'done' ? landed(c, v) : undefined;
  const word = g === 'needs' ? 'Waiting' : g === 'work' ? (A.seatOf(c) === 'quiet' ? 'Gone quiet' : 'At work')
    : done ? `✓ Done ${A.clock(done.at)}` : A.seatOf(c) === 'failed' ? "Didn't finish" : '○ Resting';
  const col = g === 'needs' ? t.pink : g === 'work' ? (A.seatOf(c) === 'quiet' ? t.amber : t.green)
    : A.seatOf(c) === 'failed' ? t.danger : g === 'done' ? t.ink : t.mute;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      {(g === 'needs' || g === 'work') && <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: col }} />}
      <Text style={{ fontFamily: 'Inter', fontSize: 12.5, lineHeight: 16, fontWeight: '600', color: col }}>{word}</Text>
    </View>
  );
}

/** One helper's row: the helmet, the name and state, the current line, one meta line, the one action. */
function Row({ c, v, t, night, jobTitle, onDesk, onAsk }: { c: A.OfficeMember; v: A.OfficeView; t: Look; night: boolean; jobTitle?: string;
  onDesk: (c: A.OfficeMember) => void; onAsk: (c: A.Card) => void }) {
  const done = landed(c, v);
  const g = groupOf(c, v);
  // Done leads with the finished work itself, as the web panels do; a question without a job shows its latest step.
  const line = c.ask ? c.ask.head : g === 'done' && done!.summary ? done!.summary : c.status;
  const meta0 = jobTitle && (A.seatOf(c) === 'working' || A.seatOf(c) === 'quiet' || A.waitsOnYou(c)) ? jobTitle
    : g === 'done' ? c.status : A.waitsOnYou(c) ? c.step : c.status;
  const meta = meta0 === line ? '' : meta0;
  const yes = c.ask?.choices[0];
  const simple = !!c.ask && !!yes && !c.ask.reply && !c.ask.review && c.ask.kind !== 'routine' && c.ask.kind !== 'plan' && c.ask.evidence !== 'draft';
  // The button wears the ask's own words (its yes, or its flow's label), never a generic one.
  const label = !c.ask ? '' : simple ? yes!.label : c.ask.reply ? `Answer ${c.name}…` : c.ask.review ? 'Review order' : yes?.label ?? 'Review…';
  return (
    <Pressable onPress={() => onDesk(c)} accessibilityRole="button" accessibilityLabel={`${c.name}: ${line}`}
      style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: 1, borderColor: t.line }}>
      <Helmet mood={c.mood} night={night} size={52} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text numberOfLines={1} style={{ fontFamily: 'Inter', fontSize: 15, lineHeight: 20, fontWeight: '600', color: t.ink, flex: 1 }}>{c.name}</Text>
          <State c={c} v={v} t={t} />
        </View>
        <Text style={{ fontFamily: 'Inter', fontSize: 14, lineHeight: 19, fontWeight: '500', color: t.ink }}>{line}</Text>
        {!!meta && <Text numberOfLines={2} style={{ fontFamily: 'Inter', fontSize: 13, lineHeight: 17, color: t.mute }}>{meta}</Text>}
        {c.ask && <Pressable onPress={() => onAsk(c.ask!)} accessibilityRole="button" accessibilityLabel={`${label}: ${c.ask.head}`}
          style={{ alignSelf: 'flex-start', marginTop: 8, backgroundColor: t.pink, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 }}>
          <Text style={{ fontFamily: 'Inter', fontSize: 14, lineHeight: 18, fontWeight: '600', color: '#fff' }}>{label}</Text>
        </Pressable>}
      </View>
    </Pressable>
  );
}

/** One group: its name over a dashed rule, then its rows. */
function Group({ title, t, children }: { title: string; t: Look; children: ReactNode }) {
  return (
    <View style={{ paddingTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 }}>
        <Text style={{ fontFamily: 'Inter', fontSize: 13, lineHeight: 17, fontWeight: '500', color: t.mute }}>{title}</Text>
        <View style={{ flex: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: t.line }} />
      </View>
      {children}
    </View>
  );
}

/** The grouped office. Tapping a row opens that helper's desk, a question's button its review, as before. */
export function Office({ view, night, offline, width, jobs, onChief, onDesk, onAsk, onTray, onCrew }: {
  view: A.OfficeView; night: boolean; offline: boolean; width: number; jobs?: A.Work[];
  onChief: () => void; onDesk: (c: A.OfficeMember) => void; onAsk: (c: A.Card) => void; onTray: () => void; onCrew: () => void;
}) {
  const t = night ? color.night : color.day;
  const titles = useMemo(() => new Map((jobs ?? []).map((w) => [w.helper, w.title])), [jobs]);
  void offline; void width; void onChief; void onTray; void onCrew;
  const groups = (['needs', 'work', 'done', 'rest'] as Group[]).map((g) => [g, view.crew.filter((c) => groupOf(c, view) === g)] as const)
    .filter(([, rows]) => rows.length);
  return (
    <View>
      {groups.map(([g, rows]) => <Group key={g} title={TITLES[g]} t={t}>
        {rows.map((c) => <Row key={c.id} c={c} v={view} t={t} night={night} jobTitle={titles.get(c.id)} onDesk={onDesk} onAsk={onAsk} />)}
      </Group>)}
    </View>
  );
}

/** The office view: the snapshot, moved by live events until the next refresh starts it again. Home reads it once and
 *  hands it to the counts and Needs you, so they can never disagree. While out of reach, what this
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
