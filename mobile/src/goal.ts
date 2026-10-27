// Your goal on the phone: what the person may do with a role, as web/src/goal.tsx RoleCard offers it. Pure, so the
// rules are checked without React Native (test/phone-goal.test.ts). Submitting is never here: an application goes in
// only from its own Submit card, which crewd raises and the person answers.
import type { GoalRole } from '../../web/src/adapter.ts';

export type RoleAction =
  | { kind: 'draft' | 'prep'; label: string; busy: boolean }
  | { kind: 'open-prep'; label: string }
  | { kind: 'move'; label: string; stage: string; go: boolean };

export function roleActions(r: GoalRole): RoleAction[] {
  const out: RoleAction[] = [];
  if (r.stage === 'found') out.push({ kind: 'draft', label: r.drafting ? 'Drafting…' : 'Draft my application', busy: r.drafting });
  if (r.stage === 'interview') out.push(r.prep ? { kind: 'open-prep', label: 'Open your interview prep' } : { kind: 'prep', label: r.prepping ? 'Writing your prep…' : 'Prep for this interview', busy: r.prepping });
  if (r.next) out.push({ kind: 'move', label: r.next[1], stage: r.next[0], go: true });
  if (r.stage === 'found' || r.stage === 'drafted') out.push({ kind: 'move', label: 'Not for me', stage: 'passed', go: false });
  return out;
}
