// The crew on the iPhone's Lock Screen is island.ios.tsx (the same extension, so Metro picks it there); elsewhere
// there is none, and its modules are not linked.
import type { CrewStatus } from '../../web/src/adapter.ts';

export function island(_: CrewStatus | null) {}
