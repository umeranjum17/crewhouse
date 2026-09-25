// Per-person AI accounts (plan 3, 4.3): sharing one person's ChatGPT or Grok breaks the vendors' terms, so each member
// signs in to their own, from inside the app, into their own credential file under Crewhouse's folders.
// The engine's own sign-in flows do the work; crewd only shows the link to open or the code to type.
import './isolate.ts';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { AuthPrompt } from '@earendil-works/pi-ai';
import type { Config } from './config.ts';

export const OWNER = 1;

/** The AI accounts a person can bring, by the name they know. `pi` is the engine's provider; `model` its default there. */
export const PROVIDERS: Record<string, { pi: string; name: string; model: string; key?: true }> = {
  chatgpt: { pi: 'openai-codex', name: 'ChatGPT', model: 'gpt-5.5' },
  grok: { pi: 'xai', name: 'Grok', model: 'grok-4.7' },
  muse: { pi: 'meta', name: 'Meta Muse', model: 'muse-spark-1.3' },
  copilot: { pi: 'github-copilot', name: 'GitHub Copilot', model: 'gpt-5.4' },
  kimi: { pi: 'kimi-coding', name: 'Kimi', model: 'kimi-for-coding' },
  openrouter: { pi: 'openrouter', name: 'OpenRouter', model: 'moonshotai/kimi-k2.6' },
  gemini: { pi: 'google', name: 'Gemini', model: 'gemini-3.1-pro-preview', key: true },
};
// No Claude: Anthropic allows its subscriptions only in its own apps, so the engine's Anthropic sign-in is never offered.

export function provider(key: string) {
  const p = PROVIDERS[key];
  if (!p) throw Object.assign(new Error('no such AI account'), { status: 404 });
  return p;
}

/** What the person sees while signing in: a link to open or a code to type, never the engine's own prompts. */
export type SignIn = { state: 'waiting' | 'done' | 'failed'; url?: string; code?: string; error?: string };
type Flow = SignIn & { abort: AbortController; paste?: (text: string) => void; timedOut?: boolean; done?: Promise<void> };

const LOGIN_MS = Number(process.env.CREWHOUSE_SIGNIN_MS || 15 * 60_000); // longer than any provider's code lives

/** A failed sign-in in one plain sentence with one next step. */
export function signInError(name: string, error: string, key = false) {
  if (key && /invalid|unauthori[sz]ed|\b40[13]\b/i.test(error)) return `${name} didn't accept that key. Copy it again and paste it here.`;
  if (/expired|expire/i.test(error)) return `The code expired before it was used. Tap Sign in with ${name} for a new one.`;
  if (/denied|declined|access_denied|rejected/i.test(error)) return `The sign-in was declined on the ${name} page. Tap Sign in with ${name} to try again.`;
  if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN|timed? ?out|socket/i.test(error)) return `Couldn't reach ${name}. Check the internet connection, then tap Sign in again.`;
  if (/device code.*(disabled|not enabled)|enable device/i.test(error)) return `${name} needs device sign-in turned on first: in ${name}, Settings, Security, turn on device code sign-in, then try again.`;
  return `${name} didn't finish the sign-in. Tap Sign in with ${name} to try again.`;
}

export class Accounts {
  private cfg: Config;
  private runtimes = new Map<number, Promise<ModelRuntime>>();
  private flows = new Map<string, Flow>();
  private ready = new Map<string, boolean>();
  onChange?: (member: number, key: string) => void;
  /** Set by the stub engine: its scripted model stands in for every provider. */
  prepare?: (runtime: ModelRuntime) => void;

  constructor(cfg: Config) { this.cfg = cfg; }

  /** A member's own credential file. The owner has one too: nothing falls back to another sign-in on this computer. */
  authPath(member: number) { return join(this.cfg.stateDir, 'people', String(member), 'engine', 'auth.json'); }

  /** One engine runtime per member, holding only their own sign-ins. */
  runtime(member: number) {
    let r = this.runtimes.get(member);
    if (!r) {
      mkdirSync(join(this.cfg.stateDir, 'people', String(member), 'engine'), { recursive: true, mode: 0o700 });
      r = ModelRuntime.create({ authPath: this.authPath(member), modelsPath: null, refreshOnCreate: false }).then((rt) => { this.prepare?.(rt); return rt; });
      this.runtimes.set(member, r);
    }
    return r;
  }

  /** Signed in, from the engine's own side-effect-free check. */
  async signedIn(member: number, key: string) {
    const ok = !!(await (await this.runtime(member)).checkAuth(provider(key).pi).catch(() => undefined));
    this.ready.set(`${member}:${key}`, ok);
    return ok;
  }

  /** Known to be signed out (an unchecked account counts as usable, so a first run still tries). */
  unready(member: number, key: string) { return this.ready.get(`${member}:${key}`) === false; }

  /** The account turned the bot away (its sign-in expired): signed out until the person signs in again. */
  forget(member: number, key: string) { this.ready.set(`${member}:${key}`, false); this.onChange?.(member, key); }

  /** Start "Sign in with …". `via: 'code'` picks the device-code flow where there is a choice (a phone can't take a redirect).
   *  One button, first time: a browser sign-in that can't come back falls back to a code by itself; a flow that stalls
   *  times out; nothing is kept unless the engine then sees a working sign-in. Every failure ends in one plain sentence.
   *  Returns as soon as there is a link to open or a code to show (or it is over); the sign-in carries on by itself. */
  async login(member: number, key: string, body: { via?: 'code' | 'browser'; key?: string } = {}): Promise<SignIn | null> {
    const p = provider(key);
    const id = `${member}:${key}`;
    if (this.flows.get(id)?.state !== 'waiting') {
      if (p.key && !body.key?.trim()) throw Object.assign(new Error(`Paste your ${p.name} key first.`), { status: 400 });
      const flow: Flow = { state: 'waiting', abort: new AbortController() };
      this.flows.set(id, flow);
      let shown!: () => void;
      const visible = new Promise<void>((r) => (shown = r));
      flow.done = this.signIn(member, key, body, flow, shown);
      await Promise.race([visible, flow.done]);
    }
    return this.view(member, key);
  }

  /** The whole sign-in, for when the caller wants to wait for its end (tests do). */
  finished(member: number, key: string) { return this.flows.get(`${member}:${key}`)?.done ?? Promise.resolve(); }

  private async signIn(member: number, key: string, body: { via?: 'code' | 'browser'; key?: string }, flow: Flow, shown: () => void) {
    const p = provider(key);
    const id = `${member}:${key}`;
    const rt = await this.runtime(member);
    let codeOffered = false;
    const attempt = (via?: 'code' | 'browser') => rt.login(p.pi, p.key ? 'api_key' : 'oauth', {
      signal: flow.abort.signal,
      prompt: (q: AuthPrompt): Promise<string> => {
        if (q.type === 'select') {
          const device = q.options.find((o) => /device/i.test(o.id));
          codeOffered = !!device;
          return Promise.resolve((via === 'code' && device ? device : q.options.find((o) => o !== device) ?? q.options[0]).id);
        }
        if (q.type === 'secret') return Promise.resolve(body.key!.trim());
        if (q.type === 'text') return Promise.resolve(''); // GitHub Enterprise domain: never, for a household
        // "Paste the redirect address": only if the person pastes one; otherwise the engine's own listener finishes it.
        return new Promise((resolve, reject) => {
          flow.paste = resolve;
          q.signal?.addEventListener('abort', () => reject(new Error('answered elsewhere')));
        });
      },
      notify: (e) => {
        if (e.type === 'auth_url') Object.assign(flow, { url: e.url, code: undefined });
        if (e.type === 'device_code') Object.assign(flow, { code: e.userCode, url: e.verificationUri });
        if (flow.url) shown();
        this.onChange?.(member, key);
      },
    });
    const timer = setTimeout(() => { flow.timedOut = true; flow.abort.abort(); }, LOGIN_MS);
    try {
      try { await attempt(body.via); } catch (e) {
        // The browser couldn't come back to this computer (its port was taken, or it was a phone): the code works anywhere.
        if (body.via === 'code' || !codeOffered || flow.abort.signal.aborted) throw e;
        Object.assign(flow, { url: undefined, code: undefined });
        await attempt('code');
      }
      // Never half signed in: only a sign-in the engine can use counts.
      if (!(await rt.checkAuth(p.pi).catch(() => undefined))) { await rt.logout(p.pi).catch(() => {}); throw new Error('no usable credential'); }
      flow.state = 'done';
      this.ready.set(id, true);
    } catch (e: any) {
      if (flow.state !== 'waiting') return; // cancelled: already settled
      console.error(`sign-in ${key} for member ${member}:`, e?.message ?? e);
      Object.assign(flow, { state: 'failed', url: undefined, code: undefined, error: flow.timedOut ? `The sign-in took too long. Tap Sign in with ${p.name} to start again.` : signInError(p.name, String(e?.message ?? e), !!p.key) });
    } finally {
      clearTimeout(timer);
      this.onChange?.(member, key);
    }
  }

  /** The redirect address (or a code) pasted back, for when the browser couldn't return to this computer by itself. */
  paste(member: number, key: string, text: string) {
    const f = this.flows.get(`${member}:${key}`);
    if (f?.state !== 'waiting' || !f.paste) throw Object.assign(new Error('no sign-in is waiting'), { status: 409 });
    f.paste(text.trim());
  }

  /** Stop a sign-in and forget it; nothing it started is kept. */
  cancel(member: number, key: string) {
    const f = this.flows.get(`${member}:${key}`);
    if (f?.state === 'waiting') { f.state = 'failed'; f.abort.abort(); }
    this.flows.delete(`${member}:${key}`);
    this.onChange?.(member, key);
  }

  /** Refresh every signed-in account now and then (crewd's clock calls this), so a sign-in never lapses while nobody is
   *  looking. One that can't be refreshed is signed out, and `onExpired` says so once, in plain words. */
  onExpired?: (member: number, key: string) => void;
  async keepFresh(members: number[]) {
    for (const m of members) for (const [key, p] of Object.entries(PROVIDERS)) {
      if (p.key || this.ready.get(`${m}:${key}`) !== true) continue;
      const rt = await this.runtime(m);
      // A network hiccup is not a lapsed sign-in: only the account refusing the refresh signs it out.
      const ok = await rt.getAuth(p.pi, { minOAuthValidityMs: 60 * 60_000 }).then(Boolean, (e) => /fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN|timed? ?out/i.test(String(e?.message)));
      if (!ok) { this.forget(m, key); this.onExpired?.(m, key); }
    }
  }

  async logout(member: number, key: string) {
    await (await this.runtime(member)).logout(provider(key).pi);
    this.ready.set(`${member}:${key}`, false);
    this.onChange?.(member, key);
  }

  view(member: number, key: string): SignIn | null {
    const f = this.flows.get(`${member}:${key}`);
    return f ? { state: f.state, url: f.url, code: f.code, error: f.error } : null;
  }

  stop() { for (const f of this.flows.values()) f.abort.abort(); }
}
