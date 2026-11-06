#!/usr/bin/env node
// The `pi-engine` journey's witness and its spend limit. Pi's own record keeps a bot's calls, never the tools it could see, and a job's
// lab is gone once a run fails. A loopback pass-through to the provider, between crewd and the model, writes one line per model request:
// the bot, its job, the notes its prompt showed, the tools offered, what each tool last said, then the reply's
// status, finish reason, words, tool calls with their arguments, and tokens. Bytes pass unchanged. It never writes the key. Past <limit> requests it answers an error itself and the provider is never
// reached, so a model that keeps calling tools fails the journey and cannot spend more than the limit. Everything each request sent goes to
// <sent-file>, for the separation check: it stays in the lab, as the judge reads the record and a request is too long for that.
//   node scripts/verify/pi-tap.mjs <provider-origin> <port> <record-file> <limit> <sent-file>
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [origin, port, record, limit, sentFile] = process.argv.slice(2);
let asked = 0;
const whole = (m) => typeof m.content === 'string' ? m.content : (m.content ?? []).map((c) => c.text ?? '').join(''), words = (m) => whole(m).slice(0, 200);
/** What a streamed reply came to: its chunks merged, as Pi merges them. */
const heard = (text) => {
  const calls = [], out = { finish: null, calls, tokens: null, said: '', thinking: 0 };
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: {')) continue;
    const chunk = JSON.parse(line.slice(6)), choice = chunk.choices?.[0], delta = choice?.delta ?? {};
    out.finish = choice?.finish_reason ?? out.finish; out.tokens = chunk.usage?.total_tokens ?? out.tokens;
    out.said += delta.content ?? ''; out.thinking += (delta.reasoning_content ?? delta.reasoning ?? '').length;
    for (const part of delta.tool_calls ?? []) {
      const call = calls[part.index ?? 0] ??= { name: '', args: '' };
      call.name += part.function?.name ?? ''; call.args += part.function?.arguments ?? '';
    }
  }
  return out;
};
createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks), sent = JSON.parse(body.toString() || '{}'), messages = sent.messages ?? [];
  const line = { at: new Date().toISOString(), bot: /Your id in Crewhouse is ([a-z0-9-]+)\./.exec(JSON.stringify(messages))?.[1], job: Number(/\[Crewhouse task #(\d+)/.exec(whole(messages.findLast((m) => m.role === 'user') ?? {}))?.[1]), saved: /Your saved notes[^\n]*\n([^]*)$/.exec(messages.map(whole).find((text) => text.includes('Your saved notes')) ?? '')?.[1], tools: (sent.tools ?? []).map((t) => t.function?.name).sort(), results: messages.slice(messages.findLastIndex((m) => m.role === 'assistant') + 1).filter((m) => m.role === 'tool').map(words) };
  appendFileSync(sentFile, `${JSON.stringify({ bot: line.bot, sent: JSON.stringify(messages) })}\n`);
  const write = (more) => appendFileSync(record, `${JSON.stringify({ ...line, ...more })}\n`);
  if (++asked > Number(limit)) {
    write({ status: 'stopped by the tap' });
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: `pi-tap stopped this request: only ${limit} model calls were allowed` } }));
  }
  const reply = await fetch(new URL(req.url, origin), { method: req.method, headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json' }, body });
  res.writeHead(reply.status, { 'content-type': reply.headers.get('content-type') ?? 'application/json' });
  const seen = new TextDecoder(); let text = '';
  for await (const chunk of reply.body) { res.write(chunk); text += seen.decode(chunk, { stream: true }); }
  res.end();
  write({ status: reply.status, ...reply.ok ? heard(text) : { error: text.slice(0, 200) } });
}).listen(Number(port), '127.0.0.1');
