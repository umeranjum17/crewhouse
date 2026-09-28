// Whose hands a request to Chief goes into: one helper's, Chief's own, or nobody's yet (Chief asks one plain question).
// A typed decision (@byokit/decide): the obvious cases by rule, the rest by the member's own signed-in AI, and the
// floors are code. Unsure means ask, never guess.
import { decide, rules, type Answer, type Backend, type Question } from '@byokit/decide';
export type { Backend };
import type { AgentRuntime } from './runtime.ts';
import { CHIEF } from './config.ts';

export interface Helper { id: string; display: string; role: string }
/** What the person just said; `earlier` is the request Chief's clarifying question was about. */
export interface Request { text: string; earlier?: string }

const ROUTE_MS = Number(process.env.CREWHOUSE_ROUTE_MS || 20_000);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Chief's own work, whoever it mentions: routines and check-ins, memory, how to be addressed, hiring. */
const chiefWork = /^(remember|call me)\b|\bevery\b|\beach (day|morning|evening|night|week|month)\b|\bweekdays\b|\bkeep an eye on\b|\blet me know if\b|\b(recruit|hire)\b|\b(market|marketing|promote|launch|paperwork)\b/i;

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
    if (/^chief\s*[,!:]/i.test(s.text) || chiefWork.test(s.text) || (s.earlier && chiefWork.test(s.earlier))) return CHIEF;
    const named = (re: (name: string) => string) => helpers.find((h) => new RegExp(re(esc(h.display)), 'i').test(s.text))?.id;
    // The answer to Chief's question: a name is enough.
    if (s.earlier) return /^(you|yourself|chief)\b/i.test(s.text) ? CHIEF : named((n) => `\\b${n}\\b`);
    return named((n) => `^(${n}\\s*[,:]|(ask|tell|get|have) ${n} to\\b)|(^|\\s)@${n}\\b`);
  });
}

/** The member's own AI as the answerer, through the runtime's tool-less turn: every option's probability, as JSON. */
export function byRuntime(runtime: AgentRuntime, member: number): Backend {
  return {
    name: 'model',
    leaves: true,
    async ask(state, questions, signal) {
      const s = state as Request;
      const out: Record<string, { probabilities: Record<string, number> } | undefined> = {};
      for (const [k, q] of Object.entries(questions)) {
        if (q.kind !== 'choice') continue;
        if (signal?.aborted) break;
        const keys = Object.keys(q.options);
        const reply = await runtime.ask(member, `[Crewhouse routing] ${q.instructions}\nOptions:\n${keys.map((o) => `- ${o}: ${q.options[o]}`).join('\n')}\n` +
          `${s.earlier ? `Earlier request: ${s.earlier}\nAsked who should take it, the person answered: ${s.text}` : `Request: ${s.text}`}`);
        out[k] = probabilities(reply, keys);
      }
      return out;
    },
  };
}

/** A model's rough numbers, scaled to sum to 1; anything else is no answer. */
function probabilities(text: string, keys: string[]) {
  try {
    const o = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '');
    const p = Object.fromEntries(keys.map((k) => [k, Math.max(0, Number(o[k]) || 0)]));
    const sum = Object.values(p).reduce((a, b) => a + b, 0);
    return sum > 0 ? { probabilities: Object.fromEntries(keys.map((k) => [k, p[k] / sum])) } : undefined;
  } catch { return undefined; }
}

/** Where the request goes. Abstained with probabilities: the model was torn, so ask. Without: nobody could say. */
export async function route(req: Request, helpers: Helper[], model?: Backend): Promise<Answer> {
  const { to } = await decide(req, { to: question(helpers) }, { privacy: 'may-leave', backends: model ? [byRule(helpers), model] : [byRule(helpers)], timeoutMs: ROUTE_MS });
  return to;
}

/** The routing prompt's own answer, without the wrapper: what a one-shot routing turn must return. */
export const routingAsk = 'You route requests in a family\'s crew of helpers. Answer with one JSON object and nothing else: each option id mapped to the probability that it is the right one, summing to 1.';

/** Chief's one clarifying question, between the two likeliest hands. */
export function clarify(a: Answer, helpers: Helper[], address: string) {
  const [x, y] = Object.entries(a.probabilities ?? {}).sort((p, q) => q[1] - p[1]).map(([k]) => k);
  const name = (id: string) => helpers.find((h) => h.id === id)?.display;
  const who = [x, y].filter((k) => k !== CHIEF).map(name);
  const choice = [x, y].includes(CHIEF) ? `shall ${who[0]} take it, or shall I see to it myself` : `shall ${who[0]} take it, or ${who[1]}`;
  return `Just so this goes to the right hands${address ? `, ${address}` : ''}: ${choice}?`;
}
