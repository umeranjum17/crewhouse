// The phone link: pairing by single-use QR, durable device grants, and a WebSocket that carries only
// Noise-encrypted frames (src/envelope.ts). By default it listens on loopback and Tailscale only;
// the home network is an opt-in. It answers nothing but the handshake: every request after it is
// authenticated by the phone's key.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Config } from './config.ts';
import type { Row, Store } from './db.ts';
import { b64, fingerprint, keyPair, keyPairFrom, respond, unb64, type Channel, type KeyPair, type PairOffer } from './envelope.ts';

export const PAIR_MS = Number(process.env.CREWHOUSE_PAIR_MS || 120_000); // a pairing QR is good for two minutes
export type Handler = (method: string, path: string, body: any, member: number) => Promise<unknown>;
type Ifaces = ReturnType<typeof networkInterfaces>;

// ponytail: Tailscale is recognised by its address range (100.64.0.0/10), not by asking tailscaled.
const tailscale = (ip: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
const ipv4 = (ifaces: Ifaces) => Object.entries(ifaces)
  .filter(([name]) => !/^(docker|br-|veth|virbr|vmnet|vboxnet)/.test(name)) // container and VM bridges a phone can't reach
  .flatMap(([, list]) => list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => a.address);

/** Where the link listens: loopback and Tailscale; every interface only when the owner opts in to the LAN. */
export function linkHosts(pinned: string, lan: boolean, ifaces: Ifaces = networkInterfaces()): string[] {
  if (pinned) return pinned.split(',').map((h) => h.trim()).filter(Boolean);
  return lan ? ['0.0.0.0'] : ['127.0.0.1', ...ipv4(ifaces).filter(tailscale)];
}

/** Addresses a phone can dial for those hosts: home network first, then Tailscale, never loopback. */
export function phoneAddresses(hosts: string[], ifaces: Ifaces = networkInterfaces()): string[] {
  const ips = hosts.includes('0.0.0.0') ? ipv4(ifaces) : hosts.filter((h) => !/^127\.|^localhost$/.test(h));
  return [...ips.filter((ip) => !tailscale(ip)), ...ips.filter(tailscale)];
}

export class Link {
  keys: KeyPair;
  fp: string;
  private codes = new Map<string, { role: string; member: number; expires: number }>();
  private sockets = new Map<WebSocket, { dev: Row; ch: Channel }>(); // authenticated sockets
  private done = new Map<string, Promise<unknown>>(); // idempotency: device:key -> result
  private servers = new Map<string, Server>(); // one listener per bound address
  private wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  private cfg: Config;
  private db: Store;
  private handle: Handler;

  constructor(cfg: Config, db: Store, handle: Handler) {
    this.cfg = cfg;
    this.db = db;
    this.handle = handle;
    const file = join(cfg.stateDir, 'link.key');
    if (!existsSync(file)) writeFileSync(file, JSON.stringify({ sk: b64(keyPair().secretKey) }), { mode: 0o600 });
    this.keys = keyPairFrom(unb64(JSON.parse(readFileSync(file, 'utf8')).sk));
    this.fp = fingerprint(this.keys.publicKey);
    this.wss.on('connection', (ws) => this.connection(ws));
    db.onEvent((e) => { for (const ws of this.sockets.keys()) this.send(ws, { t: 'event', e }); });
  }

  get lan() { return this.db.get("SELECT value FROM settings WHERE key = 'link.lan'")?.value === '1'; }
  hosts() { return linkHosts(this.cfg.linkHost, this.lan); }

  /** Listen on exactly the addresses `hosts()` names now. Rerun when the LAN setting or Tailscale changes. */
  async bind() {
    if (!this.cfg.linkPort) return;
    const want = new Set(this.hosts());
    for (const [host, s] of this.servers) if (!want.has(host)) { s.close(); this.servers.delete(host); }
    await Promise.all([...want].filter((h) => !this.servers.has(h)).map((host) => new Promise<void>((resolve) => {
      const s = createServer((_req, res) => { res.writeHead(404).end(); });
      s.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/link')) return socket.destroy();
        this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws));
      });
      s.once('error', (e) => { console.error(`phone link: can't listen on ${host}: ${e.message}`); resolve(); });
      s.listen(this.cfg.linkPort, host, () => { this.servers.set(host, s); resolve(); });
    })));
    console.log(`phone link (Noise-encrypted) on port ${this.cfg.linkPort}: ${[...this.servers.keys()].join(', ') || 'nowhere'}${this.lan ? ' (home network on)' : ''}`);
  }

  async setLan(on: boolean) {
    this.db.run("INSERT INTO settings (key, value) VALUES ('link.lan', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", on ? '1' : '0');
    this.db.event('link.lan', null, { on });
    await this.bind();
  }

  /** Settings, Phones: the paired phones (docs/ui-contract.md) and how phones reach this computer. */
  status() {
    return { fp: this.fp, on: this.cfg.linkPort > 0, lan: this.lan, pinned: !!this.cfg.linkHost,
      hosts: [...this.servers.keys()], tailscale: this.hosts().some(tailscale) };
  }

  /** A single-use code good for two minutes, and the QR text that carries it. */
  async offer(role: string, member: number): Promise<{ qr: string; fp: string; expires: number; urls: string[] }> {
    if (role !== 'control' && role !== 'view') throw Object.assign(new Error('role is control or view'), { status: 400 });
    await this.bind(); // Tailscale may have come up since crewd started
    const now = Date.now();
    for (const [c, v] of this.codes) if (v.expires < now) this.codes.delete(c);
    const c = randomBytes(16).toString('base64url');
    const expires = now + PAIR_MS;
    this.codes.set(c, { role, member, expires });
    const u = phoneAddresses([...this.servers.keys()]).map((ip) => `ws://${ip}:${this.cfg.linkPort}/link`);
    const offer: PairOffer = { crewhouse: 1, k: b64(this.keys.publicKey), c, u };
    return { qr: JSON.stringify(offer), fp: this.fp, expires, urls: u };
  }

  devices() {
    const online = new Set([...this.sockets.values()].map((s) => s.dev.id));
    return this.db.all('SELECT d.id, d.name, d.role, d.member, p.name AS person, d.created_at, d.last_seen FROM devices d LEFT JOIN people p ON p.id = d.member ORDER BY d.created_at')
      .map((d) => ({ id: d.id, name: d.name, member: d.member, person: d.person, role: d.role, seen: d.last_seen ?? d.created_at, online: online.has(d.id) }));
  }

  revoke(id: string) {
    const d = this.db.get('SELECT * FROM devices WHERE id = ?', id);
    if (!d) throw Object.assign(new Error('no such device'), { status: 404 });
    this.db.tx(() => { this.db.run('DELETE FROM devices WHERE id = ?', id); this.db.event('device.revoked', null, { id, name: d.name }); });
    // Said inside the encrypted channel: a close reason is plaintext, and a phone must not drop its grant on one.
    // Android can surface the close before a frame sent just ahead of it, so the close waits a moment.
    for (const [ws, s] of this.sockets) {
      if (s.dev.id !== id) continue;
      this.send(ws, { t: 'revoked' });
      this.sockets.delete(ws); // no more events or answers for it
      setTimeout(() => ws.close(4401, 'this phone was removed'), 1000).unref();
    }
  }

  private send(ws: WebSocket, msg: unknown, ch = this.sockets.get(ws)?.ch) {
    if (ch && ws.readyState === 1) for (const f of ch.seal(msg)) ws.send(f);
  }

  private connection(ws: WebSocket) {
    let ch: Channel | null = null;
    let phone: Uint8Array;
    let dev: Row | undefined;
    const fail = (why: string) => ws.close(4400, why.slice(0, 120));
    const timer = setTimeout(() => { if (!dev) fail('handshake timeout'); }, 15_000);
    ws.on('close', () => { clearTimeout(timer); this.sockets.delete(ws); });
    ws.on('message', async (raw) => {
      try {
        if (!ch) { // Noise IK message one: the phone's key, sealed to ours
          const r = respond(this.keys, String(raw));
          phone = r.phone;
          const known = this.db.get('SELECT id FROM devices WHERE pk = ?', b64(phone));
          if (!known && !(r.hello?.pair && [...this.codes.values()].some((c) => c.expires > Date.now()))) return fail('this phone is not paired, or was removed');
          ch = r.channel;
          return ws.send(r.reply);
        }
        const m = ch.open(String(raw)); // throws unless this is the phone's next authentic frame
        if (m === undefined) return;
        if (!dev) {
          dev = m.t === 'pair' ? this.pair(phone, m) : this.db.get('SELECT * FROM devices WHERE pk = ?', b64(phone));
          if (!dev) return fail('this phone is not paired, or was removed');
          this.db.run('UPDATE devices SET last_seen = ? WHERE id = ?', Date.now(), dev.id);
          this.sockets.set(ws, { dev, ch });
          return this.send(ws, { t: 'ready', device: { id: dev.id, name: dev.name, role: dev.role }, fp: this.fp });
        }
        if (m.t === 'req') this.send(ws, { t: 'res', id: m.id, ...(await this.request(dev, m)) });
      } catch (e: any) {
        fail(e.message || 'bad frame'); // a bad frame ends the socket; the phone reconnects
      }
    });
  }

  private pair(pk: Uint8Array, m: Row): Row {
    const code = this.codes.get(String(m.code));
    this.codes.delete(String(m.code)); // single use, even when it has expired
    if (!code || code.expires < Date.now()) throw new Error('that pairing code has expired; show a new one');
    const id = randomBytes(6).toString('hex');
    const name = String(m.name ?? 'Phone').slice(0, 40) || 'Phone';
    this.db.tx(() => {
      this.db.run('DELETE FROM devices WHERE pk = ?', b64(pk)); // re-pairing the same phone replaces its grant
      this.db.run('INSERT INTO devices (id, name, pk, role, member, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, name, b64(pk), code.role, code.member, Date.now());
      this.db.event('device.paired', null, { id, name, role: code.role, member: code.member });
    });
    return this.db.get('SELECT * FROM devices WHERE id = ?', id)!;
  }

  private async request(dev: Row, m: Row): Promise<{ status: number; body: unknown }> {
    const method = String(m.method ?? 'GET');
    const path = String(m.path ?? '');
    if (!path.startsWith('/api/')) return { status: 404, body: { error: 'not found' } };
    // Household admin stays on the computer: AI account sign-ins, people, the house's Google app, and connecting
    // apps (their sign-in pages come back to this computer's own address).
    if (/^\/api\/(accounts|house)\b/.test(path) || (/^\/api\/(people|connections)\b/.test(path) && method !== 'GET')) return { status: 403, body: { error: 'do that on the computer' } };
    if (method !== 'GET' && dev.role !== 'control') return { status: 403, body: { error: 'this phone can watch but not answer' } };
    if (!this.db.get('SELECT id FROM devices WHERE id = ?', dev.id)) return { status: 401, body: { error: 'this phone was removed' } };
    // A retried tap carries the same key, so it runs once and gets the first answer.
    const key = m.key ? `${dev.id}:${m.key}` : '';
    let p = key ? this.done.get(key) : undefined;
    if (!p) {
      p = this.handle(method, path, m.body ?? {}, dev.member ?? 1);
      if (key) {
        this.done.set(key, p);
        if (this.done.size > 500) this.done.delete(this.done.keys().next().value!);
      }
    }
    try { return { status: 200, body: await p }; } catch (e: any) { return { status: e.status ?? 400, body: { error: e.message } }; }
  }

  listen() { return this.bind(); }

  close() { for (const s of this.servers.values()) s.close(); for (const ws of this.sockets.keys()) ws.terminate(); }
}
