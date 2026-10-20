// The person's AI accounts: the engine holds the credentials, the sign-in wizard and the
// cooldowns; this file says which accounts Crewhouse offers, keeps the person-facing sign-in view, and tracks the
// states the product words are built from (signed out, plan without helpers, resting until).
import { REST_MS, classify, offered, route } from '@byokit/accounts';
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
  const p = PROVIDERS[key];
  if (!p) throw Object.assign(new Error('no such AI account'), { status: 404 });
  return p;
}

/** A time in the person's own words: "9:08 pm". Never a raw stamp. */
export const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s([AP])M$/, (m) => m.toLowerCase());

type View = { state: 'waiting' | 'done' | 'failed'; via: 'browser' | 'code' | 'key'; url?: string; code?: string; error?: string; why?: string; cliLogin?: { signIn: boolean }; workspaces?: { id: string; name: string }[] };

/** The person-facing half of the engine's sign-in: who is signed in to what, and the one card that drives the
 *  engine's own wizard. The credentials themselves never pass through here. */
export class Accounts {
  /** Which accounts are ready. Undefined means ask the engine (its own sign-in state). */
  readonly ready = new Map<string, boolean>();
  /** An engine yes, trusted for a minute so a run starts at once; the kit checks again as it admits the run. */
  private fresh = new Map<string, number>();
  /** States the product words come from: a sign-in that stopped working, a plan without helpers, a cooldown. */
  readonly expired = new Set<string>();
  readonly excluded = new Set<string>();
  private rests = new Map<string, number>();
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
    if (this.expired.has(account) || this.excluded.has(account)) return false;
    const r = this.ready.get(account);
    if (r !== undefined) return r;
    if ((this.fresh.get(account) ?? 0) > Date.now()) return true;
    const yes = await this.runtime.signedIn(account).catch(() => false);
    if (yes) this.fresh.set(account, Date.now() + 60_000);
    return yes;
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
    if (!PROVIDERS[account]) throw Object.assign(new Error('no such AI account'), { status: 404 });
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
  stop() { for (const [, handle] of this.running) handle.cancel(); this.running.clear(); }
}
