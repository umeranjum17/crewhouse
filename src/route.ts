// Whose hands a request to Chief goes into: one helper's, Chief's own, or nobody's yet (Chief asks one plain question).
// Explicit rules-only backends bypass the kit's configured Jev default; a miss becomes a Chief task.
import { decide, rules, type Answer, type Question } from '@byokit/decide';
import { CHIEF } from './config.ts';

export interface Helper { id: string; display: string; role: string }
/** What the person just said; `earlier` is the request a bare URL follows up on. */
export interface Request { text: string; earlier?: string }

const ROUTE_MS = Number(process.env.CREWHOUSE_ROUTE_MS || 20_000);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Chief's own work, whoever it mentions: routines and check-ins, memory, how to be addressed, hiring, a helper's job. */
export const chiefWork = /^(remember|call me)\b|\bevery\b|\beach (day|morning|evening|night|week|month)\b|\bweekdays\b|\bkeep an eye on\b|\blet me know if\b|\b(recruit|hire)\b|\bfrom now on\b|(\w's|\b(your|its|their)) (job|role)\b|\b(market|marketing|promote|launch|paperwork)\b/i;
const arithmetic = /^(?:(?:what(?:'s| is)|calculate|solve|work out)\s+)?\d+(?:\s*(?:[+*\/×÷−-]|plus|minus|times|divided by)\s*\d+)+(?:\s*\?)?$/i;

function question(helpers: Helper[]): Question {
  return {
    kind: 'choice',
    instructions: 'Who should take this request from the person?',
    options: { [CHIEF]: 'Chief: runs the crew; routines, hiring, remembering, anything no single helper plainly does', ...Object.fromEntries(helpers.map((h) => [h.id, `${h.display}: ${h.role}`])) },
  };
}

/** The obvious cases, free and on this computer. */
export function byRule(helpers: Helper[]) {
  return rules((s: Request) => {
    if (!helpers.length) return CHIEF;
    if (/^chief\s*[,!:]/i.test(s.text) || arithmetic.test(s.text.trim()) || chiefWork.test(s.text) || (s.earlier && chiefWork.test(s.earlier))) return CHIEF;
    const named = (re: (name: string) => string) => helpers.find((h) => new RegExp(re(esc(h.display)), 'i').test(s.text))?.id;
    // The answer to Chief's question: a name is enough.
    if (s.earlier) return /^(you|yourself|chief)\b/i.test(s.text) ? CHIEF : named((n) => `\\b${n}\\b`);
    return named((n) => `^(${n}\\s*[,:]|(ask|tell|get|have) ${n} to\\b)|(^|\\s)@${n}\\b`);
  });
}

/** Where the request goes. Rules first; a miss becomes a Chief task. */
export async function route(req: Request, helpers: Helper[]): Promise<Answer> {
  const { to } = await decide(req, { to: question(helpers) }, { privacy: 'may-leave', backends: [byRule(helpers)], timeoutMs: ROUTE_MS });
  return to;
}
