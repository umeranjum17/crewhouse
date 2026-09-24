import { execFile, spawn } from 'node:child_process';

/** Lifecycle as the runner sees it. idle/done = ready for input; blocked = the CLI shows a question UI. */
export type RunState = 'off' | 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export interface LaunchSpec {
  bot: string;
  /** Agent kind, e.g. claude or codex. The real, unmodified CLI of that name runs. */
  kind: string;
  cwd: string;
  label: string;
  args: string[];
  env: Record<string, string>;
}

/** The one seam between crewd and the CLIs. crewd never speaks a CLI protocol itself. */
export interface Runner {
  start(spec: LaunchSpec): Promise<void>;
  prompt(bot: string, text: string): Promise<void>;
  state(bot: string): Promise<RunState>;
  read(bot: string, lines?: number): Promise<string>;
  /** Logical keys (enter, esc, 1, down...) into a blocked CLI UI. */
  keys(bot: string, keys: string[]): Promise<void>;
  /** Literal text then Enter, for a free-text reply to a blocked CLI. */
  text(bot: string, text: string): Promise<void>;
  /** The live terminal picture, for "Show the work". */
  screen(bot: string): Promise<string>;
  interrupt(bot: string): Promise<void>;
  stop(bot: string): Promise<void>;
}

class HerdrError extends Error {
  code?: string;
  constructor(msg: string, code?: string) { super(msg); this.code = code; }
}

/** Runs each bot's CLI in its own Herdr workspace, in crewd's own Herdr session (never the owner's default).
 *  `cmd` is a prefix so a lab wrapper can supply the session instead. */
export class HerdrRunner implements Runner {
  private cmd: string[];
  private session: string;
  private workspaces = new Map<string, string>();

  constructor(cmd: string[], session: string) { this.cmd = cmd; this.session = session; }

  private call(args: string[], timeoutMs = 60_000): Promise<any> {
    // --session is a Herdr option: it goes before any `--` so it never becomes an agent argument.
    if (this.session) {
      const i = args.indexOf('--');
      args = i < 0 ? [...args, '--session', this.session] : [...args.slice(0, i), '--session', this.session, ...args.slice(i)];
    }
    return new Promise((resolve, reject) => {
      execFile(this.cmd[0], [...this.cmd.slice(1), ...args], { timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
        const out = stdout.trim() || stderr.trim();
        let json: any;
        try { json = JSON.parse(out.split('\n').pop() || ''); } catch { /* not json */ }
        if (err || json?.error) {
          const e = json?.error;
          return reject(new HerdrError(e?.message || out || String(err), e?.code));
        }
        resolve(json?.result ?? out);
      });
    });
  }

  private name(bot: string) { return `crew-${bot}`; }

  /** Start crewd's own headless Herdr server if it isn't running. Lab wrappers own their server. */
  async ensureServer() {
    if (!this.session) return;
    const st = await this.call(['status', '--json']).catch(() => null);
    const status = typeof st === 'string' ? JSON.parse(st) : st;
    if (status?.server?.running) return;
    const child = spawn(this.cmd[0], [...this.cmd.slice(1), 'server', '--session', this.session], { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const again = await this.call(['status', '--json']).catch(() => null);
      if ((typeof again === 'string' ? JSON.parse(again) : again)?.server?.running) return;
    }
    throw new Error(`Herdr session ${this.session} did not start`);
  }

  async start(spec: LaunchSpec) {
    if ((await this.state(spec.bot)) !== 'off') return;
    const env = Object.entries(spec.env).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
    // One workspace per bot, rooted in the bot's folder.
    const ws = await this.call(['workspace', 'create', '--cwd', spec.cwd, '--label', spec.label, '--no-focus', ...env]);
    this.workspaces.set(spec.bot, ws.workspace.workspace_id);
    try {
      await this.call(['agent', 'start', this.name(spec.bot), '--kind', spec.kind, '--pane', ws.root_pane.pane_id,
        '--timeout', '90000', '--', ...spec.args], 100_000);
    } catch (e: any) {
      // A first-run dialog (folder trust) blocks startup; crewd shows it to the person as an ask.
      if (e.code !== 'agent_not_ready') throw e;
    }
  }

  async prompt(bot: string, text: string) {
    // Submission only; completion arrives via the CLI's own hooks or the state poll.
    await this.call(['agent', 'prompt', this.name(bot), text]);
  }

  async state(bot: string): Promise<RunState> {
    try {
      const r = await this.call(['agent', 'get', this.name(bot)], 15_000);
      return (r.agent?.agent_status ?? 'unknown') as RunState;
    } catch (e: any) {
      if (/not.?found|no agent|unknown agent/i.test(e.message + (e.code ?? ''))) return 'off';
      throw e;
    }
  }

  async read(bot: string, lines = 80) {
    const r = await this.call(['agent', 'read', this.name(bot), '--source', 'recent-unwrapped', '--lines', String(lines)]);
    return typeof r === 'string' ? r : (r.read?.text ?? r.text ?? JSON.stringify(r));
  }

  async screen(bot: string) {
    const r = await this.call(['agent', 'read', this.name(bot), '--source', 'visible'], 15_000);
    return typeof r === 'string' ? r : (r.text ?? JSON.stringify(r));
  }

  async keys(bot: string, keys: string[]) {
    await this.call(['agent', 'send-keys', this.name(bot), ...keys]);
  }

  async text(bot: string, text: string) {
    const r = await this.call(['agent', 'get', this.name(bot)]);
    await this.call(['pane', 'send-text', r.agent.pane_id, text]);
    await this.keys(bot, ['enter']);
  }

  async interrupt(bot: string) { await this.keys(bot, ['esc']); }

  async stop(bot: string) {
    // After a crewd restart the workspace is only known to Herdr, so ask it.
    const ws = this.workspaces.get(bot) ?? (await this.call(['agent', 'get', this.name(bot)]).catch(() => null))?.agent?.workspace_id;
    if (ws) await this.call(['workspace', 'close', ws]).catch(() => {});
    this.workspaces.delete(bot);
  }
}

/** Test runner: no CLI, no quota. Replies through the same hook path a real CLI uses. */
export class StubRunner implements Runner {
  private states = new Map<string, RunState>();
  private out = new Map<string, string>();
  /** Set by crewd: deliver a finished turn exactly like a Stop hook would. */
  onTurn?: (bot: string, reply: string) => void;

  async start(spec: LaunchSpec) { if (!this.states.has(spec.bot)) this.states.set(spec.bot, 'idle'); }

  async prompt(bot: string, text: string) {
    this.states.set(bot, 'working');
    this.out.set(bot, text);
    setTimeout(() => {
      if (/needs approval/i.test(text)) { this.states.set(bot, 'blocked'); return; }
      if (/ask permission/i.test(text)) return; // stays working; the test plays the CLI's hooks
      this.states.set(bot, 'done');
      this.onTurn?.(bot, `stub ${bot}: done with "${text.split('\n').pop()!.slice(0, 60)}"`);
    }, 50);
  }

  async state(bot: string) { return this.states.get(bot) ?? 'off'; }
  async read(bot: string) { return `[stub pane of ${bot}]\n${this.out.get(bot) ?? ''}\nDo you want to proceed? 1. Yes 2. No`; }

  async keys(bot: string, _keys: string[]) {
    if (this.states.get(bot) !== 'blocked') return;
    this.states.set(bot, 'done');
    setTimeout(() => this.onTurn?.(bot, `stub ${bot}: continued after your answer`), 20);
  }

  async text(bot: string, _text: string) { await this.keys(bot, ['enter']); }
  async screen(bot: string) { return this.read(bot); }
  async interrupt(bot: string) { if (this.states.get(bot) === 'working') this.states.set(bot, 'idle'); }
  async stop(bot: string) { this.states.delete(bot); }
}
