// The scripted model for a real boat.dev run (docs/verification/where-cloud.md): an OpenAI-compatible streaming server on
// the computer's loopback, which crewd registers as its custom provider (CREWHOUSE_ENGINE_BASE_URL). OpenClaw runs Chief
// for real; only the words are fixed, so no AI account is needed. Every turn names what the person said last.
import { createServer } from 'node:http';
const words = (m) => typeof m?.content === 'string' ? m.content : (m?.content ?? []).map((p) => p.text ?? '').join('\n');
createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  let body; try { body = JSON.parse(raw); } catch { return res.writeHead(400).end(); }
  if (!req.url.endsWith('/chat/completions')) return res.writeHead(404).end();
  const last = words([...(body.messages ?? [])].reverse().find((m) => m.role === 'user')).trim().split('\n').at(-1).replace(/^The person says:\s*/, '').slice(0, 80);
  const text = `Hello! I'm Chief, running on your own boat.dev computer. You said: "${last}"`;
  const id = `lab-${Date.now()}`, send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  send({ role: 'assistant', content: text }); send({}, 'stop'); res.end('data: [DONE]\n\n');
}).listen(7399, '127.0.0.1');
