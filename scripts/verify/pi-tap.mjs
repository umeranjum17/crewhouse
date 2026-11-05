#!/usr/bin/env node
// The `pi-engine` journey's witness for what a real model is offered: Pi's own record keeps the calls a bot made, never the tools
// it could see. A loopback pass-through to the provider, between crewd and the model, writes one line per model request: the bot and
// the names of its tools. Bytes pass unchanged. It never writes the key or a word of the conversation.
//   node scripts/verify/pi-tap.mjs <provider-origin> <port> <record-file>
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [origin, port, record] = process.argv.slice(2);
createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks), sent = JSON.parse(body.toString() || '{}');
  appendFileSync(record, `${JSON.stringify({ bot: /Your id in Crewhouse is ([a-z0-9-]+)\./.exec(JSON.stringify(sent.messages))?.[1], tools: (sent.tools ?? []).map((t) => t.function?.name).sort() })}\n`);
  const reply = await fetch(new URL(req.url, origin), { method: req.method, headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json' }, body });
  res.writeHead(reply.status, { 'content-type': reply.headers.get('content-type') ?? 'application/json' });
  for await (const chunk of reply.body) res.write(chunk);
  res.end();
}).listen(Number(port), '127.0.0.1');
