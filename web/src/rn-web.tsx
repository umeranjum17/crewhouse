// The few react-native names @desklink/react-native's web build touches, for this plain React app.
// The build aliases `react-native` here; the Expo app will use the real thing.
import type { CSSProperties, ReactNode } from 'react';

export type ViewStyle = CSSProperties;
export type StyleProp<T> = T | StyleProp<T>[] | null | undefined | false;

const flat = (s: StyleProp<CSSProperties>): CSSProperties => (Array.isArray(s) ? Object.assign({}, ...s.map(flat)) : s || {});

export function View({ style, accessibilityLabel, children }: { style?: StyleProp<ViewStyle>; accessibilityLabel?: string; children?: ReactNode }) {
  return <div role="img" aria-label={accessibilityLabel} style={{ position: 'relative', ...flat(style) }}>{children}</div>;
}

export const StyleSheet = { create: <T,>(styles: T) => styles };

export const AppState = { addEventListener: (_event: string, _fn: (status: string) => void) => ({ remove() {} }) };
