// The part of @desklink/react-native this app uses. Its sources are written for Metro and Expo, not for tsc on
// a plain React web app, so tsc checks against this; esbuild bundles the real package (scripts/build-web.mjs).
import type { CSSProperties, ReactNode } from 'react';
import type { Permission, SessionFailure, SessionOpenRequest, SessionSnapshot, Signaling } from '../../node_modules/@desklink/react-native/src/protocol.ts';

export const CONTROL_PERMISSIONS: Permission[];
export function DesktopView(props: { sessionId: string | null; style?: CSSProperties; placeholder?: ReactNode; accessibilityLabel?: string }): ReactNode;
export function useDesktopSession(options: {
  authorize: () => Promise<{ signaling: Signaling; session: SessionOpenRequest }>;
  onError?: (failure: SessionFailure) => void;
}): {
  snapshot: SessionSnapshot;
  nativeId: string | null;
  connect: () => Promise<void>;
  close: (reason?: string) => Promise<void>;
  setInputEnabled: (enabled: boolean) => void;
  showKeyboard: () => void;
};
