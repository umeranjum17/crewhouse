// The one way out of a bot's room. The wall gives a bot on Pi a network of its own with nothing in it, so its model
// calls go to a port on its own loopback and through one Unix socket to crewd, and crewd passes on exactly one request:
// a model call to the provider the person set, with the real key added on the way. The key never enters the wall.
// One file, because the two halves share the addresses: the default export runs inside the wall as a Pi extension,
// openDoor in crewd.
import { createServer as listener, request as plain } from 'node:http';
import { request as secure } from 'node:https';
import { connect, createServer } from 'node:net';
import { rmSync } from 'node:fs';

/** The socket's path inside the wall. */
export const DOOR = '/run/crewhouse/door.sock';
const PORT = 3128, ASK = '/v1/chat/completions';
/** The address Pi is given for its model. */
export const MODEL_URL = `http://127.0.0.1:${PORT}/v1`;

export default () => {
  createServer((c) => { const u = connect(DOOR); c.pipe(u); u.pipe(c); u.on('error', () => c.destroy()); c.on('error', () => u.destroy()); }).listen(PORT, '127.0.0.1').unref();
};

const say = (res, status, message) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message } })); };

/** crewd's half, on `sock`: resolves once it listens, because the wall mounts the socket file at each start. `provider` is read on every request when it is a function, so a key the person pastes again, or signs out, applies to a bot already running (no provider: signed out). */
export function openDoor(sock, provider) {
  const server = listener((req, res) => {
    if (req.method !== 'POST' || req.url !== ASK) return say(res, 403, 'Crewhouse: a bot can only reach its model from here.');
    const now = typeof provider === 'function' ? provider() : provider;
    if (!now) return say(res, 401, 'Crewhouse: this AI account is signed out.');
    const { baseUrl, apiKey } = now, to = new URL(`${baseUrl.replace(/\/+$/, '')}/chat/completions`), send = to.protocol === 'https:' ? secure : plain;
    const { host: _host, authorization: _key, connection: _kept, ...headers } = req.headers;
    const up = send(to, { method: 'POST', headers: { ...headers, authorization: `Bearer ${apiKey}` } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on('error', (e) => { if (!res.headersSent) say(res, 502, `Crewhouse could not reach the model: ${e.message}`); else res.destroy(); });
    res.on('close', () => up.destroy()); // a stopped bot's call stops costing
    req.pipe(up);
  });
  rmSync(sock, { force: true }); // an earlier crewd's
  return new Promise((resolve, reject) => { server.once('error', reject).listen(sock, () => resolve({ close: () => { server.closeAllConnections(); server.close(); } })); });
}
