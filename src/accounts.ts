// Per-person AI accounts (plan 3, 4.3): sharing one person's ChatGPT or Grok breaks the vendors' terms, so each member
// signs in to their own, from inside the app, into their own credential file under Crewhouse's folders.
// The engine's own sign-in flows do the work; crewd only shows the link to open or the code to type.
import './isolate.ts';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { AuthPrompt } from '@earendil-works/pi-ai';
import type { Config } from './config.ts';

export const OWNER = 1;

/** The AI accounts a person can bring, by the name they know. `pi` is the engine's provider; `model` its default there.
 *  ChatGPT is the one front door the app shows; the rest are kept as quiet "more options" paths the app doesn't offer yet. */
export const PROVIDERS: Record<string, { pi: string; name: string; model: string }> = {
  chatgpt: { pi: 'openai-codex', name: 'ChatGPT', model: 'gpt-5.5' },
  grok: { pi: 'xai', name: 'Grok', model: 'grok-4.7' },
  copilot: { pi: 'github-copilot', name: 'GitHub Copilot', model: 'gpt-5.4' },
  openrouter: { pi: 'openrouter', name: 'OpenRouter', model: 'moonshotai/kimi-k2.6' },
};
// No Claude: Anthropic allows its subscriptions only in its own apps, so the engine's Anthropic sign-in is never offered.
// No Meta: Muse is a direct competitor, and the owner chose not to build on it.

export function provider(key: string) {
  const p = PROVIDERS[key];
  if (!p) throw Object.assign(new Error('no such AI account'), { status: 404 });
  return p;
}

/** What the person sees while signing in: ChatGPT's own page to open (the redirect), or a code to type there (the fallback),
 *  never the engine's own prompts. `why` names a failure the app words itself: declined on the page, or the port taken. */
export type SignIn = { state: 'waiting' | 'done' | 'failed'; via?: 'browser' | 'code'; url?: string; code?: string; expiresAt?: number; error?: string; why?: 'declined' | 'busy' };
type Flow = SignIn & { abort: AbortController; paste?: (text: string) => void; refuse?: (e: Error) => void; timedOut?: boolean; toCode?: boolean;
  oauthState?: string; done?: Promise<void>; shown?: () => void };

const LOGIN_MS = Number(process.env.CREWHOUSE_SIGNIN_MS || 15 * 60_000); // longer than any provider's code lives
/** No redirect by then: the page is probably stuck (or on a phone), so the code takes over by itself. */
const REDIRECT_MS = Number(process.env.CREWHOUSE_REDIRECT_MS || 3 * 60_000);
/** ChatGPT sends the browser back here, on this computer, and nowhere else: it is fixed for the client the engine signs in as. */
export const CALLBACK_PORT = Number(process.env.CREWHOUSE_CALLBACK_PORT || 1455);

/** A failed sign-in in one plain sentence with one next step. */
export function signInError(name: string, error: string) {
  if (/token exchange failed|missing fields|accountId/i.test(error)) return `${name} didn't finish the sign-in. Tap Sign in with ${name} to try again.`;
  if (/expired|expire/i.test(error)) return `The code expired before it was used. Tap Sign in with ${name} for a new one.`;
  if (/denied|declined|access_denied|rejected|cancel/i.test(error)) return `The sign-in was declined on the ${name} page. Tap Sign in with ${name} to try again.`;
  if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN|timed? ?out|socket/i.test(error)) return `Couldn't reach ${name}. Check the internet connection, then tap Sign in again.`;
  if (/device code.*(disabled|not enabled)|enable device/i.test(error)) return `${name} needs device sign-in turned on first: in ${name}, Settings, Security, turn on device code sign-in, then try again.`;
  return `${name} didn't finish the sign-in. Tap Sign in with ${name} to try again.`;
}

/** Crewhouse's own page for the browser tab ChatGPT sends back: it says how it really went, never "success" before it is. */
export const callbackPage = (words: string, close = false) => '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  `<title>Crewhouse</title><body style="font:18px system-ui;margin:3em auto;max-width:26em;padding:0 1em;text-align:center;color:#2e2a40">${words.replace(/[<&]/g, '')}` +
  (close ? '<script>setTimeout(() => window.close(), 1500)</script>' : '') + '</body>';

/** The ChatGPT plan behind a sign-in, from its own token: a work plan (Business, Enterprise, Edu) follows the employer's rules. */
export function planOf(access: string): { plan: string; email: string; work: boolean } {
  let claims: any = {};
  try { claims = JSON.parse(Buffer.from(access.split('.')[1] ?? '', 'base64url').toString()); } catch {}
  const plan = String(claims['https://api.openai.com/auth']?.chatgpt_plan_type ?? '').toLowerCase();
  return { plan, email: String(claims['https://api.openai.com/profile']?.email ?? claims.email ?? ''), work: /^(team|business|enterprise|edu|education|k12)/.test(plan) };
}

export class Accounts {
  private cfg: Config;
  private runtimes = new Map<number, Promise<ModelRuntime>>();
  private flows = new Map<string, Flow>();
  private ready = new Map<string, boolean>();
  onChange?: (member: number, key: string) => void;
  /** A sign-in just finished and works. */
  onSignedIn?: (member: number, key: string) => void;
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

  /** Which ChatGPT the member signed in with, from the sign-in itself: its plan, email, and whether it is a work account. */
  chatgptPlan(member: number) {
    try { return planOf(JSON.parse(readFileSync(this.authPath(member), 'utf8'))[PROVIDERS.chatgpt.pi]?.access ?? ''); } catch { return null; }
  }

  /** Signed in, but the plan has no helpers in it (ChatGPT's own "usage not included"): unusable until the person says
   *  they changed it, or signs in again. ponytail: in memory, so a restart simply tries once more. */
  private without = new Set<string>();
  notIncluded(member: number, key: string, on?: boolean) {
    const id = `${member}:${key}`;
    if (on !== undefined) { if (on) this.without.add(id); else this.without.delete(id); this.onChange?.(member, key); }
    return this.without.has(id);
  }

  /** Known to be signed out (an unchecked account counts as usable, so a first run still tries). */
  unready(member: number, key: string) { return this.ready.get(`${member}:${key}`) === false || this.without.has(`${member}:${key}`); }

  /** The account turned the bot away (its sign-in expired): signed out until the person signs in again. */
  forget(member: number, key: string) { this.ready.set(`${member}:${key}`, false); this.onChange?.(member, key); }

  /** Start "Sign in with …". ChatGPT: its own page, which sends the browser straight back here (three taps, no code).
   *  The code is the fallback: asked for (`via: 'code'`, "Having trouble?"), or by itself when no redirect has come back
   *  after a few minutes. A flow that stalls times out; nothing is kept unless the engine then sees a working sign-in.
   *  Every failure ends in one plain sentence. Returns as soon as there is a page to open or a code to show (or it is over). */
  async login(member: number, key: string, body: { via?: 'code' | 'browser'; fresh?: boolean } = {}): Promise<SignIn | null> {
    provider(key);
    const id = `${member}:${key}`;
    const now = this.flows.get(id);
    if (now?.state === 'waiting' && body.via === 'code' && now.via === 'browser') {
      // "Having trouble?": the same sign-in carries on with a code instead.
      const visible = new Promise<void>((r) => (now.shown = r));
      this.toCode(now);
      await Promise.race([visible, now.done]);
    } else if (now?.state !== 'waiting') {
      const flow: Flow = { state: 'waiting', abort: new AbortController() };
      this.flows.set(id, flow);
      const visible = new Promise<void>((r) => (flow.shown = r));
      flow.done = this.signIn(member, key, body, flow);
      await Promise.race([visible, flow.done]);
    }
    return this.view(member, key);
  }

  /** The whole sign-in, for when the caller wants to wait for its end (tests do). */
  finished(member: number, key: string) { return this.flows.get(`${member}:${key}`)?.done ?? Promise.resolve(); }

  private toCode(flow: Flow) {
    if (flow.state !== 'waiting' || flow.via !== 'browser' || flow.toCode) return;
    flow.toCode = true;
    flow.refuse?.(new Error('switching to a code'));
  }

  private async signIn(member: number, key: string, body: { via?: 'code' | 'browser'; fresh?: boolean }, flow: Flow) {
    const p = provider(key);
    const id = `${member}:${key}`;
    const rt = await this.runtime(member);
    let codeOffered = false;
    const attempt = (via?: 'code' | 'browser') => rt.login(p.pi, 'oauth', {
      signal: flow.abort.signal,
      prompt: (q: AuthPrompt): Promise<string> => {
        if (q.type === 'select') {
          const device = q.options.find((o) => /device/i.test(o.id));
          codeOffered = !!device;
          return Promise.resolve((via === 'code' && device ? device : q.options.find((o) => o !== device) ?? q.options[0]).id);
        }
        if (q.type === 'text') return Promise.resolve(''); // GitHub Enterprise domain: never, for a household
        // "Paste the redirect address": Crewhouse's own listener hands the engine the address ChatGPT sent the browser to.
        return new Promise((resolve, reject) => {
          Object.assign(flow, { paste: resolve, refuse: reject });
          q.signal?.addEventListener('abort', () => reject(new Error('answered elsewhere')));
        });
      },
      notify: (e) => {
        if (e.type === 'auth_url') {
          const url = new URL(e.url);
          if (body.fresh) url.searchParams.set('prompt', 'login'); // "Use my personal account": ask which account, again
          Object.assign(flow, { via: 'browser', url: url.toString(), code: undefined, oauthState: url.searchParams.get('state') ?? undefined });
        }
        if (e.type === 'device_code') Object.assign(flow, { via: 'code', code: e.userCode, url: e.verificationUri, expiresAt: e.expiresInSeconds ? Date.now() + e.expiresInSeconds * 1000 : undefined });
        if (flow.url) flow.shown?.();
        this.onChange?.(member, key);
      },
    });
    const timer = setTimeout(() => { flow.timedOut = true; flow.abort.abort(); }, LOGIN_MS);
    const stuck = setTimeout(() => this.toCode(flow), REDIRECT_MS);
    // ChatGPT's page comes back to this computer's port 1455. Crewhouse listens there itself (the engine then finds it
    // taken and waits for the address to be handed over), so the tab shows Crewhouse's words, and only once they are true.
    const catcher = p.pi === 'openai-codex' && body.via !== 'code' ? await this.catchRedirect(flow, p.name).catch(() => null) : undefined;
    try {
      if (catcher === null) throw Object.assign(new Error('port busy'), { why: 'busy' as const });
      try { await attempt(body.via ?? (catcher ? 'browser' : undefined)); } catch (e) {
        // The code instead: asked for, or the page never came back. Also when a browser sign-in could not return here at all.
        if (!flow.toCode && (catcher || body.via === 'code' || !codeOffered || flow.abort.signal.aborted)) throw e;
        Object.assign(flow, { url: undefined, code: undefined, via: 'code' });
        catcher?.close();
        catcher?.closeIdleConnections();
        await attempt('code');
      }
      // Never half signed in: only a sign-in the engine can use counts.
      if (!(await rt.checkAuth(p.pi).catch(() => undefined))) { await rt.logout(p.pi).catch(() => {}); throw new Error('no usable credential'); }
      flow.state = 'done';
      this.ready.set(id, true);
      this.without.delete(id);
      this.onSignedIn?.(member, key);
    } catch (e: any) {
      if (flow.state !== 'waiting') return; // cancelled: already settled
      console.error(`sign-in ${key} for member ${member}:`, e?.message ?? e);
      const msg = String(e?.message ?? e);
      const why = e?.why ?? (/access_denied|denied|cancel/i.test(msg) && flow.via === 'browser' ? 'declined' : undefined);
      Object.assign(flow, { state: 'failed', url: undefined, code: undefined, expiresAt: undefined, why, error: why === 'busy'
        ? `Something else on this computer is signing in to ${p.name}. Try again in a minute.`
        : flow.timedOut ? `The sign-in took too long. Tap Sign in with ${p.name} to start again.` : signInError(p.name, msg) });
    } finally {
      clearTimeout(timer);
      clearTimeout(stuck);
      catcher?.close();
      catcher?.closeIdleConnections();
      this.onChange?.(member, key);
    }
  }

  /** Listen where ChatGPT sends the browser back; rejects if something else on this computer is already listening there. */
  private catchRedirect(flow: Flow, name: string) {
    const server = createServer(async (req, res) => {
      const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
      // No keep-alive: a browser must never land on a listener from an earlier try.
      const page = (status: number, words: string, close = false) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close' }); res.end(callbackPage(words, close)); };
      if (!flow.oauthState || q.get('state') !== flow.oauthState || flow.state !== 'waiting') return page(400, `This sign-in page is out of date. Go back to Crewhouse and tap Sign in with ${name} again.`);
      if (q.get('error')) flow.refuse?.(new Error(q.get('error')!));
      else flow.paste?.(`http://localhost:${CALLBACK_PORT}${req.url}`);
      // The tab waits for the real outcome (a few seconds at most), so it never says "signed in" before it is.
      await Promise.race([flow.done, new Promise((r) => setTimeout(r, 30_000).unref())]);
      const end = flow.state as SignIn['state'];
      if (end === 'done') return page(200, "You're signed in. You can go back to Crewhouse now.", true);
      if (flow.why === 'declined') return page(200, 'No problem. Nothing was changed. You can go back to Crewhouse.', true);
      page(200, end === 'failed' ? `${flow.error} Go back to Crewhouse.` : 'Nearly there. Go back to Crewhouse to finish.');
    });
    return new Promise<Server>((resolve, reject) => { server.once('error', reject).listen(CALLBACK_PORT, '127.0.0.1', () => resolve(server)); });
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
    if (f?.state === 'waiting') { f.state = 'failed'; f.abort.abort(); f.refuse?.(new Error('cancelled')); }
    this.flows.delete(`${member}:${key}`);
    this.onChange?.(member, key);
  }

  /** Refresh every signed-in account now and then (crewd's clock calls this), so a sign-in never lapses while nobody is
   *  looking. One that can't be refreshed is signed out, and `onExpired` says so once, in plain words. */
  onExpired?: (member: number, key: string) => void;
  async keepFresh(members: number[]) {
    for (const m of members) for (const [key, p] of Object.entries(PROVIDERS)) {
      if (this.ready.get(`${m}:${key}`) !== true) continue;
      const rt = await this.runtime(m);
      // A network hiccup is not a lapsed sign-in: only the account refusing the refresh signs it out.
      const ok = await rt.getAuth(p.pi, { minOAuthValidityMs: 60 * 60_000 }).then(Boolean, (e) => /fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN|timed? ?out/i.test(String(e?.message)));
      if (!ok) { this.forget(m, key); this.onExpired?.(m, key); }
    }
  }

  /** After the account turned a bot away: true if its sign-in still refreshes; if not, it is signed out for good. */
  async recheck(member: number, key: string) {
    const rt = await this.runtime(member);
    const ok = await rt.getAuth(provider(key).pi, { minOAuthValidityMs: 365 * 86_400_000 }).then(Boolean, (e) => /fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN|timed? ?out/i.test(String(e?.message)));
    if (!ok) await this.logout(member, key).catch(() => this.forget(member, key));
    return ok;
  }

  async logout(member: number, key: string) {
    await (await this.runtime(member)).logout(provider(key).pi);
    this.ready.set(`${member}:${key}`, false);
    this.onChange?.(member, key);
  }

  view(member: number, key: string): SignIn | null {
    const f = this.flows.get(`${member}:${key}`);
    return f ? { state: f.state, via: f.via, url: f.url, code: f.code, expiresAt: f.state === 'waiting' ? f.expiresAt : undefined, error: f.error, why: f.why } : null;
  }

  stop() { for (const f of this.flows.values()) f.abort.abort(); }
}
