// A person's sign-in on Pi: a pasted key for an account whose provider answers chat completions, the one shape the model door passes on. The key is checked with one tiny call, sealed in crewd's own store (sealedStore, never Pi's home or the bot's room) and handed to the door per request; it never enters the wall. ChatGPT, Grok and Copilot sign in with a browser or a code and are not on Pi yet.
import { join } from 'node:path';
import { sealedStore } from '../connections.ts'; import type { Config } from '../config.ts'; import { refParts } from '../runtime.ts';

/** The accounts a key signs in, by Crewhouse account key: the provider's address and the model a run takes with nothing picked. CREWHOUSE_PI_ROUTE_BASE points both at a lab provider. */
const ROUTES: Record<string, { name: string; base: string; model: string }> = {
  openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
  minimax: { name: 'MiniMax', base: 'https://api.minimax.io/v1', model: 'MiniMax-M3.1-Flash' },
};
const base = (r: { base: string }) => process.env.CREWHOUSE_PI_ROUTE_BASE || r.base, route = (account: string) => ROUTES[refParts(account)[0]];

export type Provider = { baseUrl: string; apiKey: string };
export const keyed = (account: string) => !!route(account) && !refParts(account)[1];
export const keyedAccounts = () => Object.keys(ROUTES);
export const defaultModel = (account: string) => route(account)?.model;

export class PiKeys {
  private store; private live = new Map<string, Provider>();
  constructor(cfg: Config) { this.store = sealedStore(join(cfg.stateDir, 'pi', 'signins'), 'crewhouse-pi', /^pi-key-[a-z]+$/); }
  /** The provider an account's saved key signs in, read once from the sealed store and kept in memory for the door. */
  async provider(account: string): Promise<Provider | undefined> {
    const r = keyed(account) && route(account);
    if (!r) return undefined;
    if (!this.live.has(account)) { const apiKey = await this.store.get(`pi-key-${account}`).catch(() => null); if (apiKey) this.live.set(account, { baseUrl: base(r), apiKey }); }
    return this.live.get(account);
  }
  /** What the door asks on each request: only a key already read, so a sign-out or a new paste applies at once. */
  door = (account: string) => () => this.live.get(account);
  /** Check a pasted key with one 1-token call: the provider's refusal is the only no. Resolves to the person's words when it fails, nothing when the key is saved. */
  async save(account: string, text: string): Promise<string | undefined> {
    const r = route(account), apiKey = text.trim();
    if (!r || !keyed(account)) return `A second ${r?.name ?? account} account is not supported on Pi yet.`;
    if (!apiKey) return `That key didn't work. Check it and paste it again.`;
    const asked = await fetch(`${base(r).replace(/\/+$/, '')}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: r.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }), signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
    if (!asked || asked.status >= 500) return `${r.name} did not answer. Check your connection, then paste the key again.`;
    if (asked.status === 401 || asked.status === 403) return `That key didn't work. Check it and paste it again.`;
    await this.store.set(`pi-key-${account}`, apiKey); this.live.set(account, { baseUrl: base(r), apiKey });
  }
  async drop(account: string) { this.live.delete(account); await this.store.delete(`pi-key-${account}`).catch(() => false); }
  /** The models the key's account offers: the provider's own list, or the one default when it gives none. */
  async models(account: string) {
    const r = route(account), p = await this.provider(account);
    if (!r || !p) return [];
    const list = await fetch(`${base(r).replace(/\/+$/, '')}/models`, { headers: { authorization: `Bearer ${p.apiKey}` }, signal: AbortSignal.timeout(8_000) }).then((x) => x.ok ? x.json() : null).catch(() => null) as { data?: { id?: string; name?: string }[] } | null;
    const ids = (list?.data ?? []).filter((m) => typeof m.id === 'string').map((m) => ({ id: m.id!, name: m.name ?? m.id! }));
    return (ids.some((m) => m.id === r.model) ? ids : [{ id: r.model, name: r.model }, ...ids]).map((m) => ({ ...m, ...(m.id === r.model ? { dflt: true } : {}) }));
  }
}
