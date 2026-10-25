// The person's AI accounts: the engine holds the credentials, the sign-in wizard and the
// cooldowns; this file says which accounts Crewhouse offers, keeps the person-facing sign-in view, and tracks the
// states the product words are built from (signed out, plan without helpers, resting until).
import { REST_MS, classify, offered, route } from '@byokit/accounts';
import { accountRef, refParts } from './runtime.ts';
import type { AgentRuntime, SignInStep } from './runtime.ts';

export type Provider = { key: string; name: string; billing: 'subscription' | 'api'; cli?: string };

/** The kit's extras: accounts the engine has no route for, or needing a tool on this computer (`cli`), on plans the person already pays for. */
const EXTRA: Record<string, Omit<Provider, 'billing'>> = {
  minimax: { key: 'minimax', name: 'MiniMax' },
  claude: { key: 'claude', name: 'Claude', cli: 'Claude Code, installed and signed in on this computer' },
};

/** The offered accounts, generated from the kit's own catalogue: names and billing come from there, so a new kit route
 *  lands with the bump (OpenCode Go arrives by route id, never a local row). One recommended, the rest a tap away. */
const GO = route('opencode:plan_key:opencode-go'), GO_KEY = GO.aliases?.[0] ?? 'opencode-go';
export const PROVIDERS: Record<string, Provider> = Object.fromEntries([
  ...offered(['chatgpt', 'grok', 'copilot', 'openrouter']).map(({ key, name, billing }) => [key, { key, name, billing }]),
  ...Object.entries(EXTRA).map(([key, v]) => [key, { ...v, billing: 'subscription' as const }]),
  ...(GO.billing === 'subscription' || GO.billing === 'api' ? [[GO_KEY, { key: GO_KEY, name: GO.name, billing: GO.billing }]] : []),
]);

export function provider(key: string) {
  const p = PROVIDERS[refParts(key)[0]];
  if (!p) throw Object.assign(new Error('no such AI account'), { status: 404 });
  return p;
}

/** One account, in the app's words: its ref (what models.json and the screens key on), the provider it is an account of,
 *  its own name, plan and email, and the sign-in states the words come from. */
export type AccountView = { account: string; provider: string; name: string; label?: string; email?: string; plan?: string;
  signedIn: boolean; restingUntil: number; signIn: ReturnType<Accounts['view']>; notIncluded: boolean; signedOut: boolean };

/** A time in the person's own words: "9:08 pm". Never a raw stamp. */
export const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s([AP])M$/, (m) => m.toLowerCase());

type View = { state: 'waiting' | 'done' | 'failed'; via: 'browser' | 'code' | 'key'; url?: string; code?: string; error?: string; why?: string; cliLogin?: { signIn: boolean }; workspaces?: { id: string; name: string }[] };

/** The person-facing half of the engine's sign-in: who is signed in to what, and the one card that drives the
 *  engine's own wizard. The credentials themselves never pass through here. */
export class Accounts {
  /** Which accounts are ready. Undefined means ask the engine (its own sign-in state). */
  readonly ready = new Map<string, boolean>();
  /** The engine's answer, trusted for a minute (a no for ten seconds) so a run starts at once instead of probing every account the person has not signed in to; the kit checks again as it admits the run. */
  private fresh = new Map<string, { until: number; yes: boolean }>();
  /** States the product words come from: a sign-in that stopped working, a plan without helpers, a cooldown. */
  readonly expired = new Set<string>();
  /** Latched because the engine itself said no twice (so its later yes clears it), and runs that said out while it said yes. */
  private byEngine = new Set<string>(); private doubts = new Map<string, number>();
  recheckMs = 11_000;
  readonly excluded = new Set<string>();
  readonly rests = new Map<string, number>();
  private views = new Map<string, View>();
  private running = new Map<string, { handle: { paste(text: string): void; pick?(id: string): Promise<unknown> | void }; cancel(): Promise<unknown> | void; finished: Promise<void> }>();
  /** Set by Crew: the person signed in, so waiting work starts now. */
  onSignedIn?: () => void;

  private runtime: AgentRuntime;
  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
    // The methods are handed around (server handlers, tests that stand in for signedIn): they must survive losing `this`.
    for (const k of Object.getOwnPropertyNames(Accounts.prototype)) if (k !== 'constructor') (this as any)[k] = (this as any)[k].bind(this);
  }

  async signedIn(account: string) {
    const out = this.expired.has(account);
    if (this.excluded.has(account) || (out && !this.byEngine.has(account))) return false;
    const r = out ? undefined : this.ready.get(account);
    if (r !== undefined) return r;
    const hit = this.fresh.get(account); if (hit && hit.until > Date.now()) return hit.yes;
    const yes = await this.runtime.signedIn(account).catch(() => undefined); // a failed probe says nothing and is asked again
    if (yes !== undefined) this.fresh.set(account, { until: Date.now() + (yes ? 60_000 : 10_000), yes });
    if (out && yes) { this.expired.delete(account); this.byEngine.delete(account); } // the engine's own check changed its mind: the no was a flake
    return !!yes;
  }
  /** A run says the sign-in is gone. The engine's CLI check behind it has a 3 s limit and reads a slow answer as a no, so one no
   *  proves nothing: ask again past the engine's 10 s answer window. A failed probe is unknown, never a sign-out; two nos latch (and a
   *  later yes clears them). A turn the API refused (`admission` false) is believed at once; the kit's own "not signed in" before any turn
   *  is believed against a yes only the second time. True: it latched. */
  async lost(account: string, admission: boolean) {
    for (let i = 0; i < 2; i++) {
      if (i) await new Promise((r) => setTimeout(r, this.recheckMs));
      const yes = await this.runtime.signedIn(account).catch(() => undefined);
      if (yes === undefined) return false;
      if (yes) { if (!admission) break; const n = (this.doubts.get(account) ?? 0) + 1; this.doubts.set(account, n); if (n < 2) return false; break; }
      if (i) this.byEngine.add(account);
    }
    this.doubts.delete(account); this.fresh.delete(account); this.expired.add(account); return true;
  }
  restingUntil(account: string) { return this.rests.get(account) ?? 0; }
  /** An account the person doesn't have: never signed in, or a sign-in that stopped working. */
  unready(account: string) { return this.expired.has(account) || this.ready.get(account) === false; }
  /** The account hit trouble: rest it, flag it signed out, or mark the plan. Null: not about the account. */
  failed(account: string, error: string) {
    const f = classify(error);
    if (!f) return null;
    if (f.kind === 'not_included') this.excluded.add(account);
    else if (f.kind === 'signed_out') this.expired.add(account);
    else if (f.kind !== 'network') this.rests.set(account, f.until || Date.now() + REST_MS[f.kind]);
    return f;
  }
  rest(account: string, until: number) { this.rests.set(account, until); }
  notIncluded(account: string, on?: boolean) { if (on !== undefined) on ? this.excluded.add(account) : this.excluded.delete(account); return this.excluded.has(account); }

  /** Start the engine's sign-in; the wizard's steps become the card's words (`via: 'key'` waits for a pasted plan key instead). */
  async login(account: string, via: 'browser' | 'code' | 'key' = 'browser', fresh = false) {
    provider(account);
    if (this.running.has(account)) return this.view(account);
    const view: View = { state: 'waiting', via };
    this.views.set(account, view);
    let over: () => void = () => {};
    const finished = new Promise<void>((yes) => { over = yes; }), done = (ok: boolean) => {
      if (view.state !== 'waiting') return;
      view.state = ok ? 'done' : 'failed';
      delete view.workspaces;
      if (ok) { this.ready.set(account, true); this.expired.delete(account); this.excluded.delete(account); this.rests.delete(account); this.onSignedIn?.(); }
      this.running.delete(account);
      over();
    }, handle = this.runtime.signIn(account, via, (step: SignInStep) => {
      if (step.url) view.url = step.url;
      if (step.code) view.code = step.code;
      if (step.error) { view.error = step.error; delete view.workspaces; if (step.cliLogin) view.cliLogin = step.cliLogin; }
      if (step.workspaces) { view.workspaces = step.workspaces; delete view.error; }
      if (step.notIncluded) { this.excluded.add(account); done(false); } else if (step.done) done(true);
      else if (step.error && step.waiting === false) done(false);
    });
    this.running.set(account, { handle, cancel: () => { handle.cancel(); done(false); this.views.delete(account); return handle.done; }, finished });
    return this.view(account);
  }
  async paste(account: string, text: string) { await this.running.get(account)?.handle.paste(text); }
  async workspace(account: string, id: string) {
    const view = this.views.get(account);
    try { await this.running.get(account)?.handle.pick?.(id); } catch (e: any) { if (view) view.error = e.message; }
  }
  cancel(account: string) { return this.running.get(account)?.cancel(); }
  async logout(account: string) {
    this.views.delete(account);
    await this.runtime.signOut(account).catch(() => {});
    this.ready.delete(account); this.fresh.delete(account); this.expired.add(account);
  }
  /** The sign-in is over (either way): the card's last word is in. */
  async finished(account: string) { await this.running.get(account)?.finished.catch(() => {}); }
  view(account: string): View | null { const error = this.runtime.signInRecovery?.(); return error ? { state: 'failed', via: 'browser', error, why: 'locked' } : this.views.get(account) ?? null; }
  /** Settings › AI accounts: every account the person has, two of one provider included, each on its own line; a provider
   *  with no account yet is listed once, so there is always a way to sign in to it. */
  async list(): Promise<AccountView[]> {
    const rows = await this.runtime.accounts().catch(() => []), have = new Set(rows.map((r) => r.provider));
    const view = async (provider: string, label?: string, row?: { email?: string; plan?: string }) => {
      const account = accountRef(provider, label);
      return { account, provider, name: PROVIDERS[provider]?.name ?? provider, ...(label ? { label } : {}), ...(row?.email ? { email: row.email } : {}), ...(row?.plan ? { plan: row.plan } : {}),
        signedIn: await this.signedIn(account), restingUntil: this.restingUntil(account), signIn: this.view(account),
        notIncluded: this.notIncluded(account), signedOut: this.expired.has(account) };
    };
    const order = Object.keys(PROVIDERS), all = [...await Promise.all(rows.map((r) => view(r.provider, r.label, r))),
      ...await Promise.all(order.filter((k) => !have.has(k)).map((k) => view(k)))];
    return all.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider) || a.account.localeCompare(b.account)); // a provider's accounts stay together, in the catalogue's order
  }
  stop() { for (const [, handle] of this.running) handle.cancel(); this.running.clear(); }
}
