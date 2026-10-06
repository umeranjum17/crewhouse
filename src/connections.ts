// One Connect, the app's own page, back to Crewhouse. BYOKit owns sign-in, grants, refresh and MCP;
// Crewhouse owns the person's screen, sealed device store and tool gates.
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { connect, providers, ConnectError, CallToolResultSchema, type Connection, type Provider, type SignIn, type Client } from '@byokit/connect';
import { osKeyringSeal, writeFileAtomic, type Keystore } from '@byokit/secrets/node';
import type { Config } from './config.ts';
import { tool, type CrewTool } from './engine.ts';
import { CALENDAR, calendarTool, events } from './calendar.ts';
import { mailTool, runMail } from './mail.ts';

export { CALENDAR };
export type App = Provider & { google?: boolean; warns?: boolean; tool?: (token: () => Promise<string | null>) => CrewTool };
/** The kit's presets request one Google service at a time; Gmail stays read-only. */
export const APPS: Record<string, App> = {
  drive: { ...providers.drive, google: true },
  calendar: { ...providers.calendar, google: true, warns: true, tool: calendarTool },
  gmail: { ...providers.gmail, google: true, warns: true, tool: mailTool },
  notion: { ...providers.notion }, canva: { ...providers.canva },
};
export type Connecting = { state: 'waiting' | 'done' | 'failed'; url?: string; error?: string; why?: 'declined' | 'unticked'; step?: number; proof?: string };
/** The sign-in was taken but the app did not answer when it was used: our own words, not a kit code. */
class Unusable extends Error {}
export type Step = { state: 'checked' | 'said' | 'missing'; note: string };
const CONNECT_MS = Number(process.env.CREWHOUSE_SIGNIN_MS || 15 * 60_000);

/** Only typed kit diagnostics supply connection words; provider bodies and credentials never reach the screen. */
export function connectError(name: string, error: unknown) {
  if (error instanceof Unusable) return error.message;
  if (error instanceof ConnectError) {
    if (error.code === 'declined') return "No problem, nothing was connected. Tap Connect whenever you'd like to try again.";
    if (error.code === 'scope') return `${name} still isn't ticked. Tap Connect, then tick ${name} on the app's page.`;
    if (error.code === 'expired') return 'Connecting took too long. Tap Connect to start again.';
    if (error.code === 'network') return `Couldn't reach ${name}. Check the internet connection, then tap Connect again.`;
    return error.message;
  }
  return `${name} couldn't open its saved sign-in. Unlock your password storage, then try again.`;
}

/** README's sealed adapter: the durable store receives ciphertext only, with each name authenticated inside it. */
function deviceStore(cfg: Config): Keystore {
  const dir = join(cfg.stateDir, 'people', '1', 'app-signins');
  const seal = osKeyringSeal({ service: 'crewhouse-connect', dualWrap: true });
  const file = (name: string) => {
    if (!/^(google-client|byokit\.connect\.[A-Za-z0-9_-]{43})$/.test(name)) throw new Error('Invalid sign-in name.');
    return join(dir, name);
  };
  const ciphertextStore: Keystore = {
    async get(name) { return existsSync(file(name)) ? readFileSync(file(name), 'utf8') : null; },
    async set(name, value) { writeFileAtomic(file(name), value); },
    async delete(name) { try { unlinkSync(file(name)); return true; } catch (e: any) { if (e.code === 'ENOENT') return false; throw e; } },
  };
  return {
    async get(name) {
      const value = await ciphertextStore.get(name);
      if (value === null) return null;
      const record = JSON.parse(seal.decryptString(Buffer.from(value, 'base64')));
      if (record.name !== name || typeof record.secret !== 'string') throw new Error('Stored sign-in could not be opened.');
      return record.secret;
    },
    async set(name, secret) { await ciphertextStore.set(name, Buffer.from(seal.encryptString(JSON.stringify({ name, secret }))).toString('base64')); },
    delete: name => ciphertextStore.delete(name),
  };
}

type Attempt = { app: string; flow: SignIn; view: Connecting; ends: number; finishing?: boolean };
export class Connections {
  private redirect: string;
  private store: Keystore;
  private googleClient?: { id: string; secret: string };
  apps: Record<string, App> = { ...APPS };
  private handles = new Map<string, { key: string; connection: Connection }>();
  private flows = new Map<string, Attempt>();
  private views = new Map<string, Connecting>();
  private active = new Set<string>();
  private clients = new Map<string, Client>();
  readonly ready: Promise<void>;
  onChange?: (app: string) => void;
  onExpired?: (app: string) => void;
  onProof?: (app: string, words: string) => void;

  constructor(cfg: Config, redirect: string) {
    this.redirect = redirect; this.store = deviceStore(cfg);
    this.ready = this.restore();
  }
  private app(id: string) {
    const a = this.apps[id];
    if (!a) throw Object.assign(new Error('no such app'), { status: 404 });
    return a;
  }
  private handle(id: string) {
    const a = this.app(id), client = a.google ? this.googleClient : undefined;
    const key = JSON.stringify([a, client]);
    const cached = this.handles.get(id);
    if (cached?.key === key) return cached.connection;
    const connection = connect(a, { store: this.store, person: '1', redirectUri: this.redirect, client, clientName: 'Crewhouse', flowTimeoutMs: CONNECT_MS });
    this.handles.set(id, { key, connection });
    return connection;
  }
  private async restore() {
    const saved = await this.store.get('google-client');
    if (saved) this.googleClient = JSON.parse(saved);
    for (const id of Object.keys(this.apps)) {
      try { if (await this.handle(id).connected()) this.active.add(id); }
      catch (e) { this.views.set(id, { state: 'failed', error: connectError(this.apps[id].name, e) }); }
    }
  }
  houseGoogle() { return !!this.googleClient?.id; }
  /** Shape guidance only: the kit checks this key during the person's next sign-in, never by a made-up code. */
  async setHouseGoogle(rawId: unknown, rawSecret: unknown) {
    await this.ready;
    const id = String(rawId ?? '').trim(), secret = String(rawSecret ?? '').trim();
    const bad = (m: string) => Object.assign(new Error(m), { status: 400 });
    if (/^GOCSPX-/.test(id)) throw bad("That's the Client secret. It goes in the second box; the first takes the Client ID, which ends in .apps.googleusercontent.com.");
    if (/\.apps\.googleusercontent\.com$/.test(secret)) throw bad("That's the Client ID again. The second box takes the Client secret, which starts with GOCSPX-.");
    if (!/^\d+-\w+\.apps\.googleusercontent\.com$/.test(id)) throw bad("That doesn't look like a Client ID. Copy it from step 4; it ends in .apps.googleusercontent.com.");
    if (!/^[\w-]{20,64}$/.test(secret)) throw bad("That doesn't look like a Client secret. Copy it from step 4; it starts with GOCSPX-.");
    for (const app of Object.keys(this.apps).filter((a) => this.apps[a].google)) await this.cancel(app);
    await this.store.set('google-client', JSON.stringify({ id, secret }));
    this.googleClient = { id, secret };
  }
  houseSteps(): Step[] | null {
    if (!this.houseGoogle()) return null;
    const accepted = this.on().some((id) => this.apps[id].google);
    return [
      { state: accepted ? 'checked' : 'said', note: accepted ? 'Google knows this setup.' : 'Checked when you connect.' },
      { state: 'said', note: 'Check that Calendar, Gmail and Drive are enabled on Google’s page.' },
      { state: 'said', note: 'Check that Audience says In production on Google’s page.' },
      { state: accepted ? 'checked' : 'said', note: accepted ? 'Google took the sign-in.' : 'Saved. Checked when you connect.' },
    ];
  }
  connected(id: string) { return this.active.has(id); }
  on() { return [...this.active]; }
  status(id: string) {
    if (this.connected(id)) return { state: 'on', proof: this.view(id)?.proof };
    const v = this.view(id);
    if (!v) return { state: 'cancelled' };
    return { state: v.state === 'waiting' ? 'waiting' : v.why ?? (/too long|expired/.test(v.error ?? '') ? 'expired' : 'failed'), error: v.error, step: v.step };
  }
  private cancelFlow(id: string) {
    for (const [state, f] of this.flows) if (f.app === id) { f.flow.cancel(); this.flows.delete(state); }
  }
  async cancel(id: string) {
    this.cancelFlow(id); this.views.delete(id);
    await this.ready;
    await this.disconnect(id);
  }
  view(id: string) {
    for (const [state, f] of this.flows) if (f.app === id && Date.now() >= f.ends) {
      f.flow.cancel(); this.flows.delete(state);
      Object.assign(f.view, { state: 'failed', url: undefined, error: connectError(this.app(id).name, new ConnectError('expired')) });
    }
    return this.views.get(id) ?? null;
  }
  list() {
    return Object.entries(this.apps).map(([id, a]) => ({ app: id, name: a.name, connected: this.connected(id), connecting: this.view(id), warns: !!a.warns,
      house: a.google && !this.houseGoogle() ? `${a.name} needs Google switched on for your crew first; set it up once in Settings.` : null }));
  }
  async connect(id: string) {
    await this.ready;
    const a = this.app(id), house = this.list().find((x) => x.app === id)!.house;
    if (house) throw Object.assign(new Error(house), { status: 409 });
    if (this.connected(id)) return { state: 'done' } as Connecting;
    this.cancelFlow(id);
    const view: Connecting = { state: 'waiting' };
    this.views.set(id, view);
    try {
      const flow = await this.handle(id).signIn();
      if (this.views.get(id) !== view) { flow.cancel(); return { state: 'failed', error: new ConnectError('callback').message } as Connecting; }
      view.url = flow.url;
      this.flows.set(new URL(flow.url).searchParams.get('state')!, { app: id, flow, view, ends: Date.now() + CONNECT_MS });
    } catch (e) { Object.assign(view, { state: 'failed', error: connectError(a.name, e) }); }
    this.onChange?.(id);
    return view;
  }
  /** Routing selects a live kit flow; the kit validates the complete callback, deadline and replay. */
  async finish(callback: URL) {
    const state = callback.searchParams.get('state') ?? '', f = this.flows.get(state);
    if (!f || f.finishing) return 'This connection link has expired. Go back to Crewhouse and tap Connect again.';
    const a = this.app(f.app); f.finishing = true;
    try {
      await f.flow.finish(callback);
      if (this.views.get(f.app) !== f.view) return new ConnectError('declined').message;
      this.active.add(f.app);
      this.toolCache = undefined;
      const proof = await this.proof(f.app);
      Object.assign(f.view, { state: 'done', url: undefined, error: undefined, proof });
      this.onProof?.(f.app, `${a.name} is connected, and it works. ${proof}`);
      return `${a.name} is connected, and it works. ${proof} You can go back to Crewhouse now.`;
    } catch (e) {
      // A grant that saves and then fails at first use is not a connection: it leaves nothing behind to retry from.
      this.active.delete(f.app); this.toolCache = undefined;
      Object.assign(f.view, { state: 'failed', url: undefined, why: e instanceof ConnectError ? e.code === 'scope' ? 'unticked' : e.code === 'declined' ? 'declined' : undefined : undefined, error: connectError(a.name, e) });
      return f.view.error!;
    } finally { f.flow.cancel(); this.flows.delete(state); this.onChange?.(f.app); }
  }
  /** The one real use that proves a connection: what the app answers right now. Nothing is called connected before this
   *  has worked, so a sign-in that saves and then fails at first use is caught here, not in the helper's turn. */
  async proof(id: string) {
    const a = this.app(id), s = (n: number) => (n === 1 ? '' : 's'), bad = () => new Unusable(`${a.name} took the sign-in but didn't answer when we tried to use it, so nothing is connected. Try again in a moment.`);
    if (id === 'calendar') { const day = await this.today().catch(() => null); if (!day) throw bad(); return `You have ${day.length} thing${s(day.length)} on today.`; }
    if (id === 'gmail') { const n = /^unread: (\d+)/.exec(await runMail(() => this.token(id), ['inbox']).catch(() => ''))?.[1]; if (!n) throw bad(); return `You have ${n} unread in your inbox.`; }
    const n = Object.values((await this.tools()).effects).filter((e) => e.app === a.name).length;
    if (!n) throw bad();
    return `Your helper can ask it for ${n} different thing${s(n)}.`;
  }
  private async sync(id: string) {
    if (await this.handle(id).connected() || !this.active.delete(id)) return;
    this.toolCache = undefined;
    await this.clients.get(id)?.close(); this.clients.delete(id);
    this.onChange?.(id); this.onExpired?.(id);
  }
  async token(id: string): Promise<string | null> {
    await this.ready;
    try { return await this.handle(id).token(); }
    catch (e) { if (e instanceof ConnectError && e.code === 'signin') return null; throw e; }
    finally { await this.sync(id); }
  }
  async today(): Promise<{ at: number | null; title: string }[] | null> {
    await this.ready;
    if (!this.connected('calendar')) return null;
    const d = new Date(), from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const list = await events(() => this.token('calendar'), from, new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1)).catch(() => null);
    return list && list.slice(0, 12).map((e) => ({ at: e.allDay ? null : e.start.getTime(), title: e.title }));
  }
  async disconnect(id: string) {
    await this.ready;
    this.cancelFlow(id); this.views.delete(id); this.active.delete(id); this.toolCache = undefined;
    await this.clients.get(id)?.close(); this.clients.delete(id);
    await this.handle(id).disconnect();
    this.onChange?.(id);
  }
  async keepFresh() { await this.ready; for (const id of this.on()) await this.token(id).catch(() => null); }
  async stop() {
    for (const f of this.flows.values()) f.flow.cancel();
    this.flows.clear(); this.views.clear();
    await Promise.all([...this.clients.values()].map((c) => c.close())); this.clients.clear();
  }
  private toolCache?: Promise<{ tools: CrewTool[]; effects: Record<string, AppTool> }>;
  async tools(): Promise<{ tools: CrewTool[]; effects: Record<string, AppTool> }> {
    await this.ready;
    if (this.toolCache) return this.toolCache;
    const out = this.loadTools(); this.toolCache = out;
    out.catch(() => { if (this.toolCache === out) this.toolCache = undefined; });
    return out;
  }
  private async loadTools() {
    const tools: CrewTool[] = [], effects: Record<string, AppTool> = {};
    for (const id of this.on()) {
      const a = this.app(id);
      if (a.tool) tools.push(a.tool(() => this.token(id)));
      if (!a.mcpUrl) continue;
      try {
        const mcp = this.clients.get(id) ?? await this.handle(id).mcp({ clientInfo: { name: 'crewhouse', version: '1' } });
        this.clients.set(id, mcp);
        let cursor: string | undefined;
        do {
          const page = await mcp.listTools(cursor ? { cursor } : undefined);
          for (const t of page.tools) {
            const name = `${id}_${t.name}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
            effects[name] = { app: a.name, title: String(t.annotations?.title ?? t.title ?? t.name).replace(/[-_]/g, ' '), readOnly: t.annotations?.readOnlyHint === true, destructive: t.annotations?.destructiveHint === true };
            tools.push(tool(name, `${a.name}: ${t.description ?? t.title ?? t.name}`, t.inputSchema,
              async (args, signal) => { try { return await mcp.callTool({ name: t.name, arguments: args }, CallToolResultSchema, { signal }); } finally { await this.sync(id); } }));
          }
          cursor = page.nextCursor;
        } while (cursor);
      } catch { this.toolCache = undefined; await this.sync(id); }
    }
    return { tools, effects };
  }
}
export type AppTool = { app: string; title: string; readOnly: boolean; destructive: boolean };
