// The scripted model the pinned Gateway's tests run on: an OpenAI-compatible streaming server on loopback, registered
// as a custom provider (`crewhouse-stub`). Sessions, tools, the gate and the run events are the engine's own code
// path. No network, no account, no quota, no sign-ins anywhere.
// Script (read from the latest user message):
//   [tool NAME {json}]   call that tool once, then reply with what it returned; several are called in turn, the reply
//                        saying what the last one returned (the json may nest: braces are matched, not guessed)
//   hit the limit        answer with the account's own usage-limit error (rests it)
//   no helpers in plan   answer as a plan without helpers does
//   sign me out          answer as an account whose sign-in stopped working does
//   ask permission       hold the turn (after its tool calls) until the test releases it (`release`)
//   anything else        reply `stub <bot>: done with "<the last line of the message>"`
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';


const holds = new Map<string, (reply: string) => void>();
export const release = (key: string, reply = '') => { holds.get(key)?.(reply); holds.delete(key); };
export const holding = (key: string) => holds.has(key);

/** The tool calls in the script, each with its arguments. Braces are balanced, so a spec may nest (crew_workbook does). */
export function toolCalls(text: string) {
  const out: { name: string; input: any }[] = [];
  for (const m of text.matchAll(/\[tool (\w+) \{/g)) {
    const from = m.index! + m[0].length - 1;
    let depth = 0, i = from, quote = false, esc = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { quote = !quote; continue; }
      if (quote) continue;
      if (c === '{') depth++;
      else if (c === '}' && !--depth) break;
    }
    out.push({ name: m[1], input: JSON.parse(text.slice(from, i + 1)) });
  }
  return out;
}

const words = (m: any) => typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((c: any) => c.text ?? '').join('') : '';

/** One loopback HTTP server that speaks the script. `keyFor` names the hold a request's body waits on. */
export function startModelStub(promptTokens?: number) {
  const calls: { authorization: string; path: string; body: any }[] = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    let body: any;
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { res.writeHead(400).end(); return; }
    calls.push({ authorization: String(req.headers.authorization ?? ''), path: req.url ?? '', body });
    if (req.url === '/api/embed' || req.url === '/api/embeddings') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ embeddings: (Array.isArray(body.input) ? body.input : [body.input]).map(() => [0.1, 0.2, 0.3]) }));
    }
    const messages: any[] = body.messages ?? [];
    const system = messages.filter((m: any) => m.role === 'system').map((m: any) => words(m)).join('\n');
    const bot = /Your id in Crewhouse is ([a-z0-9-]+)\./.exec(system)?.[1] ?? 'bot';
    const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
    const said = words(lastUser);
    const results = messages.slice(messages.findLastIndex((m: any) => m.role === 'user') + 1).filter((m: any) => m.role === 'tool');
    const scripted = toolCalls(said);
    const lastResult = results.at(-1);
    const done = () => {
      if (results.length && lastResult) {
        if (/\[two-fare-backtest\]/.test(said))
          return 'I recommend the lower fare from Fareboard. I checked Fareboard and Narrowfare; I didn\'t check baggage fees or live inventory.';
        return `stub ${bot}: ${lastResult.name ?? 'tool'} said ${words(lastResult).slice(0, 300)}`;
      }
      const asked = said.split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('[Crewhouse')).pop() ?? '';
      return `stub ${bot}: done with "${asked.slice(0, 60)}"`;
    };
    // A forget turn: the scripted restore call, then a plain reply.
    if (/restore_collection/.test(said) && !results.length) {
      const id = randomUUID();
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (delta: object, finish: string | null = null) =>
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      send({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: 'skill_workshop', arguments: '{"action":"restore_collection"}' } }] });
      send({}, 'tool_calls');
      return void res.end('data: [DONE]\n\n');
    }
    if (/sign me out/i.test(said)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: '401 Unauthorized: your sign-in has expired' } }));
    }
    if (/hit the limit/i.test(said)) {
      res.writeHead(429, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'You have hit your ChatGPT usage limit (plus plan). Try again in ~30 min.' } }));
    }
    if (/no helpers in plan/i.test(said)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: "Your plan doesn't include this model." } }));
    }
    const next = scripted[results.length];
    if (process.env.CREWHOUSE_STUB_DEBUG) console.log('STUB req', calls.length, 'roles', messages.map((m: any) => m.role).join(',').slice(0, 60), 'rss', Math.round(process.memoryUsage().rss / 1e6));
    const id = randomUUID();
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (delta: object, finish: string | null = null) =>
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    if (next) {
      send({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: next.name, arguments: JSON.stringify(next.input) } }] });
      send({}, 'tool_calls');
      return void res.end('data: [DONE]\n\n');
    }
    let text = done();
    if (/ask permission/i.test(said)) {
      const key = String(req.headers.authorization ?? 'hold');
      text = await new Promise<string>((resolve) => {
        holds.set(key, (reply) => resolve(reply || text));
        res.once('close', () => holds.delete(key));
      });
    }
    send({ role: 'assistant', content: text });
    send({}, 'stop');
    // A scripted usage receipt lets maintenance tests cross a token threshold without a huge HTTP fixture.
    if (promptTokens !== undefined) res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model, choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: 20, total_tokens: promptTokens + 20 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  return new Promise<{ url: string; calls: typeof calls; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address && typeof address !== 'string' ? address.port : 0}/v1`,
        calls,
        close: () => new Promise<void>((yes) => server.close(() => yes())),
      });
    });
  });
}

const plain = (res: import('node:http').ServerResponse, body: any, text: string) => {
  const id = randomUUID();
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const chunk = (delta: object, finish: string | null = null) =>
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  chunk({ role: 'assistant', content: text });
  chunk({}, 'stop');
  res.end('data: [DONE]\n\n');
};
