import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

/** Loopback OpenAI-compatible model for the real Gateway tests. No account or outbound network. */
export async function modelStub(reviewScript = false) {
  const calls: { authorization: string; body: any }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    let body: any;
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { res.writeHead(400).end(); return; }
    calls.push({ authorization: String(req.headers.authorization ?? ''), body });
    const messages: any[] = body.messages ?? [];
    const latest = [...messages].reverse().find((m) => m.role === 'user');
    const text = typeof latest?.content === 'string' ? latest.content : JSON.stringify(latest?.content ?? '');
    const tool = /\[tool (\w+) (\{[^\n]*?\})\]/.exec(text);
    const review = reviewScript && JSON.stringify(messages).includes('skill collection review');
    const used = messages.some((m) => m.role === 'tool');
    const id = randomUUID();
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (delta: object, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    if ((tool || review) && !used) {
      send({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: {
        name: tool?.[1] ?? 'skill_workshop', arguments: tool?.[2] ?? '{"action":"reconcile","collection":[]}',
      } }] });
      send({}, 'tool_calls');
    } else {
      send({ role: 'assistant', content: used ? 'Tool finished.' : 'Stub answered.' });
      send({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No stub port');
  return { url: `http://127.0.0.1:${address.port}/v1`, calls, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
