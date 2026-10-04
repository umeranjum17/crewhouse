// The crew on the iPhone's Lock Screen and Dynamic Island (a Live Activity), over expo-widgets: the one file that
// imports it (island.ts stands in on Android, where neither is linked). It shows the same adapter.status() as the Android
// chip, from the app's own refresh: local updates only, since crewd's pushes carry no content and the person's computer
// holds no Apple push key.
import { HStack, Image, Link, Text, VStack } from '@expo/ui/swift-ui';
import { font, minimumScaleFactor, opacity, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import type { CrewStatus } from '../../web/src/adapter.ts';

// Unrefreshed this long (a dead app or link), the system marks it out of date; longer than a quiet step, as on Android.
const STALE_MS = 15 * 60_000;

// Drawn by the system in its own runtime, from its props alone. Anyone can see the Lock Screen and the compact island,
// so they carry counts only (chip, publicText); names and the buttons wait for the expanded island, on an unlocked phone.
const layout = (s: CrewStatus, env: LiveActivityEnvironment) => {
  'widget';
  const dim = env.isStale ? [opacity(0.5)] : [];
  const mark = <Image systemName="person.2.fill" color="#1F6F66" />;
  const chip = <Text modifiers={[font({ weight: 'semibold' }), minimumScaleFactor(0.5), ...dim]}>{s.chip}</Text>;
  return {
    banner: <HStack modifiers={[padding({ all: 14 }), ...dim]}>{mark}<Text>{s.publicText}</Text></HStack>,
    compactLeading: mark,
    compactTrailing: chip,
    minimal: chip,
    expandedLeading: mark,
    expandedTrailing: chip,
    expandedCenter: <VStack><Text modifiers={[font({ weight: 'semibold' })]}>{s.title}</Text><Text>{s.text}</Text></VStack>,
    expandedBottom: <HStack>{s.actions.map((a) => <Link key={a.id} label={a.label} destination={`crewhouse://${a.id}`} />)}</HStack>,
  };
};
const Crew = createLiveActivity<CrewStatus>('Crew', layout);
let started = false; // one per stretch of work: swiped away, it stays away until work starts again

/** Show the crew's status, or end it (offline, or nothing working or waiting). Only a working job starts one. */
export function island(s: CrewStatus | null) {
  try {
    const on = Crew.getInstances();
    if (!s) { started = false; return on.forEach((a) => void a.end('immediate').catch(() => {})); }
    const stale = new Date(Date.now() + STALE_MS);
    if (on.length) on.forEach((a) => void a.update(s, stale).catch(() => {}));
    else if (s.active && !started) Crew.start(s, undefined, stale);
    started = s.active;
  } catch {} // the person switched Live Activities off for this app
}
