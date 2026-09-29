// The crew in the phone's status bar (Android 16's Live Update), over @byokit/status: the one file that imports the kit.
// It shows adapter.status() from the app's own refresh; the kit drops unchanged posts and throttles the rest, so there is
// no polling here. On iPhone and older Android the kit is unsupported and every call is a no-op.
import { status as kit, stateWords, type StatusState } from '@byokit/status';
import type { CrewStatus } from '../../web/src/adapter.ts';

// A frozen chip clears itself this long after the last post (a dead app or link); longer than a quiet step.
const TIMEOUT_MS = 15 * 60_000;

/** Show the crew's status, or take it away (offline, or nothing working or waiting). */
export function chip(s: CrewStatus | null) {
  if (!s) return kit.clear();
  kit.show({ title: s.title, text: s.text, chip: s.chip, publicText: s.publicText, promote: s.active, actions: s.actions, timeoutMs: TIMEOUT_MS });
}
/** A tap on one of its actions arrives as the crewhouse:// address the app already opens (crewhouse://needs, crewhouse://ask). */
export const onChip = (open: (url: string) => void) => kit.on('action', (e) => open(`crewhouse://${e.id}`));
export const chipState = (): Promise<StatusState> => kit.state();
export const chipSettings = () => kit.openSettings();
export { stateWords as chipWords, type StatusState };
