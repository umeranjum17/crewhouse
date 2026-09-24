import { execFile } from 'node:child_process';

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
  stop(bot: string): Promise<void>;
}

class HerdrError extends Error {
  code?: string;
  constructor(msg: string, code?: string) { super(msg); this.code = code; }
}

/** Runs each bot's CLI in its own Herdr tab. `cmd` is a prefix so a lab wrapper can pin the session. */
export class HerdrRunner implements Runner {
  private workspace?: string;
  private tabs = new Map<string, string>();

  private cmd: string[];
  constructor(cmd: string[]) { this.cmd = cmd; }

  private call(args: string[], timeoutMs = 60_000): Promise<any> {
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

  private async ensureWorkspace(cwd: string) {
    if (this.workspace) return this.workspace;
    const list = await this.call(['workspace', 'list']);
    const ws = list.workspaces?.find((w: any) => w.label === 'Crewhouse');
    this.workspace = ws?.workspace_id
      ?? (await this.call(['workspace', 'create', '--cwd', cwd, '--label', 'Crewhouse', '--no-focus'])).workspace.workspace_id;
    return this.workspace!;
  }

  async start(spec: LaunchSpec) {
    if ((await this.state(spec.bot)) !== 'off') return;
    const ws = await this.ensureWorkspace(spec.cwd);
    const env = Object.entries(spec.env).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
    const tab = await this.call(['tab', 'create', '--workspace', ws, '--cwd', spec.cwd, '--label', spec.label, ...env]);
    this.tabs.set(spec.bot, tab.tab.tab_id);
    try {
      await this.call(['agent', 'start', this.name(spec.bot), '--kind', spec.kind, '--pane', tab.root_pane.pane_id,
        '--timeout', '90000', '--', ...spec.args], 100_000);
    } catch (e: any) {
      // A first-run dialog (folder trust) blocks startup; the caller surfaces it as a "needs you" item.
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

  async keys(bot: string, keys: string[]) {
    await this.call(['agent', 'send-keys', this.name(bot), ...keys]);
  }

  async text(bot: string, text: string) {
    const r = await this.call(['agent', 'get', this.name(bot)]);
    await this.call(['pane', 'send-text', r.agent.pane_id, text]);
    await this.keys(bot, ['enter']);
  }

  async stop(bot: string) {
    // After a crewd restart the tab is only known to Herdr, so ask it.
    const tab = this.tabs.get(bot) ?? (await this.call(['agent', 'get', this.name(bot)]).catch(() => null))?.agent?.tab_id;
    if (tab) await this.call(['tab', 'close', tab]).catch(() => {});
    this.tabs.delete(bot);
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
  async stop(bot: string) { this.states.delete(bot); }
}
