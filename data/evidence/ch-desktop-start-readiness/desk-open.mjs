// The app's own desktop path: open a bot's screen the way the web/phone client does — a
// person-authorised WebSocket at /ws/desktop/<bot>, then `session.open`. Prints the reply as
// one JSON line and exits: 0 when the view opened, 1 when crewd refused.
//
//   node desk-open.mjs <base-url> <person-key> <bot>
const [, , base, key, bot] = process.argv;
const { WebSocket } = await import('ws');
const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws/desktop/${bot}`, `crewhouse-person.${key}`);
const fail = (why) => { console.log(JSON.stringify({ stage: 'socket', error: why })); process.exit(1); };
ws.once('error', (e) => fail(e.message));
ws.once('open', () => ws.send(JSON.stringify({ id: 1, method: 'session.open', params: { permissions: ['view'] } })));
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id !== 1) return;
  console.log(JSON.stringify(msg));
  ws.close();
  process.exit(msg.error ? 1 : 0);
});
setTimeout(() => fail('no answer within 90s'), 90_000).unref();
