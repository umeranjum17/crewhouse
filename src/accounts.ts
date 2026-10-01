// The person's AI accounts: the engine holds the credentials, the sign-in wizard and the
// cooldowns; this file says which accounts Crewhouse offers, keeps the person-facing sign-in view, and tracks the
// states the product words are built from (signed out, plan without helpers, resting until).
import { REST_MS, classify, offered } from '@byokit/accounts';
import type { AgentRuntime, SignInStep } from './runtime.ts';

/** The offered accounts: every subscription route the pinned engine supports. ChatGPT is the one front door; the
 *  rest are quiet "more options" paths. `cli`: the sign-in needs a tool installed and logged in on this computer. */
export const PROVIDERS: Record<string, { key: string; name: string; cli?: string }> = {
  ...Object.fromEntries(offered(['chatgpt', 'grok', 'copilot', 'openrouter']).map(({ key, name }) => [key, { key, name }])),
  minimax: { key: 'minimax', name: 'MiniMax' },
  claude: { key: 'claude', name: 'Claude', cli: 'Claude Code, installed and signed in on this computer' },
};

export function provider(key: string) {
  const p = PROVIDERS[key];
  if (!p) throw Object.assign(new Error('no such AI account'), { status: 404 });
  return p;
}

/** A time in the person's own words: "9:08 pm". Never a raw stamp. */
export const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s([AP])M$/, (m) => m.toLowerCase());

type View = { state: 'waiting' | 'done' | 'failed'; via: 'browser' | 'code'; url?: string; code?: string; error?: string; why?: string };

/** The person-facing half of the engine's sign-in: who is signed in to what, and the one card that drives the
 *  engine's own wizard. The credentials themselves never pass through here. */
export class Accounts {
  /** Which accounts are ready. Undefined means ask the engine (its own sign-in state). */
  readonly ready = new Map<string, boolean>();
  /** States the product words come from: a sign-in that stopped working, a plan without helpers, a cooldown. */
  readonly expired = new Set<string>();
  readonly excluded = new Set<string>();
  private rests = new Map<string, number>();
  private views = new Map<string, View>();
  private running = new Map<string, { paste(text: string): void; cancel(): void; finished: Promise<void> }>();
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
    return this.runtime.signedIn(account).catch(() => false);
  }
  restingUntil(account: string) { return this.rests.get(account) ?? 0; }
  /** An account the person doesn't have: never signed in, or a sign-in that stopped working. */
  unready(account: string) {
    return this.expired.has(account) || this.ready.get(account) === false;
  }
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
  cleared(account: string) { this.rests.delete(account); this.expired.delete(account); }
  notIncluded(account: string, on?: boolean) {
    if (on !== undefined) on ? this.excluded.add(account) : this.excluded.delete(account);
    return this.excluded.has(account);
  }

  /** Start the engine's sign-in for the person's account; the wizard's steps become the card's words. */
  async login(account: string, via: 'browser' | 'code' = 'browser', fresh = false) {
    if (!PROVIDERS[account]) throw Object.assign(new Error('no such AI account'), { status: 404 });
    if (this.running.has(account)) return this.view(account);
    const view: View = { state: 'waiting', via };
    this.views.set(account, view);
    let over: () => void = () => {};
    const finished = new Promise<void>((yes) => { over = yes; });
    const done = (ok: boolean) => {
      if (view.state !== 'waiting') return;
      view.state = ok ? 'done' : 'failed';
      if (ok) { this.ready.set(account, true); this.expired.delete(account); this.excluded.delete(account); this.rests.delete(account); this.onSignedIn?.(); }
      this.running.delete(account);
      over();
    };
    const handle = this.runtime.signIn(account, via, (step: SignInStep) => {
      if (step.url) view.url = step.url;
      if (step.code) view.code = step.code;
      if (step.error) view.error = step.error;
      if (step.done) done(true);
      else if (step.error && step.waiting === false) done(false);
    });
    this.running.set(account, {
      paste: (t) => handle.paste(t),
      cancel: () => { handle.cancel(); done(false); this.views.delete(account); },
      finished,
    });
    return this.view(account);
  }
  paste(account: string, text: string) { this.running.get(account)?.paste(text); }

  cancel(account: string) { this.running.get(account)?.cancel(); }
  async logout(account: string) {
    this.views.delete(account);
    await this.runtime.signOut(account).catch(() => {});
    this.ready.delete(account);
    this.expired.add(account);
  }
  /** The sign-in is over (either way): the card's last word is in. */
  async finished(account: string) { await this.running.get(account)?.finished.catch(() => {}); }
  view(account: string): View | null { const error = this.runtime.signInRecovery?.(); return error ? { state: 'failed', via: 'browser', error, why: 'locked' } : this.views.get(account) ?? null; }
  stop() { for (const [, handle] of this.running) handle.cancel(); this.running.clear(); }
}
