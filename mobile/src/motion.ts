// Every movement in the phone app is named here, once, and the phone's Reduce Motion setting always snaps it: the
// thing is simply there, never a shorter or softer version of the move. The web app does the same in styles.css
// and web/src/parts.tsx. test/ui.test.ts fails if a screen in mobile/App.tsx animates without going through here.
import { createElement, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing } from 'react-native';

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

/** A ring turning while work is in progress, so a "doing" row reads as active rather than a half-filled circle.
 *  Reduce Motion holds it still: a bright gap in a quiet ring still says "in progress". */
export function Ring({ size = 13, width = 2, color, reduce }: { size?: number; width?: number; color: string; reduce: boolean }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) { v.setValue(0); return; }
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [reduce]);
  return createElement(Animated.View, { style: { width: size, height: size, borderRadius: size / 2, borderWidth: width,
    borderColor: color, borderTopColor: 'transparent', transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] } });
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

/** Whether the app is on screen. */
export function useAwake() {
  const [on, setOn] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setOn(st === 'active'));
    return () => sub.remove();
  }, []);
  return on;
}
