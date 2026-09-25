// The phone link: @byokit/link's host (Noise IK pairing, durable grants, encrypted requests, revoke) on sockets crewd
// opens itself. By default it listens on loopback and Tailscale only; the home network is an opt-in. Crewhouse's part
// is where it listens, who a phone acts as, what a phone may not do, and the person at the computer saying yes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { Host, keyPair, keyPairFrom, type Grant, type PairRequest, type Role } from '@byokit/link';
import { RelayClient, type RelayStatus } from '@byokit/relay';
import type { Config } from './config.ts';
import type { Store } from './db.ts';

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

/** Addresses a phone can dial for those hosts: home network first, then Tailscale. Loopback only when there is
 *  nothing else, which reaches an emulator or a phone forwarded over USB. */
export function phoneAddresses(hosts: string[], ifaces: Ifaces = networkInterfaces()): string[] {
  const ips = hosts.includes('0.0.0.0') ? ipv4(ifaces) : hosts.filter((h) => !/^127\.|^localhost$/.test(h));
  const out = [...ips.filter((ip) => !tailscale(ip)), ...ips.filter(tailscale)];
  return out.length ? out : ['127.0.0.1'];
}

/** Every notification says only this; the phone fetches the words over the link (the relay enforces it too). */
export const NEWS = 'Crewhouse has news';
/** The relay's WebSocket origin, from the https/wss address Settings keeps. */
const wsOrigin = (url: string) => url.replace(/^http/, 'ws');

const b64url = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); // phones paired before 0.1.0 were stored as base64
const memberOf = (g: Grant) => (g.meta as { member?: number } | undefined)?.member ?? 1;

/** A phone waiting at the computer for the person's yes: its name and the two words both screens show. */
type Asking = { id: number; name: string; words: string; role: Role; member: number; answer: (yes: boolean) => void };

export class Link {
  host!: Host;
  private servers = new Map<string, Server>(); // one listener per bound address
  private wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  private asking = new Map<number, Asking>();
  private n = 0;
  private cfg: Config;
  private db: Store;
  private handle: Handler;
  private client?: RelayClient;
  private relayStatus: RelayStatus | 'off' = 'off';
  /** Whether a member is in their quiet hours now: their phones get no notification then. Set by the server. */
  quiet: (member: number) => boolean = () => false;

  constructor(cfg: Config, db: Store, handle: Handler) {
    this.cfg = cfg;
    this.db = db;
    this.handle = handle;
  }

  async open() {
    const file = join(this.cfg.stateDir, 'link.key');
    if (!existsSync(file)) writeFileSync(file, JSON.stringify({ sk: Buffer.from(keyPair().secretKey).toString('base64') }), { mode: 0o600 });
    const keys = keyPairFrom(new Uint8Array(Buffer.from(JSON.parse(readFileSync(file, 'utf8')).sk, 'base64')));
    this.host = await Host.open({
      keys, name: 'your computer', pairMs: PAIR_MS,
      grants: { load: () => this.load(), save: (g) => this.save(g) },
      confirm: (p) => this.confirm(p),
      canView: (req) => req.op.startsWith('GET '),
      handle: (req, g) => this.request(req.op, req.args, g),
      onError: (e) => console.error('phone link:', e),
    });
    this.wss.on('connection', (ws) => this.host.accept(ws as any));
    this.db.onEvent((e) => this.host.broadcast(e));
  }

  // Grants live in the devices table: one row per phone, with the member it acts as.
  private load(): Grant[] {
    return this.db.all('SELECT * FROM devices ORDER BY created_at').map((d) => ({
      id: d.id, key: b64url(d.pk), name: d.name, role: d.role, created: d.created_at, lastSeen: d.last_seen ?? undefined, meta: { member: d.member ?? 1 } }));
  }
  private save(grants: Grant[]) {
    const before = new Map(this.load().map((g) => [g.id, g]));
    this.db.tx(() => {
      this.db.run('DELETE FROM devices');
      for (const g of grants) this.db.run('INSERT INTO devices (id, name, pk, role, member, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)', g.id, g.name, g.key, g.role, memberOf(g), g.created, g.lastSeen ?? null);
      for (const g of grants) if (!before.has(g.id)) this.db.event('device.paired', null, { id: g.id, name: g.name, role: g.role, member: memberOf(g) });
      for (const [id, g] of before) if (!grants.some((x) => x.id === id)) this.db.event('device.revoked', null, { id, name: g.name });
    });
  }

  /** A phone scanned the code: nothing is stored until the person at the computer says yes (`answer`). */
  private confirm(p: PairRequest) {
    return new Promise<boolean>((resolve) => {
      const id = ++this.n;
      const done = (yes: boolean) => { if (this.asking.delete(id)) { this.db.event('device.asked', null, { id, done: true }); resolve(yes); } };
      this.asking.set(id, { id, name: p.name, words: p.words, role: p.role, member: (p.meta as any)?.member ?? 1, answer: done });
      this.db.event('device.asked', null, { id, name: p.name }); // Settings shows the question
      setTimeout(() => done(false), PAIR_MS).unref();
    });
  }
  answer(id: number, yes: boolean) {
    const a = this.asking.get(id);
    if (!a) throw Object.assign(new Error('that phone stopped waiting'), { status: 404 });
    a.answer(yes);
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

  /** The family's own relay, from Settings, else CREWHOUSE_RELAY. Empty (the default): no relay. */
  get relay(): string { return this.db.get("SELECT value FROM settings WHERE key = 'link.relay'")?.value ?? this.cfg.relay; }

  /** An `https://` or `wss://` address (`http`/`ws` for a relay on the home network or Tailscale); '' turns the relay
   *  off; null goes back to CREWHOUSE_RELAY. */
  setRelay(url: string | null, enrol?: string) {
    let value = url;
    if (value) {
      const u = URL.canParse(value) ? new URL(value) : null;
      if (!u || !/^(https?|wss?):$/.test(u.protocol)) throw Object.assign(new Error('a relay address starts with https:// or wss://'), { status: 400 });
      value = u.origin;
    }
    if (value === null) this.db.run("DELETE FROM settings WHERE key = 'link.relay'");
    else this.db.run("INSERT INTO settings (key, value) VALUES ('link.relay', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", value);
    // A relay that lets computers in by invitation gives a one-use enrolment; it is kept only until it is used.
    if (enrol?.trim()) this.db.run("INSERT INTO settings (key, value) VALUES ('link.relay.enrol', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", enrol.trim());
    this.db.event('link.relay', null, { on: !!this.relay });
    this.dial();
  }

  /** Dial out to the relay (when one is set), so phones reach this computer from anywhere with no port opened here. */
  private dial() {
    this.client?.stop();
    this.client = undefined;
    this.relayStatus = 'off';
    if (!this.relay || !this.host) return;
    const enrol = this.db.get("SELECT value FROM settings WHERE key = 'link.relay.enrol'")?.value || undefined;
    const c = this.client = new RelayClient(this.host, {
      url: `${wsOrigin(this.relay)}/relay/v1/host`, enrol, name: 'Crewhouse',
      onStatus: (st) => {
        if (this.client !== c) return;
        this.relayStatus = st;
        // Registered: the relay knows this computer's key now, so the one-use enrolment is spent.
        if (st === 'online' && enrol) this.db.run("DELETE FROM settings WHERE key = 'link.relay.enrol'");
        this.db.event('link.relay', null, { status: st });
      },
    });
  }

  /** The address a phone dials through the relay, or none. */
  relayUrl() { return this.relay && this.host ? `${wsOrigin(this.relay)}/link/v1/${this.host.id}` : ''; }

  /** Tell a member's phones there is news. Content-free: the words stay on this computer until the phone asks. */
  private async tell(member: number, id: string) {
    if (!this.client || this.relayStatus !== 'online' || this.quiet(member)) return;
    const to = this.host.devices().filter((g) => memberOf(g) === member).map((g) => g.id);
    if (to.length) await this.client.notify({ id, title: NEWS, to }).catch((e) => console.error('push:', e.message));
  }

  /** What a phone hears about: a question for its person, their job finished or stuck, and Chief speaking to them. */
  private news(e: { seq: number; kind: string; data: any; bot: string | null }) {
    let member: number | undefined;
    if (e.kind === 'ask.opened') member = this.db.get('SELECT member FROM asks WHERE id = ?', e.data.ask)?.member ?? 1;
    else if (e.kind === 'task.done' || e.kind === 'task.failed') {
      const t = this.db.get('SELECT member, bot, result FROM tasks WHERE id = ?', e.data.task);
      if (t && t.bot !== 'chief' && t.result !== 'All clear') member = t.member ?? 1;
    } else if (e.kind === 'message' && e.bot === 'chief' && e.data.author === 'bot') member = this.db.get('SELECT member FROM messages WHERE id = ?', e.data.id)?.member ?? undefined;
    if (member !== undefined) void this.tell(member, `e${e.seq}`);
  }

  /** Settings, Phones: how phones reach this computer, and any phone waiting for a yes (docs/ui-contract.md). */
  status() {
    return { on: this.cfg.linkPort > 0, lan: this.lan, pinned: !!this.cfg.linkHost, hosts: [...this.servers.keys()], tailscale: this.hosts().some(tailscale),
      relay: this.relay, relayStatus: this.relayStatus,
      asking: [...this.asking.values()].map(({ id, name, words, role }) => ({ id, name, words, role })) };
  }

  /** A single-use QR for a phone that will act as `member`. */
  async offer(role: string, member: number): Promise<{ qr: string; expires: number; urls: string[] }> {
    if (role !== 'control' && role !== 'view') throw Object.assign(new Error('role is control or view'), { status: 400 });
    await this.bind(); // Tailscale may have come up since crewd started
    const urls = [...(this.servers.size ? phoneAddresses([...this.servers.keys()]).map((ip) => `ws://${ip}:${this.cfg.linkPort}/link`) : []), ...(this.relayUrl() ? [this.relayUrl()] : [])];
    const { text, expires } = this.host.offer({ role, urls, meta: { member } });
    return { qr: text, expires, urls };
  }

  /** Codes to type instead of scanning, through the relay: its short code (which computer) and link's pairing code. */
  async typed(role: string, member: number) {
    if (role !== 'control' && role !== 'view') throw Object.assign(new Error('role is control or view'), { status: 400 });
    if (!this.client || this.relayStatus !== 'online') throw Object.assign(new Error('typing a code works once this computer is reachable from anywhere'), { status: 409 });
    const { code: short, expires } = await this.client.code();
    const { code } = this.host.code({ role, meta: { member } });
    return { short, code, relay: this.relay, expires };
  }

  devices() {
    const people = new Map(this.db.all('SELECT id, name FROM people').map((p) => [p.id, p.name]));
    return this.host.devices().map((g) => ({ id: g.id, name: g.name, member: memberOf(g), person: people.get(memberOf(g)) ?? null, role: g.role,
      seen: g.lastSeen ?? g.created, online: g.online }));
  }

  async revoke(id: string) {
    if (!this.host.devices().some((g) => g.id === id)) throw Object.assign(new Error('no such device'), { status: 404 });
    // Said inside the encrypted channel; the phone forgets its grant only then. Through the relay, its push addresses go too.
    if (this.client) await this.client.revoke(id); else await this.host.revoke(id);
  }

  /** One request from a phone, as `METHOD /path`: run as its member, answered like HTTP. */
  private async request(op: string, body: unknown, g: Grant): Promise<{ status: number; body: unknown }> {
    const [method, path = ''] = op.split(' ', 2);
    if (!path.startsWith('/api/')) return { status: 404, body: { error: 'not found' } };
    // The phone's own: where else it can reach this computer (a phone paired at home learns the relay), and its push address.
    if (op === 'GET /api/reach') return { status: 200, body: { urls: this.relayUrl() ? [this.relayUrl()] : [] } };
    if (op === 'POST /api/push') {
      const sub = body as any;
      if (!this.client || !sub || (typeof sub.expo !== 'string' && typeof sub.web !== 'object')) return { status: 409, body: { error: 'no relay for notifications' } };
      await this.client.subscribe(g.id, typeof sub.expo === 'string' ? { expo: sub.expo } : { web: sub.web });
      return { status: 200, body: { ok: true } };
    }
    // Household admin stays on the computer: AI account sign-ins, people, the house's Google app, connecting apps
    // (their sign-in pages come back to this computer's own address), and the phones themselves.
    if (/^\/api\/(accounts|house|phones)\b/.test(path) || (/^\/api\/(people|connections)\b/.test(path) && method !== 'GET')) return { status: 403, body: { error: 'do that on the computer' } };
    try { return { status: 200, body: await this.handle(method, path, body ?? {}, memberOf(g)) }; }
    catch (e: any) { return { status: e.status ?? 400, body: { error: e.message } }; }
  }

  async listen() {
    await this.open();
    this.db.onEvent((e) => this.news(e as any));
    await this.bind();
    this.dial();
  }

  close() { this.client?.stop(); this.host?.close(); for (const s of this.servers.values()) s.close(); }
}
