// Per-person AI accounts (plan 3, 4.3): sharing one person's ChatGPT or Grok breaks the vendors' terms, so each member
// signs in to their own, from inside the app, into their own credential file under Crewhouse's folders.
// @byokit/accounts does the signing in (ChatGPT's page straight back here, the code as fallback), resting and
// refreshing; this file says which accounts Crewhouse offers and where each member's sign-ins live.
import './isolate.ts';
import { join } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Accounts as Kit, fileStore, offered } from '@byokit/accounts';
import type { Config } from './config.ts';

export { callbackPage, planOf, signInError } from '@byokit/accounts';
export const OWNER = 1;

/** ChatGPT is the one front door the app shows; the rest are quiet "more options" paths the app doesn't offer yet.
 *  No Claude (Anthropic allows its subscriptions only in its own apps) and no Meta (the owner's choice): the kit has neither. */
export const PROVIDERS = Object.fromEntries(offered(['chatgpt', 'grok', 'copilot', 'openrouter']).map((p) => [p.key, p]));

export function provider(key: string) {
  const p = PROVIDERS[key];
  if (!p) throw Object.assign(new Error('no such AI account'), { status: 404 });
  return p;
}

/** ChatGPT sends the browser back here, on this computer, and nowhere else: it is fixed for the client the engine signs in as. */
export const CALLBACK_PORT = Number(process.env.CREWHOUSE_CALLBACK_PORT || 1455);

export class Accounts extends Kit<ModelRuntime, number> {
  private cfg: Config;
  /** Set by the stub engine: its scripted model stands in for every provider. */
  prepare?: (runtime: ModelRuntime) => void;

  constructor(cfg: Config) {
    super({
      app: 'Crewhouse', offer: Object.keys(PROVIDERS), store: (m) => fileStore(this.authPath(m)), callbackPort: CALLBACK_PORT,
      signInMs: Number(process.env.CREWHOUSE_SIGNIN_MS || 15 * 60_000), redirectMs: Number(process.env.CREWHOUSE_REDIRECT_MS || 3 * 60_000),
    });
    this.cfg = cfg;
  }

  /** A member's own credential file. The owner has one too: nothing falls back to another sign-in on this computer. */
  authPath(member: number) { return join(this.cfg.stateDir, 'people', String(member), 'engine', 'auth.json'); }

  /** One engine runtime per member, holding only their own sign-ins. */
  protected open(member: number) {
    return ModelRuntime.create({ credentials: this.store(member), modelsPath: null, refreshOnCreate: false }).then((rt) => { this.prepare?.(rt); return rt; });
  }
}
