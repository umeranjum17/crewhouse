// Per-person AI accounts: each member signs in to their own, from inside the app, and nothing ever falls back to
// another member's account (vendor terms). The engine (OpenClaw) holds the credentials, the sign-in wizard and the
// cooldowns; this file says which accounts Crewhouse offers, keeps the person-facing sign-in view, and tracks the
// states the product words are built from (signed out, plan without helpers, resting until).
import { REST_MS, classifyText } from './failures.ts';
import { createServer, type Server } from 'node:http';
import { CALLBACK_PORT } from './callback-port.ts';
import type { AgentRuntime, Member, SignInStep } from './runtime.ts';

export { CALLBACK_PORT } from './callback-port.ts';
export const OWNER = 1;

/** ChatGPT's redirect lands on the fixed port (src/callback-port.ts); crewd holds it during sign-in and pastes the
 *  address into the engine's wizard, so the tab shows Crewhouse's own page and the flow finishes even when the engine
 *  cannot bind the port first. Tests take a free port via CREWHOUSE_CALLBACK_PORT.

/** The offered accounts: every subscription route the pinned engine supports. ChatGPT is the one front door; the
 *  rest are quiet "more options" paths. `cli`: the sign-in needs a tool installed and logged in on this computer. */
export const PROVIDERS: Record<string, { key: string; name: string; cli?: string }> = {
  chatgpt: { key: 'chatgpt', name: 'ChatGPT' },
  grok: { key: 'grok', name: 'Grok' },
  copilot: { key: 'copilot', name: 'GitHub Copilot' },
  openrouter: { key: 'openrouter', name: 'OpenRouter' },
  minimax: { key: 'minimax', name: 'MiniMax' },
  claude: { key: 'claude', name: 'Claude', cli: 'the Claude CLI, installed and signed in on this computer' },
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
  /** The one 1455 listener while a browser sign-in is running. */
  private callback?: Server;
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
      this.running.delete(k);
      if (!this.running.size) this.closeCallback();
      over();
    };
    if (via === 'browser') this.holdCallbackPort(member, account);
    const handle = this.runtime.signIn(member, account, via, (step: SignInStep) => {
      if (step.url) view.url = step.url;
      if (step.code) view.code = step.code;
      if (step.error) view.error = step.error;
      if (step.done) done(true);
      else if (step.error && step.waiting === false) done(false);
      if ((step.done || (step.error && step.waiting === false)) && !this.running.size) this.closeCallback();
    });
    this.running.set(k, {
      paste: (t) => handle.paste(t),
      cancel: () => { handle.cancel(); done(false); this.views.delete(k); },
      finished,
    });
    return this.view(member, account);
  }
  paste(member: Member, account: string, text: string) { this.running.get(this.key(member, account))?.paste(text); }

  /** The sign-in browser comes back here: crewd's own page, in plain words, and the address is pasted into the
   *  engine's wizard. Kept until the sign-in ends; if something else already holds the port, the sign-in fails honestly. */
  private holdCallbackPort(member: Member, account: string) {
    if (this.callback) return;
    const k = this.key(member, account);
    const server = createServer((req, res) => {
      const host = req.headers.host ?? `localhost:${CALLBACK_PORT}`;
      const address = `http://${host}${req.url}`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Crewhouse</title>' +
        '<body style="font:18px system-ui;margin:3em auto;max-width:26em;padding:0 1em;text-align:center;color:#2e2a40">' +
        'Thanks. Finishing the sign-in — you can go back to Crewhouse now.</body>');
      this.paste(member, account, address);
    });
    server.on('error', () => {
      const view = this.views.get(k);
      if (view && view.state === 'waiting') { view.state = 'failed'; view.error = 'Something else on this computer is signing in to ChatGPT. Try again in a minute.'; }
      this.callback = undefined;
    });
    server.listen(CALLBACK_PORT, '127.0.0.1');
    this.callback = server;
  }
  private closeCallback() {
    this.callback?.close();
    this.callback = undefined;
  }
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
