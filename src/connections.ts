// Connecting a person's apps (Notion, Canva, Google…) the Muse way: one Connect button, the app's own sign-in page,
// back to Crewhouse, done. Each app is a remote MCP server behind OAuth; the tokens are that person's alone, kept in their
// own folder under Crewhouse's, refreshed in the background, and never shown to a bot or to the app screen.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import type { Config } from './config.ts';

export interface App {
  name: string;
  /** The app's MCP servers: their tools become the bots' tools, named `<app>_<tool>`. */
  servers: string[];
  /** Where OAuth is discovered (RFC 8414) and clients register themselves (RFC 7591): nothing to set up. */
  issuer?: string;
  /** Or fixed endpoints with the household's own registered app (Google), read from <state>/apps.json. */
  oauth?: { authorize: string; token: string; scopes: string[]; extra?: Record<string, string> };
  /** Listed, but not connectable yet: what the person is told instead. */
  soon?: string;
}

export const APPS: Record<string, App> = {
  google: {
    name: 'Google', servers: ['https://gmailmcp.googleapis.com/mcp/v1', 'https://calendarmcp.googleapis.com/mcp/v1', 'https://drivemcp.googleapis.com/mcp/v1'],
    oauth: {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
      scopes: ['gmail.readonly', 'gmail.compose', 'calendar.events', 'drive.file'].map((s) => `https://www.googleapis.com/auth/${s}`),
      extra: { access_type: 'offline', prompt: 'consent' },
    },
  },
  notion: { name: 'Notion', servers: ['https://mcp.notion.com/mcp'], issuer: 'https://mcp.notion.com' },
  canva: { name: 'Canva', servers: ['https://mcp.canva.com/mcp'], issuer: 'https://mcp.canva.com' },
  outlook: { name: 'Outlook', servers: [], soon: 'Outlook is coming soon. Until then, a helper can use it in its own browser once you sign in there.' },
};

type Tokens = { access: string; refresh?: string; expires: number };
type Endpoints = { authorize: string; token: string; register?: string; scopes: string[]; extra?: Record<string, string> };
export type Connecting = { state: 'waiting' | 'done' | 'failed'; url?: string; error?: string };

const CONNECT_MS = Number(process.env.CREWHOUSE_SIGNIN_MS || 15 * 60_000);

/** A failed connection in one plain sentence with one next step. */
export function connectError(name: string, error: string) {
  if (/access_denied|denied|declined/i.test(error)) return `The connection was declined on ${name}'s page. Tap Connect to try again.`;
  if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN|timed? ?out/i.test(error)) return `Couldn't reach ${name}. Check the internet connection, then tap Connect again.`;
  return `${name} didn't finish connecting. Tap Connect to try again.`;
}

export class Connections {
  private cfg: Config;
  private redirect: string;
  apps: Record<string, App> = { ...APPS };
  private flows = new Map<string, Connecting & { member: number; app: string; verifier: string; ends: Endpoints; client: { id: string; secret?: string }; timer: NodeJS.Timeout }>();
  private views = new Map<string, Connecting>();
  onChange?: (member: number, app: string) => void;
  onExpired?: (member: number, app: string) => void;

  /** `redirect` is crewd's own loopback address: the app's page sends the browser back there. */
  constructor(cfg: Config, redirect: string) { this.cfg = cfg; this.redirect = redirect; }

  private app(id: string) {
    const a = this.apps[id];
    if (!a) throw Object.assign(new Error('no such app'), { status: 404 });
    return a;
  }
  private file(member: number) { return join(this.cfg.stateDir, 'people', String(member), 'connections.json'); }
  private read(member: number): Record<string, Tokens> { const f = this.file(member); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; }
  private write(member: number, all: Record<string, Tokens>) {
    mkdirSync(join(this.cfg.stateDir, 'people', String(member)), { recursive: true, mode: 0o700 });
    writeFileSync(this.file(member), JSON.stringify(all, null, 2), { mode: 0o600 });
  }
  /** Registrations and the household's own app ids, shared by everyone in the house (they are not anyone's sign-in). */
  private clients(): Record<string, { id: string; secret?: string; redirect?: string }> {
    const f = join(this.cfg.stateDir, 'apps.json');
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  }

  connected(member: number, app: string) { return !!this.read(member)[app]; }
  view(member: number, app: string) { return this.views.get(`${member}:${app}`) ?? null; }

  /** What the Connections screen lists for one person: plain words only. */
  list(member: number) {
    return Object.entries(this.apps).map(([id, a]) => ({
      app: id, name: a.name, connected: this.connected(member, id), connecting: this.view(member, id),
      soon: a.soon ?? (a.oauth && !this.clients()[id] ? `${a.name} needs the household's own ${a.name} app first; the owner sets it up once in Settings.` : null),
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

  /** This computer's client with the app: registered once by itself where the app allows it, else the household's own app. */
  private async client(id: string, ends: Endpoints) {
    const all = this.clients();
    // A registration is for one return address; the household's own app (no address on file) takes any loopback port.
    if (all[id]?.id && (!all[id].redirect || all[id].redirect === this.redirect)) return all[id];
    if (!ends.register) throw Object.assign(new Error('needs the household app'), { status: 409 });
    const res = await fetch(ends.register, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ client_name: 'Crewhouse', redirect_uris: [this.redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
    });
    if (!res.ok) throw new Error(`register ${res.status}`);
    const c = { id: String((await res.json() as any).client_id), redirect: this.redirect };
    writeFileSync(join(this.cfg.stateDir, 'apps.json'), JSON.stringify({ ...all, [id]: c }, null, 2), { mode: 0o600 });
    return c;
  }

  /** Connect: returns the app's own page to open. The browser comes back to `finish` through crewd's callback. */
  async connect(member: number, id: string) {
    const a = this.app(id);
    if (a.soon) throw Object.assign(new Error(a.soon), { status: 409 });
    const key = `${member}:${id}`;
    for (const [s, f] of this.flows) if (f.member === member && f.app === id) { clearTimeout(f.timer); this.flows.delete(s); } // a new try replaces the old
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
      const timer = setTimeout(() => { this.flows.delete(state); Object.assign(view, { state: 'failed', url: undefined, error: `Connecting took too long. Tap Connect to start again.` }); this.onChange?.(member, id); }, CONNECT_MS);
      this.flows.set(state, { ...view, member, app: id, verifier, ends, client, timer });
    } catch (e: any) {
      console.error(`connect ${id} for member ${member}:`, e?.message ?? e);
      Object.assign(view, { state: 'failed', error: e.status === 409 ? this.list(member).find((x) => x.app === id)!.soon : connectError(a.name, String(e?.message)) });
    }
    this.onChange?.(member, id);
    return view;
  }

  /** The app's page sent the browser back. Returns the words for that browser tab. */
  async finish(q: URLSearchParams) {
    const f = this.flows.get(q.get('state') ?? '');
    if (!f) return 'This connection link has expired. Go back to Crewhouse and tap Connect again.';
    this.flows.delete(q.get('state')!);
    clearTimeout(f.timer);
    const a = this.app(f.app);
    const view = this.views.get(`${f.member}:${f.app}`)!;
    try {
      if (q.get('error')) throw new Error(q.get('error')!);
      const tokens = await this.exchange(f.ends, f.client, { grant_type: 'authorization_code', code: q.get('code') ?? '', redirect_uri: this.redirect, code_verifier: f.verifier });
      this.write(f.member, { ...this.read(f.member), [f.app]: tokens });
      Object.assign(view, { state: 'done', url: undefined, error: undefined });
      return `${a.name} is connected. You can close this tab.`;
    } catch (e: any) {
      console.error(`connect ${f.app} for member ${f.member}:`, e?.message ?? e);
      Object.assign(view, { state: 'failed', url: undefined, error: connectError(a.name, String(e?.message)) });
      return view.error!;
    } finally {
      this.onChange?.(f.member, f.app);
    }
  }

  private async exchange(ends: Endpoints, client: { id: string; secret?: string }, form: Record<string, string>): Promise<Tokens> {
    const res = await fetch(ends.token, {
      method: 'POST', signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ ...form, client_id: client.id, ...(client.secret ? { client_secret: client.secret } : {}) }),
    });
    const t: any = await res.json().catch(() => ({}));
    if (!res.ok || !t.access_token) throw new Error(t.error ?? `token ${res.status}`);
    return { access: t.access_token, refresh: t.refresh_token ?? form.refresh_token, expires: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
  }

  /** A working access token, refreshed when it is close to running out. A refused refresh disconnects and says so once. */
  async token(member: number, id: string): Promise<string | null> {
    const all = this.read(member);
    const t = all[id];
    if (!t) return null;
    if (t.expires - Date.now() > 5 * 60_000) return t.access;
    try {
      const ends = await this.endpoints(this.app(id));
      const fresh = await this.exchange(ends, await this.client(id, ends), { grant_type: 'refresh_token', refresh_token: t.refresh ?? '' });
      this.write(member, { ...this.read(member), [id]: fresh });
      return fresh.access;
    } catch (e: any) {
      if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN|timed? ?out/i.test(String(e?.message))) return t.access; // offline, not revoked
      this.disconnect(member, id);
      this.onExpired?.(member, id);
      return null;
    }
  }

  disconnect(member: number, id: string) {
    const { [id]: _gone, ...rest } = this.read(member);
    this.write(member, rest);
    this.views.delete(`${member}:${id}`);
    this.onChange?.(member, id);
  }

  /** Refresh every connection now and then, so none lapses while nobody is looking. */
  async keepFresh(members: number[]) {
    for (const m of members) for (const id of Object.keys(this.read(m))) await this.token(m, id).catch(() => null);
  }

  /** The member's connected apps as bot tools, with what each tool does to the world (for the gate). */
  async tools(member: number): Promise<{ tools: ToolDefinition[]; effects: Record<string, AppTool> }> {
    const tools: ToolDefinition[] = [];
    const effects: Record<string, AppTool> = {};
    for (const id of Object.keys(this.read(member))) {
      const a = this.apps[id];
      if (!a) continue;
      for (const server of a.servers) {
        try {
          const mcp = new RemoteMcp(server, () => this.token(member, id));
          await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'crewhouse', version: '1' } });
          const { tools: list } = await mcp.request('tools/list', {});
          for (const t of list) {
            const name = `${id}_${t.name}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
            effects[name] = { app: a.name, title: String(t.annotations?.title ?? t.title ?? t.name).replace(/[-_]/g, ' '), readOnly: t.annotations?.readOnlyHint === true, destructive: t.annotations?.destructiveHint === true };
            tools.push(defineTool({
              name, label: `${a.name}: ${t.title ?? t.name}`, description: `${a.name}: ${t.description ?? t.name}`, parameters: Type.Unsafe(t.inputSchema ?? { type: 'object' }),
              execute: async (_id, args) => {
                const r = await mcp.request('tools/call', { name: t.name, arguments: args });
                return { content: (r.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => ({ type: 'text', text: c.text })), details: {} };
              },
            }) as ToolDefinition);
          }
        } catch (e) { console.error(`${id} tools for member ${member}:`, e); }
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
