// Connecting a person's apps (Notion, Canva, Google…) the easy way: one Connect button, the app's own sign-in page,
// back to Crewhouse, done. Each app is a remote MCP server behind OAuth; the tokens are that person's alone, kept in their
// own folder under Crewhouse's, refreshed in the background, and never shown to a bot or to the app screen.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { tool, type CrewTool } from './engine.ts';
import { CALENDAR, calendarTool, events } from './calendar.ts';
import { GMAIL, mailTool } from './mail.ts';

export { CALENDAR };

export interface App {
  name: string;
  /** Google's apps share the person's one registered Google app (the person sets it up once: docs/google-setup.md). */
  google?: boolean;
  /** Google shows its "unverified app" screen for this one; the Connect card warns first. */
  warns?: boolean;
  /** The app's MCP servers: their tools become the bots' tools, named `<app>_<tool>`. */
  servers: string[];
  /** Or crewd's own one-tool AXI for it, on the person's token (its commands are gated in src/policy.ts). */
  tool?: (token: () => Promise<string | null>) => CrewTool;
  /** Where OAuth is discovered (RFC 8414) and clients register themselves (RFC 7591): nothing to set up. */
  issuer?: string;
  /** Or fixed endpoints with the person's own registered app (Google), read from <state>/apps.json. */
  oauth?: { authorize: string; token: string; scopes: string[]; extra?: Record<string, string> };
  /** Google's: the API the person enables in step 2, and one small read that proves a new connection works. */
  api?: string;
  check?: string;
}

const google = (scope: string, api: string, check: string, server?: string) => ({
  api, check, servers: server ? [`https://${server}.googleapis.com/mcp/v1`] : [],
  oauth: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    scopes: [`https://www.googleapis.com/auth/${scope}`], extra: { access_type: 'offline', prompt: 'consent' } },
});
/** v1: one Google service per connection (several at once makes Google show tick-boxes, and an unticked box is a partial
 *  grant). Drive's scope is non-sensitive, so Google shows no warning; Calendar and Gmail show the unverified-app screen. */
export const APPS: Record<string, App> = {
  drive: { name: 'Google Drive', google: true, ...google('drive.file', 'Google Drive API', 'https://www.googleapis.com/drive/v3/about?fields=user', 'drivemcp') },
  calendar: { name: 'Google Calendar', google: true, warns: true, ...google('calendar.events', 'Google Calendar API', `${CALENDAR}/calendars/primary/events?maxResults=1`), tool: calendarTool },
  gmail: { name: 'Gmail', google: true, warns: true, ...google('gmail.readonly', 'Gmail API', `${GMAIL}/profile`), tool: mailTool },
  notion: { name: 'Notion', servers: ['https://mcp.notion.com/mcp'], issuer: 'https://mcp.notion.com' },
  canva: { name: 'Canva', servers: ['https://mcp.canva.com/mcp'], issuer: 'https://mcp.canva.com' },
};

type Tokens = { access: string; refresh?: string; expires: number; scope?: string; lasts?: number };
type Endpoints = { authorize: string; token: string; register?: string; scopes: string[]; extra?: Record<string, string> };
export type Connecting = { state: 'waiting' | 'done' | 'failed'; url?: string; error?: string; why?: 'declined' | 'unticked'; step?: number };
/** Evidence about the person's four steps (docs/google-setup.md), gathered from what Google actually answered. */
type Proof = { published?: boolean; apis?: Record<string, boolean> };
export type Step = { state: 'checked' | 'said' | 'missing'; note: string };

/** Which of the person's four steps a failure from Google points back to. */
export const stepOf = (error: string) =>
  /^testing|org_internal/.test(error) ? 3 : error === 'disabled' ? 2 : /invalid_client|unauthorized_client|deleted_client|redirect_uri_mismatch/.test(error) ? 4 : undefined;

const CONNECT_MS = Number(process.env.CREWHOUSE_SIGNIN_MS || 15 * 60_000);

/** A failed connection in one plain sentence with one next step. */
export function connectError(name: string, error: string, api = name) {
  if (error === 'testing') return `Your Google app is still in Testing, so Google would cut ${name} off within a week. Step 3 of Google setup: press Publish app.`;
  if (error === 'org_internal') return `Your Google app is set to Internal, so Google may turn you away. Step 3 of Google setup: make it External.`;
  if (error === 'disabled') return `${api} isn't switched on in your Google project yet. Step 2 of Google setup: enable ${api}.`;
  if (stepOf(error) === 4) return `Google didn't accept your key. Step 4 of Google setup: make a “Desktop app” key and paste it again.`;
  if (error === 'unread') return `${name} said yes, but Crewhouse couldn't read anything back from it, so it isn't connected. Tap Connect to try again.`;
  if (/unticked/.test(error)) return `${name} still isn't ticked. Tap Connect, then tick ${name} on Google's page.`;
  if (/access_denied|denied|declined/i.test(error)) return `No problem, nothing was connected. Tap Connect whenever you'd like to try again.`;
  if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN|timed? ?out/i.test(error)) return `Couldn't reach ${name}. Check the internet connection, then tap Connect again.`;
  return `${name} didn't finish connecting. Tap Connect to try again.`;
}

export class Connections {
  private cfg: Config;
  private redirect: string;
  apps: Record<string, App> = { ...APPS };
  private flows = new Map<string, Connecting & { app: string; verifier: string; ends: Endpoints; client: { id: string; secret?: string }; timer: NodeJS.Timeout }>();
  private views = new Map<string, Connecting>();
  onChange?: (app: string) => void;
  onExpired?: (app: string) => void;

  /** `redirect` is crewd's own loopback address: the app's page sends the browser back there. */
  constructor(cfg: Config, redirect: string) { this.cfg = cfg; this.redirect = redirect; }

  private app(id: string) {
    const a = this.apps[id];
    if (!a) throw Object.assign(new Error('no such app'), { status: 404 });
    return a;
  }
  private file() { return join(this.cfg.stateDir, 'people', '1', 'connections.json'); }
  private read(): Record<string, Tokens> { const f = this.file(); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; }
  private write(all: Record<string, Tokens>) {
    mkdirSync(join(this.cfg.stateDir, 'people', '1'), { recursive: true, mode: 0o700 });
    writeFileSync(this.file(), JSON.stringify(all, null, 2), { mode: 0o600 });
  }
  /** Registrations and the person's own app ids, kept for this install (they are not anyone's sign-in). */
  private clients(): Record<string, { id: string; secret?: string; redirect?: string; proof?: Proof }> {
    const f = join(this.cfg.stateDir, 'apps.json');
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  }
  private clientKey = (id: string) => (this.apps[id]?.google ? 'google' : id);

  /** Whether Google is switched on (docs/google-setup.md). */
  houseGoogle() { return !!this.clients().google?.id; }

  /** The person pastes your Google app's client ID and secret, once. Kept only once Google itself has taken them:
   *  a wrong paste, a key Google doesn't know, or a key that isn't a Desktop app is said in plain words and not saved. */
  async setHouseGoogle(rawId: unknown, rawSecret: unknown) {
    const id = String(rawId ?? '').trim(), secret = String(rawSecret ?? '').trim();
    const bad = (m: string, status = 400) => Object.assign(new Error(m), { status });
    if (/^GOCSPX-/.test(id)) throw bad("That's the Client secret. It goes in the second box; the first takes the Client ID, which ends in .apps.googleusercontent.com.");
    if (/\.apps\.googleusercontent\.com$/.test(secret)) throw bad("That's the Client ID again. The second box takes the Client secret, which starts with GOCSPX-.");
    if (!/^\d+-\w+\.apps\.googleusercontent\.com$/.test(id)) throw bad("That doesn't look like a Client ID. Copy it from step 4; it ends in .apps.googleusercontent.com.");
    if (!/^[\w-]{20,64}$/.test(secret)) throw bad("That doesn't look like a Client secret. Copy it from step 4; it starts with GOCSPX-.");
    const g = this.apps.calendar.oauth!;
    // Google checks the key before the code, so a made-up code answers invalid_grant only when the ID and secret are right.
    const said: any = await fetch(g.token, { method: 'POST', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: 'crewhouse-check', client_id: id, client_secret: secret, redirect_uri: this.redirect }) }).then((r) => r.json()).catch(() => null);
    if (!said) throw bad("Couldn't reach Google to check the key. Check the internet connection, then try again.", 502);
    if (said.error === 'invalid_client') throw bad(/not found/i.test(said.error_description ?? '')
      ? "Google doesn't know that Client ID. Copy it again from step 4, or make a new key there."
      : "Google says that Client secret doesn't belong to that Client ID. Copy both again from the same key in step 4.");
    if (said.error !== 'invalid_grant') throw bad("Google didn't accept that key. Make a new “Desktop app” key in step 4 and paste that.");
    // Google's sign-in page, asked the way a Connect asks it: a website's key is refused for this computer's return address.
    // ponytail: reads Google's error redirect, which isn't a documented API; if it changes, this check just passes.
    const url = new URL(g.authorize);
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: id, redirect_uri: this.redirect, scope: g.scopes.join(' ') })) url.searchParams.set(k, v);
    const to = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) }).then((r) => r.headers.get('location') ?? '').catch(() => '');
    const err = to && new URL(to, url).searchParams.get('authError');
    if (err && /redirect_uri_mismatch/.test(Buffer.from(err, 'base64').toString('latin1'))) throw bad("That key is for a website, not this computer. In step 4 make one of type “Desktop app” and paste that.");
    mkdirSync(this.cfg.stateDir, { recursive: true });
    this.saveClients({ ...this.clients(), google: { id, secret, proof: {} } });
  }
  private saveClients(all: object) { writeFileSync(join(this.cfg.stateDir, 'apps.json'), JSON.stringify(all, null, 2), { mode: 0o600 }); }

  /** Something Google answered that proves (or disproves) one of the person's steps. */
  private prove(p: Proof) {
    const all = this.clients();
    if (!all.google) return;
    const was = all.google.proof ?? {};
    all.google.proof = { published: p.published ?? was.published, apis: { ...was.apis, ...p.apis } };
    this.saveClients(all);
  }

  /** The person's four steps as far as Crewhouse can tell: checked from Google's own answers, missing when Google said
   *  so, or only "you said done" when nobody has connected yet to find out. Null until the key is pasted. */
  houseSteps(): Step[] | null {
    const g = this.clients().google;
    if (!g?.id) return null;
    const p = g.proof ?? {};
    const google = Object.keys(this.apps).filter((id) => this.apps[id].api);
    const names = (ids: string[]) => ids.map((id) => this.apps[id].api).join(', ').replace(/, ([^,]*)$/, ' and $1');
    const off = google.filter((id) => p.apis?.[id] === false), ok = google.filter((id) => p.apis?.[id]);
    const later = 'Checked the first time you connect.';
    return [
      { state: 'checked', note: 'Google knows the project.' },
      off.length ? { state: 'missing', note: `${names(off)} ${off.length > 1 ? 'are' : 'is'} still off. Enable ${off.length > 1 ? 'them' : 'it'}.` }
        : ok.length === google.length ? { state: 'checked', note: 'Calendar, Gmail and Drive all answered.' }
        : { state: 'said', note: ok.length ? `${names(ok)} answered; the others are checked the first time you connect them.` : later },
      p.published === false ? { state: 'missing', note: 'Still in Testing: press Publish app under Audience.' } : p.published ? { state: 'checked', note: 'Published.' } : { state: 'said', note: later },
      { state: 'checked', note: 'Google took the key.' },
    ];
  }

  connected(app: string) { return !!this.read()[app]; }

  /** The app screen's ids for what is connected. */
  on() { return Object.keys(this.read()).filter((id) => this.apps[id]); }

  /** Where a connection stands, in the app screen's words: waiting, on, expired, declined, unticked, failed or cancelled. */
  status(id: string) {
    if (this.connected(id)) return { state: 'on' };
    const v = this.view(id);
    if (!v) return { state: 'cancelled' };
    return { state: v.state === 'waiting' ? 'waiting' : v.why ?? (/too long|expired/.test(v.error ?? '') ? 'expired' : 'failed'), error: v.error, step: v.step };
  }

  /** The person closed the sheet: a waiting connection stops; a finished one is disconnected. */
  cancel(id: string) {
    for (const [s, f] of this.flows) if (f.app === id) { clearTimeout(f.timer); this.flows.delete(s); }
    if (this.connected(id)) return this.disconnect(id);
    this.views.delete(id);
    this.onChange?.(id);
  }
  view(app: string) { return this.views.get(app) ?? null; }

  /** What the Connections screen lists for one person: plain words only. */
  list() {
    return Object.entries(this.apps).map(([id, a]) => ({
      app: id, name: a.name, connected: this.connected(id), connecting: this.view(id), warns: !!a.warns,
      house: a.google && !this.houseGoogle() ? `${a.name} needs Google switched on for your crew first; set it up once in Settings.` : null,
    }));
  }

  private async endpoints(a: App): Promise<Endpoints> {
    if (a.oauth) return a.oauth;
    const res = await fetch(`${a.issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`discovery ${res.status}`);
    const m: any = await res.json();
    const prm: any = await fetch(`${a.issuer}/.well-known/oauth-protected-resource`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).catch(() => ({}));
    return { authorize: m.authorization_endpoint, token: m.token_endpoint, register: m.registration_endpoint, scopes: prm.scopes_supported ?? m.scopes_supported ?? [] };
  }

  /** This computer's client with the app: registered once by itself where the app allows it, else the person's own app. */
  private async client(id: string, ends: Endpoints) {
    const all = this.clients();
    const c = all[this.clientKey(id)];
    // A registration is for one return address; the person's own app (no address on file) takes any loopback port.
    if (c?.id && (!c.redirect || c.redirect === this.redirect)) return c;
    if (!ends.register) throw Object.assign(new Error('set up Google in Settings first'), { status: 409 });
    const res = await fetch(ends.register, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ client_name: 'Crewhouse', redirect_uris: [this.redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
    });
    if (!res.ok) throw new Error(`register ${res.status}`);
    const fresh = { id: String((await res.json() as any).client_id), redirect: this.redirect };
    this.saveClients({ ...all, [id]: fresh });
    return fresh;
  }

  /** Connect: returns the app's own page to open. The browser comes back to `finish` through crewd's callback.
   *  A Google app before Google is switched on answers 409 (the app points to Settings),
   *  so nobody ever reaches Google's "OAuth client not found" page. */
  async connect(id: string) {
    const a = this.app(id);
    const house = this.list().find((x) => x.app === id)!.house;
    if (house) throw Object.assign(new Error(house), { status: 409 });
    if (this.connected(id)) return { state: 'done' } as Connecting;
    const key = id;
    for (const [s, f] of this.flows) if (f.app === id) { clearTimeout(f.timer); this.flows.delete(s); } // a new try replaces the old
    const view: Connecting = { state: 'waiting' };
    this.views.set(key, view);
    try {
      const ends = await this.endpoints(a);
      const client = await this.client(id, ends);
      const state = randomBytes(16).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const url = new URL(ends.authorize);
      for (const [k, v] of Object.entries({ response_type: 'code', client_id: client.id, redirect_uri: this.redirect, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256', ...(ends.scopes.length ? { scope: ends.scopes.join(' ') } : {}), ...(a.issuer ? { resource: a.issuer } : {}), ...ends.extra })) url.searchParams.set(k, v);
      view.url = url.toString();
      const timer = setTimeout(() => { this.flows.delete(state); Object.assign(view, { state: 'failed', url: undefined, error: `Connecting took too long. Tap Connect to start again.` }); this.onChange?.(id); }, CONNECT_MS);
      this.flows.set(state, { ...view, app: id, verifier, ends, client, timer });
    } catch (e: any) {
      console.error(`connect ${id}:`, e?.message ?? e);
      Object.assign(view, { state: 'failed', error: connectError(a.name, String(e?.message)) });
    }
    this.onChange?.(id);
    return view;
  }

  /** The app's page sent the browser back. Returns the words for that browser tab. */
  async finish(q: URLSearchParams) {
    const f = this.flows.get(q.get('state') ?? '');
    if (!f) return 'This connection link has expired. Go back to Crewhouse and tap Connect again.';
    this.flows.delete(q.get('state')!);
    clearTimeout(f.timer);
    const a = this.app(f.app);
    const view = this.views.get(f.app)!;
    try {
      if (q.get('error')) throw new Error(q.get('error')!);
      const tokens = await this.exchange(f.ends, f.client, { grant_type: 'authorization_code', code: q.get('code') ?? '', redirect_uri: this.redirect, code_verifier: f.verifier });
      // Google lets a box be left unticked: that connection would be half there, so it doesn't count.
      if (a.google && tokens.scope && !f.ends.scopes.every((sc) => tokens.scope!.split(' ').includes(sc))) throw new Error('unticked');
      if (a.check) await this.readBack(f.app, a.check, tokens);
      this.write({ ...this.read(), [f.app]: tokens });
      Object.assign(view, { state: 'done', url: undefined, error: undefined, why: undefined, step: undefined });
      return `${a.name} is connected. You can go back to Crewhouse now.`;
    } catch (e: any) {
      console.error(`connect ${f.app}:`, e?.message ?? e);
      const m = String(e?.message);
      Object.assign(view, { state: 'failed', url: undefined, why: m === 'unticked' ? 'unticked' : /access_denied|denied/i.test(m) ? 'declined' : undefined,
        step: a.google ? stepOf(m) : undefined, error: connectError(a.name, m, a.api) });
      return view.error!;
    } finally {
      this.onChange?.(f.app);
    }
  }

  /** Before "connected": one small read with the new token, so a yes on Google's page that can't actually reach the
   *  person's Calendar, Gmail or Drive is never called connected. What Google answers is kept as proof of the person's steps. */
  private async readBack(id: string, url: string, t: Tokens) {
    // Google says how long a refresh token lasts only when it runs out: a week means the app is still in Testing, and
    // no lifetime means it's published.
    if (t.lasts && t.lasts <= 7 * 86400) { this.prove({ published: false }); throw new Error('testing'); }
    const res = await fetch(url, { headers: { authorization: `Bearer ${t.access}` }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return this.prove({ published: true, apis: { [id]: true } });
    const body = await res.text().catch(() => '');
    if (/SERVICE_DISABLED|accessNotConfigured/.test(body)) { this.prove({ published: true, apis: { [id]: false } }); throw new Error('disabled'); }
    throw new Error('unread');
  }

  private async exchange(ends: Endpoints, client: { id: string; secret?: string }, form: Record<string, string>): Promise<Tokens> {
    const res = await fetch(ends.token, {
      method: 'POST', signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ ...form, client_id: client.id, ...(client.secret ? { client_secret: client.secret } : {}) }),
    });
    const t: any = await res.json().catch(() => ({}));
    if (!res.ok || !t.access_token) throw new Error(t.error ?? `token ${res.status}`);
    return { access: t.access_token, refresh: t.refresh_token ?? form.refresh_token, expires: Date.now() + (Number(t.expires_in) || 3600) * 1000, scope: t.scope, lasts: Number(t.refresh_token_expires_in) || undefined };
  }

  /** A working access token, refreshed when it is close to running out. A refused refresh disconnects and says so once. */
  async token(id: string): Promise<string | null> {
    const all = this.read();
    const t = all[id];
    if (!t) return null;
    if (t.expires - Date.now() > 5 * 60_000) return t.access;
    try {
      const ends = await this.endpoints(this.app(id));
      const fresh = await this.exchange(ends, await this.client(id, ends), { grant_type: 'refresh_token', refresh_token: t.refresh ?? '' });
      this.write({ ...this.read(), [id]: fresh });
      return fresh.access;
    } catch (e: any) {
      if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN|timed? ?out/i.test(String(e?.message))) return t.access; // offline, not revoked
      this.disconnect(id);
      this.onExpired?.(id);
      return null;
    }
  }

  /** Today's events on the person's own Google Calendar, read by crewd itself for the morning digest (no AI). All-day
   *  events have no time. Null when Calendar isn't connected or can't be read right now. */
  async today(): Promise<{ at: number | null; title: string }[] | null> {
    if (!this.connected('calendar')) return null;
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const list = await events(() => this.token('calendar'), from, new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1)).catch(() => null);
    return list && list.slice(0, 12).map((e) => ({ at: e.allDay ? null : e.start.getTime(), title: e.title }));
  }

  disconnect(id: string) {
    const { [id]: _gone, ...rest } = this.read();
    this.write(rest);
    this.views.delete(id);
    this.onChange?.(id);
  }

  /** Refresh every connection now and then, so none lapses while nobody is looking. */
  async keepFresh() {
    for (const id of Object.keys(this.read())) await this.token(id).catch(() => null);
  }

  // The person's connected apps as bot tools, cached by connected set: listing remote tools costs MCP handshakes,
  // and every send used to pay them before the first model turn. A connect or disconnect changes the set, so the
  // cache keys on it; a token refresh keeps the set and stays cached (tools take their token live, per call).
  private toolCache?: { key: string; out: Promise<{ tools: CrewTool[]; effects: Record<string, AppTool> }> };
  tools(): Promise<{ tools: CrewTool[]; effects: Record<string, AppTool> }> {
    const key = Object.keys(this.read()).sort().join(',');
    const hit = this.toolCache;
    if (hit && hit.key === key) return hit.out;
    const out = this.loadTools();
    this.toolCache = { key, out };
    out.catch(() => { if (this.toolCache?.out === out) this.toolCache = undefined; }); // a failure pins nothing
    return out;
  }
  /** The person's connected apps as bot tools, with what each tool does to the world (for the gate). */
  private async loadTools(): Promise<{ tools: CrewTool[]; effects: Record<string, AppTool> }> {
    const tools: CrewTool[] = [];
    const effects: Record<string, AppTool> = {};
    for (const id of Object.keys(this.read())) {
      const a = this.apps[id];
      if (!a) continue;
      if (a.tool) tools.push(a.tool(() => this.token(id)));
      for (const server of a.servers) {
        try {
          const mcp = new RemoteMcp(server, () => this.token(id));
          await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'crewhouse', version: '1' } });
          const { tools: list } = await mcp.request('tools/list', {});
          for (const t of list) {
            const name = `${id}_${t.name}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
            effects[name] = { app: a.name, title: String(t.annotations?.title ?? t.title ?? t.name).replace(/[-_]/g, ' '), readOnly: t.annotations?.readOnlyHint === true, destructive: t.annotations?.destructiveHint === true };
            tools.push(tool(name, `${a.name}: ${t.description ?? t.title ?? t.name}`, t.inputSchema ?? { type: 'object' },
              async (args) => {
                const r = await mcp.request('tools/call', { name: t.name, arguments: args });
                return (r.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
              }));
          }
        } catch (e) { console.error(`${id} tools:`, e); }
      }
    }
    return { tools, effects };
  }
}

export type AppTool = { app: string; title: string; readOnly: boolean; destructive: boolean };

/** Streamable-HTTP MCP: JSON-RPC over POST, answered as JSON or as a short event stream. */
class RemoteMcp {
  private url: string;
  private auth: () => Promise<string | null>;
  private session?: string;
  private next = 1;
  constructor(url: string, auth: () => Promise<string | null>) { this.url = url; this.auth = auth; }

  async request(method: string, params: object): Promise<any> {
    const token = await this.auth();
    if (!token) throw new Error('not connected');
    const id = this.next++;
    const res = await fetch(this.url, {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...(this.session ? { 'mcp-session-id': this.session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    this.session = res.headers.get('mcp-session-id') ?? this.session;
    const body = await res.text();
    if (!res.ok) throw new Error(`${method} ${res.status}`);
    const msgs = /event-stream/.test(res.headers.get('content-type') ?? '')
      ? body.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)))
      : [JSON.parse(body)];
    const m = msgs.find((x) => x.id === id);
    if (!m) throw new Error(`${method}: no answer`);
    if (m.error) throw new Error(m.error.message);
    if (method === 'initialize') {
      void fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(this.session ? { 'mcp-session-id': this.session } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }).catch(() => {});
    }
    return m.result;
  }
}
