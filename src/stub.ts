// The stub model for tests (CREWHOUSE_ENGINE=stub): a scripted model inside the real engine, so sessions, tools, the gate
// and session files are all the engine's own code path. No network, no account, no quota.
// Script, read from the latest message:
//   [tool NAME {json}]   call that tool once, then reply with what it returned
//   hit the limit        on ChatGPT, answer with ChatGPT's own usage-limit error
//   no helpers in plan   on ChatGPT, answer as a plan without helpers does (the same words, with no time to come back)
//   sign me out          answer as an account whose sign-in stopped working does
//   ask permission       hold the turn (after its tool call, if any) until the test releases it (`release`)
//   anything else        reply `stub <bot>: done with "<the last line of the task itself>"`
// Grok stands in for an account that must be signed in first: its sign-in shows a code, then succeeds.
import './isolate.ts'; // first: before anything loads the engine
import { contentText, createFauxCore, createProvider, fauxAssistantMessage, fauxToolCall, getSystemMessageText, type AssistantMessage, type FauxResponseFactory } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { PROVIDERS } from './accounts.ts';

const holds = new Map<string, (reply?: string) => void>();
/** Finish a held turn, with this reply or the usual one. */
export function release(sessionId: string, reply?: string) { holds.get(sessionId)?.(reply); holds.delete(sessionId); }
export const holding = (sessionId: string) => holds.has(sessionId);

const words = (m: any): string => (typeof m.content === 'string' ? m.content : contentText(m.content ?? []));

/** "ask permission" anywhere in the task: the turn waits for `release` (or an abort) before it answers. */
async function hold(said: string, sessionId: string | undefined, signal: AbortSignal | undefined, reply: string) {
  if (!/ask permission/i.test(said) || !sessionId) return reply;
  return (await new Promise<string | undefined>((r) => { holds.set(sessionId, r); signal?.addEventListener('abort', () => r(undefined)); })) ?? reply;
}

const step: FauxResponseFactory = async (ctx, options, _state, model): Promise<AssistantMessage> => {
  const msgs: any[] = ctx.messages;
  const bot = /Your id in Crewhouse is ([a-z0-9-]+)\./.exec(msgs.filter((m) => m.role === 'system').map(getSystemMessageText).join('\n'))?.[1] ?? 'bot';
  const last = msgs.at(-1);
  const said = words([...msgs].reverse().find((m) => m.role === 'user') ?? { content: '' });
  if (last?.role === 'toolResult') return fauxAssistantMessage(await hold(said, options?.sessionId, options?.signal, `stub ${bot}: ${last.toolName} said ${words(last).slice(0, 300)}`));
  const tool = /\[tool (\w+) (\{.*?\})\]/.exec(said);
  if (tool) return fauxAssistantMessage([fauxToolCall(tool[1], JSON.parse(tool[2]))], { stopReason: 'toolUse' });
  if (/hit the limit/i.test(said) && model.provider === 'openai-codex') {
    return fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'You have hit your ChatGPT usage limit (plus plan). Try again in ~30 min.' });
  }
  if (/no helpers in plan/i.test(said) && model.provider === 'openai-codex') {
    return fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'You have hit your ChatGPT usage limit (free plan).' });
  }
  if (/sign me out/i.test(said)) return fauxAssistantMessage('', { stopReason: 'error', errorMessage: '401 Unauthorized: your sign-in has expired' });
  // Its own words, not Crewhouse's framing around them: a real model doesn't read its prompt back either.
  const asked = said.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('[Crewhouse')).pop() ?? '';
  return fauxAssistantMessage(await hold(said, options?.sessionId, options?.signal, `stub ${bot}: done with "${asked.slice(0, 60)}"`));
};

/** Every AI account, answered by the script. */
export function stubModels(rt: ModelRuntime) {
  for (const p of Object.values(PROVIDERS)) {
    const core = createFauxCore({ provider: p.pi, api: `stub-${p.pi}`, models: [{ id: p.model }], tokensPerSecond: 0 });
    core.setResponses(Array(100_000).fill(step));
    const oauth = {
      name: p.name,
      async login(i: any) {
        i.notify({ type: 'device_code', userCode: 'CREW-2026', verificationUri: `https://example.test/${p.pi}/device` });
        await new Promise((r) => setTimeout(r, 50)); // the person types the code
        return { type: 'oauth' as const, access: 'stub', refresh: 'stub', expires: Date.now() + 86_400_000 };
      },
      refresh: async (c: any) => c,
      toAuth: async () => ({}),
    };
    rt.registerNativeProvider(createProvider({
      id: p.pi, name: p.name, models: core.models,
      // Grok needs a sign-in first; the rest count as signed in.
      auth: p.pi === 'xai' ? { oauth } : { apiKey: { name: p.name, resolve: async () => ({ auth: {} }) }, oauth },
      api: { stream: core.stream, streamSimple: core.streamSimple, fetchDeferred: core.fetchDeferred, cancelDeferred: core.cancelDeferred },
    } as any));
  }
}
