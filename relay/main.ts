// Crewhouse's relay: @byokit/relay with Crewhouse's settings, so a phone reaches the family computer from anywhere
// without the computer opening a port. It routes link frames it cannot read. Push is content-free: whatever a host
// asks, a phone is only told "Crewhouse has news" and fetches the text over the encrypted link.
//
// Run: `node relay/main.ts` (env below), or the Dockerfile beside it. The project runs one public copy; anyone can
// run their own (relay/README.md) and point Settings, Phones at it.
//   PORT (7300), HOST (127.0.0.1), RELAY_DATA (./relay-data): where it listens and keeps its state
//   RELAY_SIGNUP: 'enrol' (default: a host needs a one-use enrolment from the owner) or 'open' (any host that proves
//     its key, up to RELAY_MAX_HOSTS, default 1000)
//   RELAY_OWNER_TOKEN: turns on the owner's routes (make an enrolment, list and revoke hosts)
//   RELAY_TRUST_PROXY=1: rate-limit by X-Forwarded-For, only behind a proxy you run (Caddy, Tailscale Serve)
//   RELAY_PUSH_SUBJECT: Web Push contact, mailto: or https:
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Relay, type RelayOptions, type RelayState } from '@byokit/relay';

/** Every push says only this. */
export const NEWS = 'Crewhouse has news';

export type RelaySettings = {
  port?: number; host?: string; dataDir: string; signup?: 'enrol' | 'open'; maxHosts?: number;
  ownerToken?: string; trustProxy?: boolean; push?: RelayOptions['push'];
};

/** The relay's state as one private file, replaced whole so a crash never leaves half of it. */
function fileStore(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'relay.json');
  return {
    load: (): RelayState | undefined => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined,
    save: (s: RelayState) => { writeFileSync(`${file}.tmp`, JSON.stringify(s), { mode: 0o600 }); renameSync(`${file}.tmp`, file); },
  };
}

export async function startRelay(o: RelaySettings): Promise<{ relay: Relay; server: Server; url: string; close(): Promise<void> }> {
  const relay = await Relay.open({ store: fileStore(o.dataDir), ownerToken: o.ownerToken || undefined, trustProxy: o.trustProxy,
    push: { subject: 'https://github.com/umeranjum17/crewhouse', ...o.push } });
  // ponytail: the two hooks below replace private Relay methods; @byokit/relay is pinned exactly and
  // test/relay.test.ts fails if a bump moves them. Upstream options for both would retire this.
  const r = relay as any;
  const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
  // Content-free push, enforced here rather than trusted to each host: a fixed title, no body, data or buttons. The id
  // is hashed so it still dedupes a retry without saying anything.
  const notify = r.notify.bind(relay);
  r.notify = (host: string, n: any) => notify(host, { id: `n${sha(String(n?.id)).slice(0, 40)}`, title: NEWS, ...(n?.to !== undefined && { to: n.to }) });
  if (o.signup === 'open') {
    // Any host that proves its key may register (nobody can take another host's address); the cap bounds the store.
    const register = r.register.bind(relay);
    r.register = async (ws: unknown, req: unknown, ch: { verify(k: Uint8Array, p: Uint8Array): boolean }, m: any) => {
      const key = typeof m?.key === 'string' ? Buffer.from(m.key, 'base64url') : undefined;
      if (key?.length === 32 && typeof m.proof === 'string' && ch.verify(key, Buffer.from(m.proof, 'base64url'))) {
        const hosts = relay.hosts();
        if (!hosts.some((h) => h.key === m.key) && hosts.length < (o.maxHosts ?? 1000)) await relay.admit(key, m.name);
      }
      return register(ws, req, ch, m);
    };
  }
  const server = createServer((req, res) => {
    if (new URL(req.url ?? '/', 'http://relay').pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end('{"ok":true}');
      return;
    }
    void relay.request(req, res).then((ours) => { if (!ours) res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}'); });
  });
  server.on('upgrade', (req, socket, head) => { if (!relay.upgrade(req, socket, head)) socket.destroy(); });
  await new Promise<void>((ok) => server.listen(o.port ?? 7300, o.host ?? '127.0.0.1', ok));
  const { port } = server.address() as { port: number };
  return {
    relay, server, url: `http://${o.host === '0.0.0.0' ? '127.0.0.1' : o.host ?? '127.0.0.1'}:${port}`,
    close: () => new Promise((ok) => { relay.close(); server.close(() => ok()); server.closeAllConnections(); }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const e = process.env;
  const signup = e.RELAY_SIGNUP === 'open' ? 'open' : 'enrol';
  const { url } = await startRelay({
    port: Number(e.PORT || 7300), host: e.HOST || '127.0.0.1', dataDir: resolve(e.RELAY_DATA || 'relay-data'), signup,
    maxHosts: Number(e.RELAY_MAX_HOSTS || 1000), ownerToken: e.RELAY_OWNER_TOKEN, trustProxy: e.RELAY_TRUST_PROXY === '1',
    push: e.RELAY_PUSH_SUBJECT ? { subject: e.RELAY_PUSH_SUBJECT } : undefined,
  });
  console.log(`Crewhouse relay on ${url} (signup: ${signup}${e.RELAY_OWNER_TOKEN ? ', owner routes on' : ''})`);
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => process.exit(0));
}
