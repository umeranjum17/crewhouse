// Every movement in the phone app is named here, once, and the phone's Reduce Motion setting always snaps it: the
// thing is simply there, never a shorter or softer version of the move. The web app does the same in styles.css
// and web/src/parts.tsx. test/ui.test.ts fails if a screen in mobile/App.tsx animates without going through here.
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

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
