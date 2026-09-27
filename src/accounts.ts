// Per-person AI accounts: each member signs in to their own, from inside the app, and nothing ever falls back to
// another member's account (vendor terms). The engine (OpenClaw) holds the credentials, the sign-in wizard and the
// cooldowns; this file says which accounts Crewhouse offers, keeps the person-facing sign-in view, and tracks the
// states the product words are built from (signed out, plan without helpers, resting until).
import { REST_MS, classifyText } from './failures.ts';
import type { AgentRuntime, Member, SignInStep } from './runtime.ts';

export const OWNER = 1;

/** The offered accounts. ChatGPT is the one front door the app shows; the rest are quiet "more options" paths. */
export const PROVIDERS: Record<string, { key: string; name: string }> = {
  chatgpt: { key: 'chatgpt', name: 'ChatGPT' },
  grok: { key: 'grok', name: 'Grok' },
  copilot: { key: 'copilot', name: 'GitHub Copilot' },
  openrouter: { key: 'openrouter', name: 'OpenRouter' },
};

export function provider(key: string) {
  const p = PROVIDERS[key];
  if (!p) throw Object.assign(new Error('no such AI account'), { status: 404 });
  return p;
}

/** A time in the person's own words: "9:08 pm". Never a raw stamp. */
export const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s([AP])M$/, (m) => m.toLowerCase());

export const signInError = (name: string) => `${name} didn't finish the sign-in. Tap Sign in with ${name} to try again.`;

type View = { state: 'waiting' | 'done' | 'failed'; via: 'browser' | 'code'; url?: string; code?: string; error?: string; why?: string };

/** The person-facing half of the engine's sign-in: who is signed in to what, and the one card that drives the
 *  engine's own wizard. The credentials themselves never pass through here. */
export class Accounts {
  /** Which member has which account ready. Undefined means ask the engine (its own sign-in state). */
  readonly ready = new Map<string, boolean>();
  /** States the product words come from: a sign-in that stopped working, a plan without helpers, a cooldown. */
  readonly expired = new Set<string>();
  readonly excluded = new Set<string>();
  private rests = new Map<string, number>();
  private views = new Map<string, View>();
  private running = new Map<string, { paste(text: string): void; cancel(): void; finished: Promise<void> }>();
  /** Set by Crew: a member signed in, so what was waiting for them starts now. */
  onSignedIn?: (member: Member) => void;

  private runtime: AgentRuntime;
  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
    // The methods are handed around (server handlers, tests that stand in for signedIn): they must survive losing `this`.
    for (const k of Object.getOwnPropertyNames(Accounts.prototype)) if (k !== 'constructor') (this as any)[k] = (this as any)[k].bind(this);
  }
  private key(member: Member, account: string) { return `${member}:${account}`; }

  async signedIn(member: Member, account: string) {
    const k = this.key(member, account);
    if (this.expired.has(k) || this.excluded.has(k)) return false;
    const r = this.ready.get(k);
    if (r !== undefined) return r;
    return this.runtime.signedIn(member, account).catch(() => false);
  }
  restingUntil(member: Member, account: string) { return this.rests.get(this.key(member, account)) ?? 0; }
  /** An account this member doesn't have: never signed in, or a sign-in that stopped working. */
  unready(member: Member, account: string) {
    const k = this.key(member, account);
    return this.expired.has(k) || this.ready.get(k) === false;
  }
  /** The account hit trouble: rest it, flag it signed out, or mark the plan. Null: not about the account. */
  failed(member: Member, account: string, error: string) {
    const k = this.key(member, account);
    const f = classifyText(error);
    if (!f) return null;
    if (f.kind === 'not_included') this.excluded.add(k);
    else if (f.kind === 'signed_out') this.expired.add(k);
    else if (f.kind !== 'network') this.rests.set(k, f.until || Date.now() + REST_MS[f.kind]);
    return f;
  }
  rest(member: Member, account: string, until: number) { this.rests.set(this.key(member, account), until); }
  cleared(member: Member, account: string) { this.rests.delete(this.key(member, account)); this.expired.delete(this.key(member, account)); }
  notIncluded(member: Member, account: string, on?: boolean) {
    const k = this.key(member, account);
    if (on !== undefined) on ? this.excluded.add(k) : this.excluded.delete(k);
    return this.excluded.has(k);
  }

  /** Start the engine's sign-in for this member's account; the wizard's steps become the card's words. */
  async login(member: Member, account: string, via: 'browser' | 'code' = 'browser', fresh = false) {
    if (!PROVIDERS[account]) throw Object.assign(new Error('no such AI account'), { status: 404 });
    const k = this.key(member, account);
    if (this.running.has(k)) return this.view(member, account);
    const view: View = { state: 'waiting', via };
    this.views.set(k, view);
    let over: () => void = () => {};
    const finished = new Promise<void>((yes) => { over = yes; });
    const done = (ok: boolean) => {
      if (view.state !== 'waiting') return;
      view.state = ok ? 'done' : 'failed';
      if (ok) { this.ready.set(k, true); this.expired.delete(k); this.excluded.delete(k); this.rests.delete(k); this.onSignedIn?.(member); }
      over();
    };
    const handle = this.runtime.signIn(member, account, via, (step: SignInStep) => {
      if (step.url) view.url = step.url;
      if (step.code) view.code = step.code;
      if (step.error) view.error = step.error;
      if (step.done) done(true);
      else if (step.error && step.waiting === false) done(false);
    });
    this.running.set(k, {
      paste: (t) => handle.paste(t),
      cancel: () => { handle.cancel(); done(false); this.views.delete(k); this.running.delete(k); },
      finished,
    });
    return this.view(member, account);
  }
  paste(member: Member, account: string, text: string) { this.running.get(this.key(member, account))?.paste(text); }
  cancel(member: Member, account: string) { this.running.get(this.key(member, account))?.cancel(); }
  async logout(member: Member, account: string) {
    const k = this.key(member, account);
    this.views.delete(k);
    await this.runtime.signOut(member, account).catch(() => {});
    this.ready.delete(k);
    this.expired.add(k);
  }
  /** The sign-in is over (either way): the card's last word is in. */
  async finished(member: Member, account: string) { await this.running.get(this.key(member, account))?.finished.catch(() => {}); }
  view(member: Member, account: string) { return this.views.get(this.key(member, account)) ?? null; }
  stop() { for (const [, handle] of this.running) handle.cancel(); this.running.clear(); }
}
