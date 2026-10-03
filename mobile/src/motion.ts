// Every movement in the phone app is named here, once, and the phone's Reduce Motion setting always snaps it: the
// thing is simply there, never a shorter or softer version of the move. The web app does the same in styles.css
// and web/src/parts.tsx. test/ui.test.ts fails if a screen in mobile/App.tsx animates without going through here.
import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, type StyleProp, type ViewStyle } from 'react-native';

/** Whether the person asked their phone for less motion; follows the setting while the app is open. */
export function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/** A sheet rises from the bottom of the screen. */
export const sheet = (reduce: boolean) => (reduce ? 'none' : 'slide') as 'none' | 'slide';

/** A steady beat for things that are waiting — Chief's thinking dots, the caret on words still arriving: one step every
 *  `ms`. Reduce Motion holds it still at 0. */
export function useBeat(ms: number, reduce: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms, reduce]);
  return reduce ? 0 : n;
}

/** Something new arrives by rising a few points into place (a chat line, Hello's parts in order, after `delay` ms).
 *  Reduce Motion: it is simply there. */
export function Rise({ reduce, delay = 0, children }: { reduce: boolean; delay?: number; children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) { v.setValue(1); return; }
    const a = Animated.timing(v, { toValue: 1, duration: 260, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, []);
  return createElement(Animated.View, { style: { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] } }, children);
}

// ---------- the office ----------
// Each member wears a calm loop for their status (working, resting, and Chief's lean-in while he holds something for
// you), and a move lands with news (a step, a new thing, a question, a finished job). Every move runs on the native driver, never a JS timer; with the app put
// away none runs, and Reduce Motion keeps the room still on each pose as drawn.

/** Whether the app is on screen. */
export function useAwake() {
  const [on, setOn] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setOn(st === 'active'));
    return () => sub.remove();
  }, []);
  return on;
}

/** Runs `make` once each time `beat` changes after the first render, while awake and not reduced. */
function useOnBeat(beat: unknown, still: boolean, rest: () => void, make: () => Animated.CompositeAnimation) {
  const was = useRef(beat);
  useEffect(() => {
    if (Object.is(was.current, beat)) return;
    was.current = beat;
    if (still || beat == null) { rest(); return; }
    const a = make();
    a.start();
    return () => a.stop();
  }, [beat]);
}

/** A character hops when news lands for it (`beat` changes), `times` over: twice for a finished job. */
export function Hop({ beat, times = 1, reduce, awake, style, children }: { beat: unknown; times?: number; reduce: boolean; awake: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [y] = useState(() => new Animated.Value(0));
  useOnBeat(beat, reduce || !awake, () => y.setValue(0), () => Animated.loop(Animated.sequence([
    Animated.timing(y, { toValue: -9, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    Animated.timing(y, { toValue: 0, duration: 260, easing: Easing.bounce, useNativeDriver: true }),
  ]), { iterations: times }));
  return createElement(Animated.View, { style: [style, { transform: [{ translateY: y }] }] }, children);
}

/** A ring on the floor that swells out three times when a question arrives (`beat` turns to it), then rests; a null
 *  beat is no question. */
export function Pulse({ beat, reduce, awake, style }: { beat: unknown; reduce: boolean; awake: boolean; style: StyleProp<ViewStyle> }) {
  const [v] = useState(() => new Animated.Value(1));
  useOnBeat(beat, reduce || !awake, () => v.setValue(1), () => {
    v.setValue(0);
    return Animated.loop(Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }), { iterations: 3 });
  });
  return createElement(Animated.View, { pointerEvents: 'none', style: [style, {
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
    transform: [{ scaleY: 0.4 }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }] }] });
}

/** A new thing drops onto the desk (`fresh`); what was already there when the room opened is simply there. */
export function Land({ fresh, reduce, awake, style, children }: { fresh: boolean; reduce: boolean; awake: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const still = !fresh || reduce || !awake;
  const [v] = useState(() => new Animated.Value(still ? 1 : 0));
  useEffect(() => {
    if (still) { v.setValue(1); return; }
    const a = Animated.spring(v, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, []);
  return createElement(Animated.View, { style: [style, { opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }] }, children);
}

/** A member's calm loop for their pose: working nods over the work, resting breathes, needs-you leans in for
 *  attention; pleased and listening hold still. Stops in the background and under Reduce Motion. */
export function Loop({ pose, reduce, awake, style, children }: { pose: string; reduce: boolean; awake: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(0));
  const ms = pose === 'work' ? 1400 : pose === 'rest' ? 3200 : pose === 'needs' ? 1600 : 0;
  useEffect(() => {
    v.setValue(0);
    if (reduce || !awake || !ms) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [ms, reduce, awake]);
  const move = pose === 'rest' ? [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) }, { scaleY: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }]
    : pose === 'needs' ? [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-5deg'] }) }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) }]
      : [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, 2] }) }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-2deg'] }) }];
  return createElement(Animated.View, { style: [style, { transform: move }] }, children);
}

/** A music note rising off whoever is playing (Reel at work), every 2.4 s; none under Reduce Motion or away. */
export function Note({ reduce, awake, style, children }: { reduce: boolean; awake: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    v.setValue(0);
    if (reduce || !awake) return;
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [reduce, awake]);
  if (reduce) return null;
  return createElement(Animated.View, { pointerEvents: 'none', style: [style, { opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] }),
    transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, 8] }) }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, -14] }) }] }] }, children);
}

/** Done hand-off: a page travels `dx`,`dy` points (desk into the tray box), whole until it lands, once when `beat` changes, then is gone. Reduce Motion
 *  and the background skip the journey: the tray's count is the end state. */
/** The done page: it reaches the box's mouth (dx, dy) whole by 72%, settles in by `sink`, and fades only after 88%. */
export function Fly({ beat, dx, dy, sink, reduce, awake, style, children }: { beat: unknown; dx: number; dy: number; sink: number; reduce: boolean; awake: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(1));
  useOnBeat(beat, reduce || !awake, () => v.setValue(1), () => { v.setValue(0); return Animated.timing(v, { toValue: 1, duration: 1700, easing: Easing.linear, useNativeDriver: true }); });
  const go = Easing.inOut(Easing.cubic);
  return createElement(Animated.View, { pointerEvents: 'none', style: [style, { opacity: v.interpolate({ inputRange: [0, 0.88, 1], outputRange: [1, 1, 0] }),
    transform: [{ translateX: v.interpolate({ inputRange: [0, 0.72, 1], outputRange: [0, dx, dx], easing: go }) },
      { translateY: v.interpolate({ inputRange: [0, 0.72, 0.88, 1], outputRange: [0, dy, dy + sink / 2, dy + sink], easing: go }) },
      { scale: v.interpolate({ inputRange: [0, 0.72, 1], outputRange: [1, 1, 0.85] }) }] }] }, children);
}
