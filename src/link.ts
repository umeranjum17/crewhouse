// The phone link: @byokit/link's host (Noise IK pairing, durable grants, encrypted requests, revoke) on sockets crewd
// opens itself. By default it listens on loopback and Tailscale only; the home network opens for the two minutes a
// pairing code lasts, and stays open only when the owner turns it on. Crewhouse's part
// is where it listens, what a phone may not do, and the person at the computer saying yes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { Host, keyPair, keyPairFrom, parseOffer, encodeOffer, b64url, type Grant, type PairRequest, type Role } from '@byokit/link';
import { advertise, routes, tailscaleState as kitTailscaleState, isPeer, type Bonjour, type TailscaleState } from '@byokit/reach';
import { RelayClient, isExpoToken, linkUrl, type RelayStatus } from '@byokit/relay';
import type { Config } from './config.ts';
import type { Store } from './db.ts';
import type { Watcher } from './desktop.ts';

/** A bot's screen for a phone: the same signaling the computer's /ws/desktop socket carries (src/server.ts). */
export interface Desk {
  signal(bot: string, watcher: Watcher, method: string, params: any, canControl: boolean): Promise<unknown>;
  release(watcher: Watcher): void;
}

export const PAIR_MS = Number(process.env.CREWHOUSE_PAIR_MS || 120_000); // a pairing QR is good for two minutes
export type Handler = (method: string, path: string, body: any, key?: string) => Promise<unknown>;
type Ifaces = ReturnType<typeof networkInterfaces>;

// Migration debt (G05): reach has no directRoutes({listen:{loopback,tailnet,lan}}) for multiple listeners.
// Keep the product's binding policy; the kit supplies all interface and tailnet classification.
/** Where the link listens: loopback and Tailscale; every interface only when the owner opts in to the LAN. */
export function linkHosts(pinned: string, lan: boolean, ifaces: Ifaces = networkInterfaces(), tailnetIPs: readonly string[] = []): string[] {
  if (pinned) return pinned.split(',').map((h) => h.trim()).filter(Boolean);
  return lan ? ['0.0.0.0'] : ['127.0.0.1', ...routes(ifaces, tailnetIPs).tailscale];
}

/** Addresses a phone can dial for those hosts: home network first, then Tailscale. Loopback only when there is
 *  nothing else, which reaches an emulator or a phone forwarded over USB. */
export function phoneAddresses(hosts: string[], ifaces: Ifaces = networkInterfaces(), tailnetIPs: readonly string[] = []): string[] {
  const found = routes(ifaces, tailnetIPs);
  const ips = hosts.includes('0.0.0.0') ? [...found.lan, ...found.tailscale] : hosts.filter((h) => !/^127\.|^localhost$/.test(h));
  const out = [...ips.filter((ip) => !found.tailscale.includes(ip)), ...ips.filter((ip) => found.tailscale.includes(ip))];
  return out.length ? out : ['127.0.0.1'];
}

/** Tailscale on this computer, as Settings says it: `anywhere` (a Tailscale address is bound), `signin` (installed, but
 *  signed out or its key ran out), `home` (none: phones reach it only on the home Wi-Fi). Direct `ws://` to the tailnet
 *  address, never Serve or Funnel: the link does its own encryption, and a shared computer is reachable the same way. */
export type Anywhere = 'home' | 'anywhere' | 'signin';
export async function tailscaleState(bound: boolean, bin = 'tailscale'): Promise<Anywhere> {
  return anywhereOf(await kitTailscaleState({ bin, timeoutMs: 5000 }), bound);
}
const anywhereOf = (s: TailscaleState, bound: boolean): Anywhere =>
  s.needsSignin || s.backendState === 'NeedsMachineAuth' || (s.backendState === 'Running' && s.keyExpiry && Date.parse(s.keyExpiry) < Date.now()) ? 'signin' : bound ? 'anywhere' : 'home';

/** Peer membership is a discovery hint; undefined means Tailscale could not provide its peer map. */
export async function tailscalePeer(ip: string, bin = 'tailscale'): Promise<boolean | undefined> {
  const s = await kitTailscaleState({ bin, timeoutMs: 5000 });
  return s.Peer ? isPeer(s, ip) : undefined;
}

/** The routes a phone reaches this computer by, as it reports them (`GET /api/reach {via}`). */
const ROUTES = ['home', 'tailscale', 'relay'];
/** Every notification says only this; the phone fetches the words over the link (the relay enforces it too). */
export const NEWS = 'Crewhouse has news';
const WEB_DEVICE = 'web'; // the person's browser holds no link grant; a paired phone keeps its own grant id
const UPDATE_APP = 'Get the latest Crewhouse app to keep chatting.', currentPhone = (body: any) => body?.build === 'p9b';
/** The relay's WebSocket origin, from the https/wss address Settings keeps. */
const wsOrigin = (url: string) => url.replace(/^http/, 'ws');
const pushOf = (v?: string) => (v === 'missing' || v === 'off' ? v : v ? 'on' : undefined);
/** A phone waiting at the computer for the person's yes: its name and the two words both screens show. */
type Asking = { id: number; name: string; words: string; role: Role; offer?: string; answer: (yes: boolean) => void };
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
  private told = ''; // the dial addresses paired phones were last told
  private watch?: NodeJS.Timeout;
  private pairing = 0; // until when a pairing code holds the home network open
  private shut?: NodeJS.Timeout;
  private advertised = ''; // the address last advertised on the home network
  private mdns?: { stop(): Promise<void> };
  private announcing = Promise.resolve();
  /** This computer's network addresses, and its mDNS publisher; a test swaps in its own. */
  ifaces: () => Ifaces = networkInterfaces;
  bonjour?: Bonjour;
  tailscaleBin = 'tailscale';
  private tailnetIPs: string[] = [];
  /** Expo's push service: it holds the app's Android push credential, so crewd sends with no secret of its own. */
  pushUrl = process.env.CREWHOUSE_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
  private anywhere: Anywhere = 'home';
  /** Whether the person is in their quiet hours now: their phones get no notification then. Set by the server. */
  quiet: () => boolean = () => false;

  constructor(cfg: Config, db: Store, handle: Handler) {
    this.cfg = cfg;
    this.db = db;
    this.handle = handle;
  }

  /** Completed answers, in SQLite so they survive a restart: one device's answer never serves another's,
   *  and a malformed record refuses the replay rather than running it twice (link SECURITY.md item 6). */
  readonly answers = {
    get: async (device: string, key: string): Promise<unknown> =>
      JSON.parse(this.db.get('SELECT value FROM settings WHERE key = ?', `link.ans.${device}.${key}`)?.value ?? 'null'),
    put: async (device: string, key: string, answer: object) => {
      this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', `link.ans.${device}.${key}`, JSON.stringify(answer));
    },
    drop: async (device: string, keys?: string[]) => {
      if (keys) for (const k of keys) this.db.run('DELETE FROM settings WHERE key = ?', `link.ans.${device}.${k}`);
      else this.db.run('DELETE FROM settings WHERE instr(key, ?) = 1', `link.ans.${device}.`);
    },
  };

  async open() {
    const file = join(this.cfg.stateDir, 'link.key');
    if (!existsSync(file)) writeFileSync(file, JSON.stringify({ sk: Buffer.from(keyPair().secretKey).toString('base64') }), { mode: 0o600 });
    const keys = keyPairFrom(new Uint8Array(Buffer.from(JSON.parse(readFileSync(file, 'utf8')).sk, 'base64')));
    this.host = await Host.open({
      keys, name: 'your computer', pairMs: PAIR_MS,
      grants: { load: () => this.load(), save: (g) => this.save(g) },
      confirm: (p) => this.confirm(p),
      // A watch-only phone may read and watch a bot's screen; the desktop never gives it the controls.
      canView: (req) => req.op.startsWith('GET ') || req.op === 'desktop',
      handle: (req, g) => this.request(req.op, req.args, g, req.key),
      answers: this.answers,
      stream: (s, req, g) => this.desktop(s, req.args, g),
      onError: (e) => console.error('phone link:', e),
    });
    this.wss.on('connection', (ws) => this.host.accept(ws as any));
    this.db.onEvent((e) => this.host.broadcast(e));
  }

  // Grants live in the devices table: one row per phone.
  private load(): Grant[] {
    return this.db.all('SELECT * FROM devices ORDER BY created_at').map((d) => ({
      id: d.id, key: b64url(new Uint8Array(Buffer.from(d.pk, 'base64'))), name: d.name, role: d.role, created: d.created_at, lastSeen: d.last_seen ?? undefined }));
  }
  private save(grants: Grant[]) {
    const before = new Map(this.load().map((g) => [g.id, g]));
    this.db.tx(() => {
      this.db.run('DELETE FROM devices');
      for (const g of grants) this.db.run('INSERT INTO devices (id, name, pk, role, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)', g.id, g.name, g.key, g.role, g.created, g.lastSeen ?? null);
      for (const g of grants) if (!before.has(g.id)) {
        this.db.event('device.paired', null, { id: g.id, name: g.name, role: g.role });
        const value = this.db.get("SELECT value FROM settings WHERE key = 'phone.offer.1'")?.value;
        if (value && (g.meta as any)?.offer) {
          const card = JSON.parse(value);
          if (card.token === (g.meta as any).offer) this.db.run("UPDATE settings SET value = ? WHERE key = 'phone.offer.1'", JSON.stringify({ ...card, joined: g.name }));
        }
      }
      for (const [id, g] of before) if (!grants.some((x) => x.id === id)) {
        this.db.run("DELETE FROM settings WHERE key IN (?, ?)", `phone.push.${id}`, `phone.reach.${id}`);
        this.db.event('device.revoked', null, { id, name: g.name });
      }
    });
  }

  /** A phone scanned the code: nothing is stored until the person at the computer says yes (`answer`). */
  private confirm(p: PairRequest) {
    return new Promise<boolean>((resolve) => {
      const id = ++this.n;
      const done = (yes: boolean) => { if (this.asking.delete(id)) { this.db.event('device.asked', null, { id, done: true }); resolve(yes); } };
      this.asking.set(id, { id, name: p.name, words: p.words, role: p.role, offer: (p.meta as any)?.offer, answer: done });
      this.db.event('device.asked', null, { id, name: p.name }); // Settings shows the question
      setTimeout(() => done(false), PAIR_MS).unref();
    });
  }
  answer(id: number, yes: boolean) {
    const a = this.asking.get(id);
    if (!a) throw Object.assign(new Error('that phone stopped waiting'), { status: 404 });
    a.answer(yes);
  }
  approve(words: string) {
    const a = [...this.asking.values()].find((a) => a.words === words.trim());
    if (!a) throw Object.assign(new Error('those words do not match a waiting phone'), { status: 404 });
    a.answer(true);
  }

  private setting(key: string): string | undefined { return this.db.get('SELECT value FROM settings WHERE key = ?', key)?.value; }
  private put(key: string, value: string) { this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value); }
  /** When a phone last reached this computer by each route: `{home?, tailscale?, relay?}`. */
  private reached(id: string): Record<string, number> { return JSON.parse(this.setting(`phone.reach.${id}`) ?? '{}'); }
  get lan() { return this.db.get("SELECT value FROM settings WHERE key = 'link.lan'")?.value === '1'; }
  hosts() { return linkHosts(this.cfg.linkHost, this.lan || Date.now() < this.pairing, this.ifaces(), this.tailnetIPs); }
  /** Listen on exactly the addresses `hosts()` names now, then tell paired phones if where to dial changed.
   *  Rerun when the LAN setting changes, and every half minute for Tailscale coming up or the home address moving. */
  async bind() {
    if (!this.cfg.linkPort) return this.follow();
    const state = await kitTailscaleState({ bin: this.tailscaleBin, timeoutMs: 5000 });
    this.tailnetIPs = state.ips;
    const want = new Set(this.hosts());
    const before = [...this.servers.keys()].join(', ');
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
    const now = [...this.servers.keys()].join(', ');
    if (now !== before) console.log(`phone link (Noise-encrypted) on port ${this.cfg.linkPort}: ${now || 'nowhere'}${this.lan ? ' (home network on)' : ''}`);
    this.follow();
    await (this.announcing = this.announcing.then(() => this.announce()));
    this.anywhere = anywhereOf(state, routes(this.ifaces(), this.tailnetIPs).tailscale.length > 0);
  }

  /** While the home network is open, say so over mDNS, so a paired phone finds this computer after the router gives it a
   *  new address. The phone dials only a `url` whose `id` is its own computer's, and the handshake checks the key anyway. */
  private async announce() {
    const url = this.host && this.servers.has('0.0.0.0') ? this.urls()[0] ?? '' : '';
    if (url === this.advertised) return;
    this.advertised = url;
    await this.mdns?.stop().catch(() => {});
    this.mdns = undefined;
    if (url) this.mdns = await advertise({ type: 'crewhouse', port: this.cfg.linkPort, txt: { id: this.host.id, url }, addresses: phoneAddresses([...this.servers.keys()], this.ifaces(), this.tailnetIPs), bonjour: this.bonjour })
      .catch((e) => { console.error('phone link: mDNS:', e.message); return undefined; });
  }

  /** Every address a phone can dial now: the home network, Tailscale, then the person's own relay. */
  urls() {
    const direct = this.servers.size ? phoneAddresses([...this.servers.keys()], this.ifaces(), this.tailnetIPs).map((ip) => `ws://${ip}:${this.cfg.linkPort}/link`) : [];
    return [...direct, ...(this.relayUrl() ? [this.relayUrl()] : [])];
  }

  /** A phone paired before Tailscale was installed, or before the home address moved, learns the new address while any
   *  route is up; the ones offline ask `GET /api/reach` when they reconnect. A wrong host there only fails its handshake. */
  private follow() {
    const urls = this.urls();
    if (!this.host || JSON.stringify(urls) === this.told) return;
    this.told = JSON.stringify(urls);
    this.host.broadcast({ kind: 'link.urls', data: { urls } });
  }

  async setLan(on: boolean) {
    this.db.run("INSERT INTO settings (key, value) VALUES ('link.lan', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", on ? '1' : '0');
    this.db.event('link.lan', null, { on });
    await this.bind();
  }

  /** The person's own relay, from Settings, else CREWHOUSE_RELAY. Empty (the default): no relay. */
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
    this.follow();
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
        if (st === 'online') this.sendHeld(); // what waited while it was away (a restart, say)
      },
    });
  }

  /** The address a phone dials through the relay, or none. */
  relayUrl() { return this.relay && this.host ? linkUrl(this.relay, this.host.id) : ''; }
  /** Set by the server: what a phone's desktop stream talks to. */
  desk?: Desk;
  /** A phone watching (and, holding the controls, driving) a bot's screen: one JSON message per line each way,
   *  {id, method, params} in and {id, result | error} or {event} out, as on the computer's own socket. */
  private desktop(s: import('@byokit/link').LinkStream, args: any, g: Grant) {
    if (!currentPhone(args)) return s.end(UPDATE_APP);
    const bot = String(args?.bot ?? '');
    if (s.op !== 'desktop' || !/^[a-z0-9-]+$/.test(bot) || !this.desk) return s.end('not-supported');
    const desk = this.desk;
    const send = (m: unknown) => { void s.write(JSON.stringify(m) + '\n').catch(() => {}); };
    const watcher: Watcher = { send: (event) => send({ event }) };
    let buf = '';
    s.onData = async (chunk) => {
      buf += new TextDecoder().decode(chunk);
      if (buf.length > 1 << 20) return s.end('too-large');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let msg: any;
        try { msg = JSON.parse(line); } catch { continue; }
        try { send({ id: msg.id, result: await desk.signal(bot, watcher, String(msg.method), msg.params ?? {}, g.role === 'control') }); }
        catch (e: any) { send({ id: msg.id, error: { code: e.code ?? 'engine', message: e.message } }); }
      }
    };
    s.onEnd = () => desk.release(watcher);
  }

  /** Tell the person's phones there is news. Content-free: the words stay on this computer until the phone asks. In their
   *  quiet hours the push is held (kept in the store, so a restart keeps it) and `sendHeld` sends one when they end. */
  private async tell(id: string) {
    if (this.quiet()) return void this.db.run("INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO NOTHING", 'push.held.1');
    const to = [...this.host.devices().map((g) => g.id), WEB_DEVICE];
    const phones = to.map((d) => [d, this.setting(`phone.push.${d}`)]).filter(([, t]) => isExpoToken(t));
    if (phones.length) await this.expo(id, phones as [string, string][]).catch((e) => console.error('push:', e.message));
    // A browser's Web Push address is kept on the person's relay, which holds the key for it.
    if (this.client && this.relayStatus === 'online') await this.client.notify({ id, title: NEWS, to }).catch((e) => console.error('push:', e.message));
  }

  /** One content-free push per phone through Expo. Expo refusing the app's credential (none set up yet) is kept for
   *  Settings to say once; a phone Expo no longer knows loses its token. */
  private async expo(id: string, phones: [string, string][]) {
    const res = await fetch(this.pushUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify(phones.map(([, to]) => ({ to, title: NEWS, sound: 'default', collapseId: id }))) });
    const tickets: any[] = (await res.json().catch(() => null))?.data ?? [];
    tickets.forEach((t, i) => {
      if (t?.status === 'ok') this.db.run("DELETE FROM settings WHERE key = 'push.refused'");
      else if (t?.details?.error === 'InvalidCredentials') this.put('push.refused', '1');
      else if (t?.details?.error === 'DeviceNotRegistered') this.db.run('DELETE FROM settings WHERE key = ?', `phone.push.${phones[i][0]}`);
    });
  }

  /** Quiet hours over: one push for everything that came in during them, however much it was. */
  sendHeld(at = Date.now()) {
    if (this.quiet() || !this.setting('push.held.1')) return;
    this.db.run("DELETE FROM settings WHERE key = 'push.held.1'");
    void this.tell(`held-1-${at}`);
  }

  /** What a phone hears about: a question, a job finished or stuck, and Chief speaking to the person. */
  private news(e: { seq: number; kind: string; data: any; bot: string | null }) {
    let news = e.kind === 'ask.opened' || e.kind === 'alert' || (e.kind === 'message' && e.bot === 'chief' && e.data.author === 'bot');
    if (e.kind === 'task.done') {
      const t = this.db.get('SELECT bot, result FROM tasks WHERE id = ?', e.data.task);
      news = !!t && t.bot !== 'chief' && t.result !== 'All clear';
    }
    if (news) void this.tell(`e${e.seq}`);
  }

  /** Settings, Phones: how phones reach this computer, and any phone waiting for a yes (docs/ui-contract.md). */
  status() {
    // `push: 'missing'`: this app build, or Expo, has no Android push credential yet (README, "Phone notifications").
    const missing = this.setting('push.refused') || this.host?.devices().some((g) => this.setting(`phone.push.${g.id}`) === 'missing');
    return { on: this.cfg.linkPort > 0, lan: this.lan, pinned: !!this.cfg.linkHost, hosts: [...this.servers.keys()], tailscale: routes(this.ifaces(), this.tailnetIPs).tailscale.length > 0, anywhere: this.anywhere,
      relay: this.relay, relayStatus: this.relayStatus, vapid: this.client?.vapidKey ?? null, push: missing ? 'missing' : 'ready',
      asking: [...this.asking.values()].map(({ id, name, words, role, offer }) => ({ id, name, words, role, offer })) };
  }

  /** A single-use QR for the person's phone. */
  async offer(role: string, offer?: string): Promise<{ qr: string; typed: string; expires: number; urls: string[] }> {
    if (role !== 'control' && role !== 'view') throw Object.assign(new Error('role is control or view'), { status: 400 });
    // The home network opens for as long as the code lasts (and a phone that joins keeps its socket); Tailscale may have
    // come up since crewd started.
    this.pairing = Date.now() + PAIR_MS;
    clearTimeout(this.shut);
    this.shut = setTimeout(() => void this.bind(), PAIR_MS + 100).unref();
    await this.bind();
    const urls = this.urls();
    const { text, expires } = this.host.offer({ role, urls, meta: { offer } });
    const raw = parseOffer(text);
    return { qr: text, typed: encodeOffer(raw), expires, urls };
  }

  /** Codes to type instead of scanning, through the relay: its short code (which computer) and link's pairing code. */
  async typed(role: string) {
    if (role !== 'control' && role !== 'view') throw Object.assign(new Error('role is control or view'), { status: 400 });
    if (!this.client || this.relayStatus !== 'online') throw Object.assign(new Error('typing a code works once this computer is reachable from anywhere'), { status: 409 });
    const { code: short, expires } = await this.client.code();
    const { code } = this.host.code({ role });
    return { short, code, relay: this.relay, expires };
  }

  devices() {
    return this.host.devices().map((g) => ({ id: g.id, name: g.name, role: g.role,
      seen: g.lastSeen ?? g.created, online: g.online, reached: this.reached(g.id), push: pushOf(this.setting(`phone.push.${g.id}`)) }));
  }

  async setWebPush(sub: any) {
    if (sub?.off === true) return void await this.client?.unsubscribe(WEB_DEVICE, sub.web && { web: sub.web });
    if (!this.client || typeof sub?.web !== 'object') throw Object.assign(new Error('no relay for notifications'), { status: 409 });
    await this.client.subscribe(WEB_DEVICE, { web: sub.web });
  }
  async revoke(id: string) {
    if (!this.host.devices().some((g) => g.id === id)) throw Object.assign(new Error('no such device'), { status: 404 });
    // Said inside the encrypted channel; the phone forgets its grant only then. Through the relay, its push addresses go too.
    if (this.client) await this.client.revoke(id); else await this.host.revoke(id);
  }

  /** One request from a phone, as `METHOD /path`: answered like HTTP. `key` is the
   *  device's idempotency key; mutating handlers record it with their effect (same transaction). */
  private async request(op: string, body: unknown, g: Grant, key?: string): Promise<{ status: number; body: unknown }> {
    const [method, path = ''] = op.split(' ', 2);
    if (!currentPhone(body)) return op === 'GET /api/bots/chief' ? { status: 200, body: { messages: [{ id: 1, author: 'bot', text: '[Get the latest Crewhouse app](https://github.com/umeranjum17/crewhouse/releases/tag/v1.0.0-preview.20261001.16) to keep chatting.' }], tasks: [] } } : op === 'GET /api/state' ? { status: 200, body: {
      person: { id: 1, name: '', address: '', onboarded: 1 }, bots: [{ id: 'chief', display: 'Chief', last: { author: 'bot', text: UPDATE_APP } }],
      asks: [], tasks: [], events: [], ideas: [], templates: [], routines: [], resting: {}, connections: [], room: { last: null, busy: [] },
    } } : { status: 426, body: { error: UPDATE_APP } };
    if (!path.startsWith('/api/')) return { status: 404, body: { error: 'not found' } };
    // The phone's own: every address it can reach this computer at now (a phone paired at home learns Tailscale and the
    // relay), and its push address.
    // The phone says which route it came by and its own Tailscale address; the computer says whether its Tailscale has
    // that address as a peer (shared with this phone's account), for the words when the phone later can't reach it.
    if (op === 'GET /api/reach') {
      const a = (body ?? {}) as { via?: unknown; ip?: unknown };
      if (ROUTES.includes(a.via as string)) this.put(`phone.reach.${g.id}`, JSON.stringify({ ...this.reached(g.id), [a.via as string]: Date.now() }));
      const peer = typeof a.ip === 'string' ? await tailscalePeer(a.ip, this.tailscaleBin) : undefined;
      return { status: 200, body: { urls: this.urls(), anywhere: this.anywhere, peer, reached: this.reached(g.id) } };
    }
    // Its push address: an Expo token (kept here; crewd sends through Expo), `{missing}` when this app build has no push
    // credential, `{off}` when the person said no to notifications; a browser's Web Push address goes to the relay.
    if (op === 'POST /api/push') {
      const sub = body as any;
      const phone = isExpoToken(sub?.expo) ? sub.expo : sub?.missing === true ? 'missing' : sub?.off === true ? 'off' : '';
      if (phone) { this.put(`phone.push.${g.id}`, phone); this.db.event('device.push', null, { id: g.id }); return { status: 200, body: { ok: true } }; }
      if (!this.client || typeof sub?.web !== 'object') return { status: 409, body: { error: 'no relay for notifications' } };
      await this.client.subscribe(g.id, { web: sub.web });
      return { status: 200, body: { ok: true } };
    }
    // Settings stay on the computer: AI account sign-ins, people, Google setup, connecting apps
    // (their sign-in pages come back to this computer's own address), and the phones themselves — except the person's
    // phone renewing a code it is looking at, so the pairing card on the phone refreshes itself like the web card's.
    if (op === 'POST /api/phones/refresh') return this.handle(method, path, body ?? {}, key).then(
      (r) => ({ status: 200, body: r }), (e: any) => ({ status: e.status ?? 400, body: { error: e.message } }));
    if (/^\/api\/(accounts|house|phones)\b/.test(path) || (/^\/api\/(people|connections)\b/.test(path) && method !== 'GET')) return { status: 403, body: { error: 'do that on the computer' } };
    try { return { status: 200, body: await this.handle(method, path, body ?? {}, key) }; }
    catch (e: any) { return { status: e.status ?? 400, body: { error: e.message } }; }
  }

  async listen() {
    await this.open();
    this.db.onEvent((e) => this.news(e as any));
    await this.bind();
    this.dial();
    this.watch = setInterval(() => { void this.bind(); this.sendHeld(); }, 30_000).unref();
  }

  close() { clearInterval(this.watch); clearTimeout(this.shut); void this.mdns?.stop().catch(() => {}); this.client?.stop(); this.host?.close(); for (const s of this.servers.values()) s.close(); }
}
