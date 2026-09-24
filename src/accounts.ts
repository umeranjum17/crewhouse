// Per-person AI accounts (plan 3, 4.3): sharing one person's Claude or ChatGPT breaks the vendors' terms, so each
// member signs in to their own, into their own CLI config home. crewd runs the vendors' own login and status
// commands and never opens what they write.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Config } from './config.ts';

export const OWNER = 1;
const HOME_VAR: Record<string, string> = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' };
const USUAL: Record<string, string> = { claude: '~/.claude', codex: '~/.codex' };
const STATUS: Record<string, string[]> = { claude: ['claude', 'auth', 'status'], codex: ['codex', 'login', 'status'] };
// Device code for Codex, so the sign-in works from any browser; Claude prints a link and reads the code back.
const LOGIN: Record<string, string[]> = { claude: ['claude', 'auth', 'login'], codex: ['codex', 'login', '--device-auth'] };

/** A member's config home for a CLI. The owner keeps the CLI's usual one, so a one-person house runs exactly as before. */
export function home(cfg: Config, member: number, runtime: string): string | null {
  return member === OWNER || !HOME_VAR[runtime] ? null : join(cfg.stateDir, 'people', String(member), runtime);
}

/** The environment that points a CLI at the member's own sign-in. */
export function homeEnv(cfg: Config, member: number, runtime: string): Record<string, string> {
  const h = home(cfg, member, runtime);
  if (!h) return {};
  mkdirSync(h, { recursive: true, mode: 0o700 });
  return { [HOME_VAR[runtime]]: h };
}

/** Where a member's sign-in lives, for Settings. */
export function where(cfg: Config, member: number, runtime: string) {
  const h = home(cfg, member, runtime) ?? process.env[HOME_VAR[runtime]] ?? USUAL[runtime];
  return h.startsWith(homedir() + '/') ? '~' + h.slice(homedir().length) : h;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
export type Readiness = { state: 'ready' | 'signed-out' | 'missing'; plan?: string; at: number };

export class Accounts {
  private cfg: Config;
  private seen = new Map<string, Readiness>();
  private logins = new Map<string, { proc: ChildProcess; out: string; state: 'running' | 'done' | 'failed' }>();
  onChange?: (member: number, runtime: string) => void;

  constructor(cfg: Config) { this.cfg = cfg; }

  private env(member: number, runtime: string) { return { ...process.env, ...homeEnv(this.cfg, member, runtime), NO_COLOR: '1' }; }

  /** Ready, signed out or not installed, from the vendor's own status command; cached for a minute. */
  status(member: number, runtime: string, fresh = false): Promise<Readiness> {
    const key = `${member}:${runtime}`;
    const had = this.seen.get(key);
    if (had && !fresh && Date.now() - had.at < 60_000) return Promise.resolve(had);
    const [cmd, ...args] = STATUS[runtime];
    return new Promise((resolve) => {
      execFile(cmd, args, { env: this.env(member, runtime), timeout: 20_000 }, (err: any, stdout) => {
        let r: Readiness;
        if (err?.code === 'ENOENT') r = { state: 'missing', at: Date.now() };
        else if (runtime === 'claude') {
          // Only the two fields we show; the rest of the status (the email, the org) stays unread.
          let s: any = {};
          try { s = JSON.parse(stdout); } catch { /* old CLI */ }
          r = { state: s.loggedIn ? 'ready' : 'signed-out', plan: s.loggedIn ? s.subscriptionType ?? undefined : undefined, at: Date.now() };
        } else r = { state: err ? 'signed-out' : 'ready', plan: /chatgpt/i.test(stdout) ? 'ChatGPT' : /api key/i.test(stdout) ? 'API key' : undefined, at: Date.now() };
        this.seen.set(key, r);
        resolve(r);
      });
    });
  }

  /** Known to be signed out or not installed (never true for an unchecked account, so a first run still tries). */
  unready(member: number, runtime: string) { const s = this.seen.get(`${member}:${runtime}`)?.state; return !!s && s !== 'ready'; }

  /** The vendor's own sign-in, run into the member's config home. Its output (a link, a one-time code) is shown to them. */
  login(member: number, runtime: string) {
    const key = `${member}:${runtime}`;
    if (!LOGIN[runtime]) throw Object.assign(new Error(`no sign-in for ${runtime}`), { status: 400 });
    if (this.logins.get(key)?.state === 'running') return;
    const [cmd, ...args] = LOGIN[runtime];
    const proc = spawn(cmd, args, { env: this.env(member, runtime), stdio: ['pipe', 'pipe', 'pipe'] });
    const l = { proc, out: '', state: 'running' as 'running' | 'done' | 'failed' };
    this.logins.set(key, l);
    const add = (b: Buffer) => { l.out = (l.out + b.toString().replace(ANSI, '')).slice(-4000); this.onChange?.(member, runtime); };
    proc.stdout!.on('data', add);
    proc.stderr!.on('data', add);
    proc.on('error', (e) => { l.state = 'failed'; l.out += `\n${e.message}`; this.onChange?.(member, runtime); });
    proc.on('close', async (code) => {
      if (l.state === 'running') l.state = code === 0 ? 'done' : 'failed';
      await this.status(member, runtime, true);
      this.onChange?.(member, runtime);
    });
  }

  /** A line typed back into the sign-in, such as the code Claude's page shows. */
  loginInput(member: number, runtime: string, text: string) {
    const l = this.logins.get(`${member}:${runtime}`);
    if (l?.state !== 'running') throw Object.assign(new Error('no sign-in is waiting'), { status: 409 });
    l.proc.stdin!.write(text.trim() + '\n');
  }

  cancelLogin(member: number, runtime: string) {
    const l = this.logins.get(`${member}:${runtime}`);
    if (l?.state === 'running') { l.state = 'failed'; l.proc.kill(); }
    this.logins.delete(`${member}:${runtime}`);
  }

  loginView(member: number, runtime: string) {
    const l = this.logins.get(`${member}:${runtime}`);
    // The CLIs' own warnings (PATH aliases and the like) mean nothing to the person signing in.
    return l ? { state: l.state, out: l.out.split('\n').filter((x) => !/^WARNING:/.test(x)).join('\n').trim() } : null;
  }

  stop() { for (const l of this.logins.values()) if (l.state === 'running') l.proc.kill(); }
}
