// The BYOKit engine port: accounts, runs, tools and Crewhouse's learned-skill capture.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION, OpenClawKit, stateWords, type KitOptions, type KitState, type SignInView, type ToolSpec, type RunSpec as KitRunSpec } from '@byokit/openclaw';
import { osKeyringSeal } from '@byokit/secrets';
import { PROVIDERS } from '../accounts.ts';
import { commit } from '../bots.ts';
import { CALLBACK_PORT } from '../callback-port.ts';
import { appDir, loadConfig } from '../config.ts';
import { PARAMETERS } from '../engine.ts';
import { accountRef, refParts } from '../runtime.ts';
import type { AccountRow, AgentRuntime, RunEnd, RunEvent, RunRef, RunSpec, SignInStep, ToolHost } from '../runtime.ts';

export { ENGINE_VERSION };

/** Crewhouse account key → OpenClaw provider id, one per account the sign-in card offers. Claude is its CLI: the kit names it claude-cli, never anthropic. */
const PROVIDER_OF: Record<string, string> = { chatgpt: 'openai', grok: 'xai', copilot: 'github-copilot', openrouter: 'openrouter', minimax: 'minimax', claude: 'claude-cli', 'opencode-go': 'opencode-go' };
/** The engine's provider id back to Crewhouse's account word (the Codex CLI's own login is a ChatGPT account too). */
const PROVIDER_FOR: Record<string, string> = { ...Object.fromEntries(Object.entries(PROVIDER_OF).map(([k, v]) => [v, k])), 'openai-codex': 'chatgpt' };
/** Which providers can hold a second account; the words say why not (a plan key is one per provider, and Claude Code's own
 *  folder is one per computer: kit 0.28.1 binds a second in place but the engine cannot run on that binding yet). */
const SECOND: Record<string, string> = { chatgpt: '', grok: '', copilot: '', claude: 'Claude Code keeps one sign-in on this computer, so a second Claude account cannot run yet.', openrouter: 'A second OpenRouter key is not supported yet.', minimax: 'A second MiniMax key is not supported yet.', 'opencode-go': 'A second OpenCode Go key is not supported yet.' };
/** The engine's own sign-in route per account (the pin's wizard choices). */
const AUTH_CHOICE: Record<string, string> = {
  chatgpt: 'openai', grok: 'xai-oauth', copilot: 'github-copilot', openrouter: 'openrouter-oauth', minimax: 'minimax-global-api', claude: 'anthropic-cli', 'opencode-go': 'opencode-go',
}, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), ME = 'm1';
/** The engine-side name of a Crewhouse tool and back: only the shell differs. */
const crewName = (tool: string) => tool === 'shell' ? 'bash' : tool, MAX_LEGS = 24, LEGWORK = new Set(['web_search', 'web_fetch']), HANDOFF_MS = () => Number(process.env.CREWHOUSE_HANDOFF_MS || 120_000); // Chief's spawned lookups: at most MAX_LEGS a job, web reads only; a hand-off waits this long for a helper's report
/** The engine's log since a start began (the kit appends its output there): read once per failed start, never on `state` polls. */
const logSince = (stateDir: string, at: number) => { try { const b = readFileSync(join(stateDir, 'logs', 'openclaw.log')); return b.subarray(Math.min(at, b.length)).toString('utf8').split('\n').map((l) => l.trim()).filter(Boolean); } catch { return []; } };

/** Why the engine failed, in the person's words: one plain sentence naming the cause and the one action that fixes it, with the
 *  engine's own last words behind Details. The one place a failed start is worded, so every screen that shows it says this, and
 *  it never retries for the person: the kit's typed refusal, its retained install diagnosis and the engine's log say the cause. */
function failedWords(e: unknown, s: KitState, stateDir: string, started: { at: number; since: number }) {
  const o = { log: logSince(stateDir, started.at), diagnosis: join(stateDir, 'logs', 'engine-install-drift.json'), ...started }, out = (words: string, detail = '') => ({ words, detail: detail.slice(0, 600).trim() });
  const cause = (e as { cause?: string })?.cause, code = (e as { code?: string })?.code, said = e instanceof Error ? e.message : '';
  const d = cause === 'write' && existsSync(o.diagnosis) ? JSON.parse(readFileSync(o.diagnosis, 'utf8')) : null, fresh = d && Date.parse(d.at) >= o.since;
  const log = o.log.join('\n'), detail = [said, o.log.slice(-4).join('\n'), fresh ? d.npmStderrTail : ''].filter(Boolean).join('\n'), denied = code === 'EACCES' || code === 'EPERM' || /EACCES|EPERM|permission denied/i.test(log) || (fresh && /EACCES|EPERM|permission denied/i.test(d.npmStderrTail));
  if (cause === 'drift-after-build') return out("The download didn't match what Crewhouse trusts, so it wasn't used. Try again.", detail);
  if (fresh && !d.npm?.version) return out("Crewhouse needs npm, which comes with Node.js, to set up your crew, and this computer doesn't have it. Install Node.js, then try again.", detail);
  if (fresh && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|network/.test(d.npmStderrTail)) return out("Crewhouse couldn't download what your crew needs. Check that this computer is online, then try again.", d.npmStderrTail);
  if (s.why === 'engine-already-running' || s.why?.startsWith('auth-store')) return out(stateWords(s), detail);
  if (denied) return out("Crewhouse isn't allowed to use its own files on this computer. Give its folder permission, then try again.", detail);
  if (/EADDRINUSE|already in use|already listening/i.test(log)) return out('Another program on this computer is using what your crew needs to start. Close that program, then try again.', detail);
  if (!o.log.length) return out('Some of the files your crew needs are missing from this computer. Install Crewhouse again to put them back.', detail);
  return out(stateWords(s) || "Your crew couldn't start on this computer. Restart Crewhouse, then try again.", detail);
}

const ABOUT: Record<string, string> = {
  shell: 'Run a shell command in your sandbox; only your folder is writable. Long output is cut to its last lines.', crew_profile: 'Save person facts.', crew_signin: 'Ask for a sign-in',
  browser: 'Your own browser (playwright-axi): goto <url>, snapshot, find <text>, click <ref>, fill <ref> <text>, press <key>, go-back.',
  crew_inspect: "Look inside a binary file in your own folder: `what` is type, headers, strings, symbols or sections, `path` is the file. It never runs it and never writes.",
  calendar: "The person's own Google Calendar: see what is next, the day or week, free time, add, move, cancel, as `args`.",
  mail: "The person's own Gmail: new mail, search, read, save an attachment, draft a reply, label it, as `args`; it cannot send mail.",
  crew_app: "Use one of the person's connected apps' tools: `tool` names it (the run's prompt lists them) and `input` carries its arguments.",
  crew_rule: 'Propose a rule; asks first.',
  crew_remember: 'Save person facts: {text}, replaces?, everyone?. Rules need crew_rule.',
  crew_document: 'Write and deliver a document: pass {name: "title", blocks: [...]}. Crewhouse writes the file; do not make it yourself.',
};
export const TOOLS: ToolSpec[] = Object.entries(PARAMETERS).map(([name, parameters]) => ({ name, description: ABOUT[name] ?? `Crewhouse ${name.slice(5).replaceAll('_', ' ')}. The person sees the result in their crew.`, parameters }));

const CONFIG = {
  // An empty allow list: the engine otherwise narrows to its model map, and the person's other providers vanish.
  agents: { defaults: { sandbox: { mode: 'off' }, modelPolicy: { allow: [] }, compaction: { memoryFlush: { enabled: false } }, heartbeat: { every: '0m' }, subagents: { maxSpawnDepth: 1, maxChildrenPerAgent: 8, maxConcurrent: 8, runTimeoutSeconds: 900 } } },
  // bundle-mcp admits the MCP servers' tools (Composio's): the Claude CLI route gets its tools only through this policy; the gate still admits them for Chief alone.
  tools: { profile: 'coding', alsoAllow: [...TOOLS.map((t) => t.name), 'computer', 'sessions_send', 'sessions_spawn', 'bundle-mcp'], deny: ['group:fs', 'group:runtime', 'group:automation', 'group:messaging', 'nodes', 'group:ui', 'conversations_send', 'conversations_turn', 'subagents', 'code_execution', 'gateway', 'openclaw', 'plugins', 'cron', 'ask_user', 'suggest_task'], fs: { workspaceOnly: true }, exec: { security: 'deny', ask: 'always' }, elevated: { enabled: false }, agentToAgent: { enabled: false }, sessions: { visibility: 'agent' } },
  // A bot's computer is OpenClaw's own node host on its display (`computer`); of a node host's commands only the screen's two pass.
  gateway: { nodes: { pluginTools: { enabled: false }, allowSkills: false, commands: { deny: ['browser.proxy', 'browser.proxy.upload.v1', 'fs.listDir', 'mcp.tools.call.v1', 'ollama.chat', 'ollama.models', 'system.execApprovals.get', 'system.execApprovals.set', 'system.notify', 'system.run', 'system.run.prepare', 'system.which', 'terminal.upload'] } } },
  plugins: { load: { paths: [] }, allow: ['crewhouse', 'memory-core', 'openai', 'opencode-go', 'cua-computer'], entries: {
    'memory-core': { config: { dreaming: { enabled: false } } }, 'cua-computer': { enabled: true },
    codex: { enabled: false },
  } },
  skills: { allowBundled: ['openai-whisper', 'summarize', 'nano-pdf', 'diagram-maker'], workshop: { approvalPolicy: 'auto' } },
};

export class OpenClawRuntime implements AgentRuntime {
  readonly identity = { name: 'OpenClaw', version: ENGINE_VERSION };
  readonly kit: OpenClawKit;
  readonly stateDir: string;
  private host?: ToolHost; private keyChecks = new Set<string>();
  private runs = new Map<string, RunRef & { account?: string; keyLane?: boolean }>(); private personas = new Set<string>(); // neutral workspace files; each session supplies its own persona
  private targets = new Map<string, Map<string, { bot: string; run?: RunRef }>>(); private legs = new Map<string, number>(); // a native job's spawned-lookup count
  private waits = new Set<string>(); // a run that has handed work to a helper and is still waiting for its report
  private failed?: { words: string; detail: string }; private nodes = new Map<string, { display: string; child: ChildProcess }>();
  onEngine?: () => void; // every phase change, so Hello's getting-ready screen follows the kit
  constructor(stateDir: string, crewDir = '', o: Partial<KitOptions> = {}) {
    this.stateDir = stateDir;
    this.kit = new OpenClawKit({
      stateDir, offered: [...new Set([...Object.values(PROVIDER_OF), 'openai-codex'])], engineDir: loadConfig().engineDir, onState: () => this.onEngine?.(), plugin: { id: 'crewhouse' }, tools: TOOLS, config: CONFIG, enginePath: (process.env.PATH ?? '').split(':').filter((d) => d && ['claude', 'codex'].some((cli) => existsSync(join(d, cli)))), // only installed CLI directories enter the engine's otherwise /usr/bin:/bin PATH
      authSeal: 'authSeal' in o ? o.authSeal : osKeyringSeal({ service: 'crewhouse-engine', dualWrap: true }),
      permitted: (tool) => tool.startsWith('crew_'), callbackPort: CALLBACK_PORT,
      installPolicy: { trustedSkills: join(appDir, 'src/openclaw/trusted-skills.json'), ownRoots: [appDir, crewDir].filter(Boolean) },
      host: {
        // A key the kit passes that Crewhouse never registered is the armed curation window's one call (allowOnce).
        gate: async (ref, tool, input) => {
          const run = this.runOf(ref.sessionKey), leg = !run && ref.parent && !ref.helper && ref.root ? this.runOf(ref.root.sessionKey) : undefined; // legwork: a child Chief's run spawned
          if (!run) return leg ? this.host && LEGWORK.has(tool) ? this.host.gate(leg, crewName(tool), input) : { allow: false, reason: 'This legwork only reads the web. Report what you found.' } : ref.parent || ref.helper ? { allow: false, reason: 'This helper’s task is no longer active.' } : { allow: true };
          if (!this.host) return { allow: false, reason: 'Crewhouse could not check this call.' };
          // A helper has the job: Chief waits for its report instead of working past it. The report arrives in the
          // run's next turn, so the model ends this turn and answers the person from it there.
          if (this.waits.has(run.key)) return { allow: false, reason: 'The helper has this job now. Wait for its report: it arrives in your next turn, and you answer the person from it there. Do not call any tool until then.' };
          if (tool === 'sessions_yield') return this.legs.get(run.key) ? { allow: true } : { allow: false, reason: 'There is nothing to wait for.' };
          if (tool === 'sessions_spawn') {
            const own = /^agent:([^:]+):/.exec(ref.sessionKey)?.[1], n = this.legs.get(run.key) ?? MAX_LEGS;
            if (n >= MAX_LEGS || input.agentId !== own || typeof input.task !== 'string' || !input.task.trim() || Object.keys(input).some((k) => !['task', 'label', 'agentId'].includes(k))) return { allow: false, reason: `Pass only task (one thing to look up), optional label, and agentId "${own}", up to ${MAX_LEGS} lookups in Chief's own job; do the rest in a later job.` };
            return this.legs.set(run.key, n + 1) && { allow: true };
          }
          if (tool === 'sessions_send') {
            const target = this.targets.get(run.key)?.get(String(input.sessionKey));
            if (!target || input.timeoutSeconds !== 0 || input.label !== undefined || !this.host.delegate) return { allow: false, reason: 'Use an available helper session from this job, with timeoutSeconds 0.' };
            try {
              target.run = await this.host.delegate(run, target.bot, String(input.sessionKey), typeof input.message === 'string' ? input.message : '');
              this.runs.set(String(input.sessionKey), target.run);
              this.waits.add(run.key); // the helper has the job now: the run waits for its report
              return { allow: true };
            } catch (e) { return { allow: false, reason: (e as Error).message }; }
          }
          const decision = await this.host.gate(run, crewName(tool), input);
          return decision.allow ? decision : { allow: false, reason: decision.reason };
        },
        call: async (ref, tool, input, signal) => {
          const run = this.runOf(ref.sessionKey);
          if (!run || !this.host) throw new Error('Unknown run');
          return this.host.call(run, crewName(tool), input, signal);
        },
      },
      ...o,
    });
  }
  /** The run behind a callback: a key-lane run's engine key is the member's own under the kit's key-agent prefix. */
  private runOf(sessionKey: string) { return this.runs.get(sessionKey) ?? this.runs.get(sessionKey.replace(/^agent:byokit-key-/, 'agent:')); }
  async start(host: ToolHost) { this.host = host; this.failed = undefined; const at = statSync(join(this.stateDir, 'logs', 'openclaw.log'), { throwIfNoEntry: false })?.size ?? 0, since = Date.now(); await this.kit.start().catch((e: unknown) => { this.failed = failedWords(e, this.kit.state, this.stateDir, { at, since }); this.onEngine?.(); throw e; }); }
  /** The engine as the app's first screen shows it: the kit's real phase and its words, or why the last start failed. */
  engine() { return this.failed ? { phase: 'failed', ...this.failed } : { phase: this.kit.state.phase, words: stateWords(this.kit.state) }; }
  async stop() { for (const n of this.nodes.values()) n.child.kill(); this.nodes.clear(); await this.kit.stop(); }
  /** `openclaw node run` with its bundled cua-computer on the bot's display, its own state and an env built from nothing;
   *  crewd approves its command surface (docs/nodes/computer-use.md). ponytail: a node outlives an idle-swept desktop
   *  until the next desktop replaces it; the kit should supervise node hosts (findings.md). */
  async computer(bot: string, screen: { DISPLAY: string; XAUTHORITY: string }) {
    const name = `crewhouse-${bot}`, had = this.nodes.get(bot);
    if (had?.display === screen.DISPLAY && had.child.exitCode === null) return name;
    had?.child.kill();
    const { entry, env } = this.kit.doctorContext(), dir = join(this.stateDir, 'nodes', bot), port = readFileSync(join(this.stateDir, 'openclaw', 'port'), 'utf8').trim();
    mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'openclaw.json'), JSON.stringify({ plugins: { entries: { 'cua-computer': { enabled: true } } } }));
    const child = spawn(process.execPath, [entry, 'node', 'run', '--host', '127.0.0.1', '--port', port, '--no-tls', '--display-name', name], { cwd: dir, stdio: 'ignore', env: {
      PATH: env.PATH, LANG: env.LANG, HOME: dir, TMPDIR: dir, OPENCLAW_STATE_DIR: dir, OPENCLAW_CONFIG_PATH: join(dir, 'openclaw.json'), OPENCLAW_GATEWAY_TOKEN: env.OPENCLAW_GATEWAY_TOKEN,
      OPENCLAW_NO_RESPAWN: '1', OPENCLAW_DISABLE_BONJOUR: '1', XDG_SESSION_TYPE: 'x11', ...screen } });
    this.nodes.set(bot, { display: screen.DISPLAY, child });
    for (let i = 0; i < 90 && child.exitCode === null; i++, await sleep(1000)) {
      const up = await this.kit.call('node.list', {}) as { nodes?: { displayName?: string; connected?: boolean; commands?: string[] }[] };
      if (up.nodes?.some((n) => n.displayName === name && n.connected && n.commands?.includes('computer.act'))) return name;
      const { pending } = await this.kit.call('node.pair.list', {}) as { pending?: { requestId: string; displayName?: string }[] }, ask = pending?.find((p) => p.displayName === name);
      if (ask) await this.kit.call('node.pair.approve', { requestId: ask.requestId });
    }
    child.kill(); this.nodes.delete(bot);
    throw new Error("the bot's computer did not start");
  }
  signInRecovery() { return this.kit.state.phase === 'locked' || this.kit.state.why === 'engine-already-running' || this.kit.state.why === 'auth-store-unreadable' ? stateWords(this.kit.state) : ''; }
  memoryLimited() { return this.kit.memoryLimited(ME); }

  // ---- accounts: the engine owns credentials; the kit drives its wizard and reads its status ----

  private async routeOf(account: string) { if (account !== 'chatgpt') return PROVIDER_OF[account]; if (process.env.CREWHOUSE_CODEX_CLI_ONLY === '1') return 'openai-codex'; const signed = await this.kit.providerStatus(ME).catch(() => undefined) ?? []; return signed.includes('openai-codex') && !signed.includes('openai') ? 'openai-codex' : 'openai'; }
  private acct?: { at: number; rows: AccountRow[] };
  /** Every account the engine keeps for this person, two of one provider included (id, Crewhouse's provider, its own name). */
  async accounts(): Promise<AccountRow[]> {
    if (this.acct && this.acct.at > Date.now() - 10_000) return this.acct.rows;
    const prefer = await this.routeOf('chatgpt').catch(() => undefined), rows = (await this.kit.accounts(ME)).filter((a) => !a.id.endsWith('.key') && PROVIDER_FOR[a.provider]), seen = new Set<string>();
    const mapped = rows.sort((a, b) => Number(b.id === prefer || b.id === b.provider) - Number(a.id === prefer || a.id === a.provider)).map((a): AccountRow => {
      const provider = PROVIDER_FOR[a.provider], first = a.id === prefer || (a.provider !== 'openai-codex' && a.id === a.provider), label = first ? '' : String(a.name || a.label || a.id);
      return { id: a.id, provider, ...(label ? { label } : {}), ...(a.email ? { email: a.email } : {}), ...(a.plan ? { plan: a.plan } : {}), ...(a.until ? { until: a.until } : {}), state: a.state }; });
    return (this.acct = { at: Date.now(), rows: mapped.filter((r) => !seen.has(accountRef(r.provider, r.label)) && !!seen.add(accountRef(r.provider, r.label))) }).rows;
  }
  /** The engine's own id for the account the person's key names, or undefined when it lists no such account (a key lane, an
   *  account signed out, an engine not started: a run then names none and the kit answers in its own words). */
  private async idOf(account: string) {
    const [provider, label] = refParts(account);
    return PROVIDER_OF[provider] ? (await this.accounts().catch(() => [])).find((r) => r.provider === provider && (r.label ?? '') === label)?.id : undefined;
  }
  async signedIn(account: string) {
    const [provider, label] = refParts(account), id = label ? await this.idOf(account) : await this.routeOf(provider);
    if (!id) return false;
    if (!label) return await this.kit.signedIn(ME, id) || !!(await this.kit.providerStatus(ME).catch(() => undefined))?.includes(id); // the engine's own list is the first word: the CLI's login and a sealed key are both its own, and the kit's admission read does not see a CLI-owned one
    const row = (await this.accounts()).find((r) => r.id === id);
    return !!row && (row.state === 'ready' || row.state === 'resting' || row.state === 'unknown'); // an unanswered probe is no sign-out: the engine asks again on the run
  }
  /** How a sign-in ended, in the card's plain words. */
  private view(v: SignInView, on: (step: SignInStep) => void, name: string) {
    if (v.state === 'waiting') on({ waiting: true, ...(v.url ? { url: v.url } : {}), ...(v.code ? { code: v.code } : {}), ...(v.error ? { error: v.error } : {}) });
    else if (v.state === 'done') on({ waiting: false, done: true });
    else if (v.why === 'busy') on({ waiting: false, error: 'Another sign-in is already in progress. Finish or cancel it, then try again.' });
    else if (v.why === 'expired') on({ waiting: false, error: `The sign-in took too long. Tap Sign in with ${name} to start again.` });
    else if (v.why !== 'declined') on({ waiting: false, error: v.error ?? 'Sign-in failed', ...(v.cause ? { cliLogin: { signIn: v.cause.signIn } } : {}) });
  }

  signIn(account: string, via: 'browser' | 'code' | 'key', told: (step: SignInStep) => void): { paste(text: string): Promise<unknown> | void; cancel(): void; done?: Promise<unknown> } {
    const on = (step: SignInStep) => { if (step.done) { this.listed = undefined; this.acct = undefined; void this.catalog().catch(() => {}); } told(step); }; // read the new catalog while the first run is being set up
    const [provider, label] = refParts(account), name = PROVIDERS[provider]?.name ?? provider;
    if (this.signInRecovery()) {
      let cancelled = false;
      void this.kit.start().then(async () => { if (!cancelled) on({ waiting: false, ...(await this.signedIn(account) ? { done: true } : { error: this.signInRecovery() || 'Please try again.' }) }); })
        .catch(() => { if (!cancelled) on({ waiting: false, error: 'Please try again.' }); });
      return { paste() {}, cancel() { cancelled = true; } };
    }
    const cliOnly = process.env.CREWHOUSE_CODEX_CLI_ONLY === '1' && provider === 'chatgpt', authChoice = cliOnly ? undefined : via === 'code' && provider === 'chatgpt' ? 'openai-device-code' : AUTH_CHOICE[provider];
    if (!authChoice) {
      queueMicrotask(() => on({ waiting: false, error: cliOnly ? 'Sign in to Codex CLI on this computer, then try again.' : `Sign-in for ${name} is not connected yet` }));
      return { paste() {}, cancel() {} };
    }
    if (label) {
      // One more account of the same provider: the kit signs it in on its own agent, so neither account's credentials are touched.
      const why = SECOND[provider] ?? `A second ${name} account isn't supported yet.`;
      if (why || via === 'key') { queueMicrotask(() => on({ waiting: false, error: why || `A second ${name} account needs a sign-in, not a key.` })); return { paste() {}, cancel() {} }; }
      let handle: { paste(t: string): void; cancel(): void } | undefined, cancelled = false;
      const added = this.kit.addAccount(ME, { authChoice, name: label, via }, (v) => { if (v.state === 'waiting') this.view(v, on, name); })
        .then((h) => { handle = h; if (cancelled) h.cancel(); void h.done.then((r) => this.view(r.view, on, name)).catch(() => on({ waiting: false, error: 'Sign-in failed' })); return h; });
      return { paste: (text: string) => void added.then((h) => h.paste(text)), cancel: () => { cancelled = true; void added.then((h) => h.cancel()).catch(() => {}); } };
    }
    if (via === 'key') return this.keyIn(account, authChoice, on);
    return this.kit.signIn(ME, { authChoice, via }, (v) => this.view(v, on, name));
  }

  /** A plan-key account (OpenCode Go): the wizard has no page for it, so the pasted key goes to the kit's own choice;
   *  a login acting for several workspaces names one first (one is used unasked, several wait for the person's pick). */
  keyIn(account: string, authChoice: string, on: (step: SignInStep) => void) {
    const busy = 'Still checking the last key. Wait for it to finish, then paste again.';
    let cancelled = false, key = '', chosen = '', listed: { id: string; name: string }[] = [], pending: { cancel(): void } | undefined;
    const step = ({ status, message }: { status: string; message?: string }): void => void (cancelled || (status === 'ok' ? on({ waiting: false, done: true }) : status === 'not_included' ? on({ waiting: false, notIncluded: true }) : status === 'retry' ? on({ waiting: false, error: message ?? `That didn't go through. Tap Sign in with ${PROVIDERS[account]?.name ?? account} to try again.` }) : on({ waiting: true, error: `That key didn't work. Check it and paste it again.` }))), add = () => { const h = this.kit.addKey(ME, { authChoice, apiKey: key, ...(chosen ? { orgId: chosen } : {}) }); pending = h; this.keyChecks.add(account); const release = () => { if (pending === h) { pending = undefined; this.keyChecks.delete(account); } }; return h.then((r) => { release(); if (cancelled) return; if (r.status === 'needs_workspace') { listed = r.workspaces; on({ waiting: true, workspaces: r.workspaces }); } else step(r); }).catch(() => { release(); step({ status: 'retry' }); }); };
    return {
      paste: (text: string) => { if (this.keyChecks.has(account)) throw new Error(busy); key = text.trim(); chosen = ''; listed = []; if (!cancelled) return add(); },
      pick: (id: string) => { if (this.keyChecks.has(account)) throw new Error(busy); if (!cancelled && listed.some((w) => w.id === id)) { chosen = id; return add(); } },
      cancel: () => { cancelled = true; pending?.cancel(); pending = undefined; this.keyChecks.delete(account); on({ waiting: false, error: 'The sign-in was cancelled.' }); },
    };
  }

  async signOut(account: string) { this.listed = undefined; this.acct = undefined; const [provider, label] = refParts(account), id = label ? await this.idOf(account) : await this.routeOf(provider); if (!id) throw new Error('no such AI account'); if (label) await this.kit.removeAccount(ME, id); else await this.kit.signOut(ME, id); }

  private listed?: Promise<{ models?: any[] }>; // the catalog, read once for the picker, a MiniMax key's default and each run's thinking check (slow under load); a sign-in or sign-out reads it again
  private catalog() { return this.listed ??= this.kit.ensureMember(ME).then(({ agentId }) => this.kit.call('models.list', { agentId, view: 'all' }, { timeoutMs: 20_000 })).catch((e) => { this.listed = undefined; throw e; }); } // 'all' is the kit's account read (default lists nothing)
  /** A plan key (OpenCode Go) offers none: the kit does not yet honour a run's model on a key run, so it runs its saved one. */
  async models(account: string) {
    const [key, label] = refParts(account), second = label ? await this.idOf(account) : undefined;
    if (label) return !second ? [] : (await this.kit.models(ME, second)).map((m) => ({ id: m.id.slice(m.id.indexOf('/') + 1), name: m.name })); // the second account's own list, read with its own sign-in
    const provider = await this.routeOf(key), signed = ['openai-codex', 'minimax'].includes(provider ?? '') && (await this.kit.signedIn(ME, provider!) || !!(await this.kit.providerStatus(ME).catch(() => undefined))?.includes(provider!)), r = await this.catalog(), live = provider === 'openrouter' && await this.kit.signedIn(ME, provider) ? await this.kit.models(ME, { authChoice: 'openrouter-api-key' }).catch(() => []) : []; // an OpenRouter key lists its vendor's live catalog (ids may carry a `:free` tag); the Codex CLI owns its login and a MiniMax key sits outside the catalog's own check, so both read unavailable until signed in
    return (live.length ? live.map((m) => ({ ...m, provider, available: true })) : r.models ?? []).filter((m) => provider !== 'opencode-go' && m.provider === provider && (m.available !== false || signed)).map((m) => ({ id: m.id.replace(`${provider}/`, ''), name: m.name }));
  }
  /** Low thinking goes only to a model whose catalog lists it; MiniMax M3 and Flash list off and adaptive, and refuse off, so they run on their default. */
  private async thinks(provider: string, model: string | undefined, level: string) {
    const levels = (await this.catalog().catch(() => undefined))?.models?.find((m) => m.provider === provider && (model ? m.id.replace(`${provider}/`, '') === model : m.tags?.includes('default')))?.thinkingLevels;
    return !levels || levels.some((l: { id: string }) => l.id === level);
  }
  /** Stage offline through the kit; confirmation removes the verified source without a plaintext archive. */
  async migrate(legacyAuthPath: string) { return await this.kit.migrateRetainedLogin(ME, { path: legacyAuthPath }) === 'staged'; }
  confirm(legacyAuthPath: string) { return this.kit.confirmRetainedLogin(ME, { path: legacyAuthPath }); }

  /** Set the custom OpenAI-compatible provider and primary model (the tests' scripted model). */
  async configureModelProvider(baseUrl: string, apiKey: string, modelRef = 'crewhouse-stub/test') {
    await this.kit.patchConfig({
      models: { providers: { 'crewhouse-stub': {
        baseUrl, apiKey, api: 'openai-completions',
        models: [{ id: 'test', name: 'Test', reasoning: true, input: ['text', 'image'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048,
          compat: { supportsReasoningEffort: true, supportedReasoningEfforts: ['off', 'low', 'medium', 'high'] } }],
      } } },
      agents: { defaults: { model: { primary: modelRef } } },
    });
  }

  async setLearning(on: boolean) { await this.kit.patchConfig({ skills: { workshop: { autonomous: { mode: on ? 'auto' : 'off' } } } }); }

  async run(spec: RunSpec, on: (event: RunEvent) => void): Promise<RunEnd> {
    // The account the person gave this member, by the engine's own id, so two of one provider never mix; a provider they hold
    // one account of stays unnamed, the engine's default pick being the widest (a vendor's model list can lag a model it runs).
    const [word, label] = refParts(spec.account), many = (await this.accounts().catch(() => [])).find((r) => r.provider === word && r.label) !== undefined, aid = label || many ? await this.idOf(spec.account) : undefined, provider = aid ? aid.split('.')[0] : await this.routeOf(word), model = spec.model ?? (provider === 'claude-cli' ? 'claude-opus-5' : provider === 'minimax' ? (await this.catalog().catch(() => undefined))?.models?.find((m) => m.provider === provider && /flash/i.test(m.id))?.id.replace(`${provider}/`, '') : undefined); // the run's own account is the one called and billed; bare Claude runs the CLI's default, never the engine's (ChatGPT's); a plan-key account runs the model the run names, else the kit's saved default
    const keyLane = !!provider && !(await this.kit.providers(ME)).includes(provider) && await this.kit.signedIn(ME, provider), engine = keyLane ? `${provider}.key` : aid; this.runs.set(spec.key, { ...spec, keyLane: keyLane && !spec.key.startsWith('agent:byokit-key-') }); // an account signed in only by its saved key runs on the key lane; a member sign-in wins
    try {
      const lane = keyLane ? `byokit-key-${ME}` : (await this.kit.ensureMember(ME)).agentId;
      if (!this.personas.has(lane)) { for (const [name, content] of [['SOUL.md', 'Follow the persona and job supplied for this session.\n'], ['IDENTITY.md', 'Use the identity supplied for this session.\n']]) await this.kit.call('agents.files.set', { agentId: lane, name, content }); this.personas.add(lane); }
      const helper = /^agent:(?:m1|byokit-key-m1):h-([^:]+):/.exec(spec.key)?.[1];
      if (helper) await this.kit.ensureHelper(ME, helper, { account: engine ?? provider, persona: spec.system });
      const request: KitRunSpec = { sessionKey: helper ? spec.key.replace(/^agent:byokit-key-m1:/, 'agent:m1:') : spec.key, member: ME, message: spec.message, ...(helper ? { helper, account: engine ?? provider } : { system: spec.system, ...(aid ? { account: aid } : {}) }),
        ...(keyLane && !helper ? { auth: 'apiKey' as const } : {}), ...(model && provider ? { model: `${provider}/${model}` } : {}), ...(spec.images?.length ? { images: spec.images } : {}), ...(spec.thinking && await this.thinks(provider, model, spec.thinking) ? { thinking: spec.thinking } : {}) };
      return spec.team ? await this.nativeRun(spec, request, lane, on, aid ?? await this.idOf(spec.account)) : await this.kit.run(request,
        (e) => { if (e.type !== 'account') on(e.type === 'tool' ? { ...e, name: crewName(e.name) } : e); });
    } catch (error) { return { ok: false, kind: 'other', message: String(error) }; }
    finally { this.runs.delete(spec.key); }
  }
  /** Native dispatch owns execution; this adapter only prepares the target's host context and projects its events. */
  private async nativeRun(spec: RunSpec, request: KitRunSpec, lane: string, on: (event: RunEvent) => void, account?: string): Promise<RunEnd> {
    const targets = new Map<string, { bot: string; run?: RunRef }>(), helpers: Record<string, string[]> = {}, texts = new Map<string, string>(), admitted = new Set<string>();
    if (!account) return this.kit.run(request, (e) => { if (e.type !== 'account') on(e.type === 'tool' ? { ...e, name: crewName(e.name) } : e); });
    for (const member of spec.team!) {
      if (member.system.length > 8192) return { ok: false, kind: 'handoff', message: 'A helper’s instructions and notes are too long. Shorten them before handing it this job.' };
      const helper = `b${createHash('sha256').update(member.bot).digest('hex').slice(0, 15)}`, key = `agent:${lane}:h-${helper}:crewhouse:${member.bot}`;
      await this.kit.ensureHelper(ME, helper, { account, persona: member.system });
      const adopted = await this.kit.adoptHelperSession({ member: ME, sessionKey: `agent:${ME}:crewhouse:${member.bot}` }, helper);
      if (!adopted.ok && adopted.code !== 'unsupported') throw new Error(`A helper's earlier conversation could not move: ${adopted.message}`);
      await this.kit.call('sessions.create', { agentId: lane, key, ...(request.model ? { model: request.model } : {}) });
      helpers[helper] = member.tools.map((t) => t === 'bash' ? 'shell' : t).filter((t) => TOOLS.some((spec) => spec.name === t));
      targets.set(key, { bot: member.bot });
    }
    this.targets.set(spec.key, targets); this.legs.set(spec.key, 0);
    let finish!: (end: RunEnd) => void, timer: NodeJS.Timeout | undefined, dispatched = false, running = true, decided: RunEnd | undefined, reported = '';
    const returned = new Promise<RunEnd>((resolve) => { finish = resolve; }), id = randomUUID(), rootKey = spec.key.replace(`agent:${ME}:`, `agent:${lane}:`), decide = (end: RunEnd, release = false) => { if (decided) return; decided = end; finish(end); if (release && running) void this.abort(spec.key).catch(() => {}); }; // one outcome for the hand-off: the first one wins, and a hand-off that ends on its own lets Chief's lane go, so a report that never comes cannot hold it
    const offChild = this.kit.onEvent('byokit.delegated', (e) => {
      if (e.run.root.sessionKey !== rootKey || e.run.root.runId !== id) return;
      const target = targets.get(e.run.sessionKey), run = target ? target.run : this.runs.get(spec.key); // a spawned lookup has no job of its own: it is Chief's
      if (!run) return;
      if (e.type === 'admitted') { clearTimeout(timer); dispatched = true; admitted.add(e.run.runId); this.host?.event?.(run, { type: 'delegated', id: e.run.runId, parent: e.run.parent.runId, root: id }); }
      if (target && e.event?.stream === 'assistant' && typeof e.event.data?.text === 'string') { texts.set(e.run.runId, e.event.data.text); this.host?.event?.(run, { type: 'text', text: e.event.data.text }); }
      if (e.type === 'ended') {
        admitted.delete(e.run.runId);
        if (target) { const said = texts.get(e.run.runId) ?? ''; this.host?.end?.(run, e.reason === 'terminal' ? { ok: true, text: said } : { ok: false, kind: 'other', message: e.message || 'The helper stopped before its result could be confirmed.' }); this.runs.delete(e.run.sessionKey); target.run = undefined; if (e.reason !== 'terminal') return decide({ ok: false, kind: 'handoff', message: 'The helper stopped before reporting back. Check its job before trying again.' }, true); reported = said; }
        if (!admitted.size) timer = setTimeout(() => decide(reported ? { ok: true, text: reported } : { ok: false, kind: 'handoff', message: target ? 'The helper finished, but Chief did not get its report. Check the helper’s chat.' : 'The lookups finished, but Chief did not get their reports. Try again.' }, true), HANDOFF_MS());
      }
    });
    const offReturn = this.kit.onEvent('agent', (e) => {
      if (!dispatched || !('sessionKey' in e) || e.sessionKey !== rootKey || e.runId === id) return; // display only; the kit admits every tool call by exact run identity
      // The report comes back in a turn of its own on the same session: that turn is Chief's again, so the run may
      // work. The turn that handed the job on ends first, and the turn that carries the report starts after it.
      if (e.stream === 'lifecycle' && (e.data?.phase === 'start' || e.data?.phase === 'end')) this.waits.delete(spec.key);
      if (e.stream === 'assistant' && typeof e.data?.text === 'string') on({ type: 'text', text: e.data.text });
      if (e.stream === 'lifecycle' && e.data?.phase === 'end' && !admitted.size && ![...targets.values()].some((t) => t.run)) {
        const reply = e.data.terminalReply as { disposition?: string; text?: string } | undefined;
        decide(e.data.aborted ? { ok: false, aborted: true } : { ok: true, text: reply?.disposition === 'visible' ? reply.text ?? '' : '' });
      }
    });
    try {
      const end = await this.kit.run({ ...request, idempotencyKey: id, delegates: { [lane]: [] }, helperDelegates: helpers, system: `${spec.system}${targets.size ? `\nNative hand-off: use sessions_send once with an exact sessionKey below, message with the job and done means, timeoutSeconds: 0. The helper then has the job: its report arrives in your next turn, and you answer the person from it there. End this turn after the hand-off; do not send it again and do not go looking for the helper's files.\n${[...targets].map(([key, t]) => `${t.bot}: ${key}`).join('\n')}` : ''}\nLegwork: for plain web lookups, call sessions_spawn with agentId "${lane}", task (one thing to look up and what to report) and label, up to ${MAX_LEGS} in a job. Each only reads the web and reports back. Then call sessions_yield with how to answer (tone, format) and answer when the reports arrive, never in their place.` }, (e) => {
        if (e.type !== 'account') on(e.type === 'tool' ? { ...e, name: crewName(e.name) } : e);
        if (e.type === 'tool' && e.name === 'sessions_send' && e.phase === 'end' && e.error) for (const [key, t] of targets) if (t.run && ![...this.kit.delegatedRuns()].some((r) => r.sessionKey === key)) { this.host?.end?.(t.run, { ok: false, kind: 'handoff', message: 'The job could not be handed to the helper. Try again.' }); this.runs.delete(key); t.run = undefined; this.waits.delete(spec.key); }
      });
      running = false; if (decided) return decided; return end.ok && dispatched ? await returned : end;
    } finally {
      clearTimeout(timer); offChild(); offReturn(); this.targets.delete(spec.key); this.legs.delete(spec.key); this.waits.delete(spec.key); if (admitted.size) await this.abort(spec.key).catch(() => {});
      for (const [key, t] of targets) if (t.run) { await this.kit.abort(key); this.host?.end?.(t.run, { ok: false, kind: 'handoff', message: 'The hand-off stopped before its result was confirmed.' }); this.runs.delete(key); }
    }
  }
  steer(key: string, text: string) { return this.kit.steer(key, text, this.runs.get(key)?.keyLane ? { auth: 'apiKey' as const } : undefined); }
  abort(key: string) { return this.kit.abort(key, this.runs.get(key)?.keyLane ? { auth: 'apiKey' as const } : undefined); }
  /** The Workshop's skills on every lane that learns them: the member agent and, once a plan key made it, its key agent
   *  (`byokit-key-<member>`, the kit's README). Each lane's installed skills (`<state>/agents/<agent>/agent/workshop-skills`)
   *  that are still switched on, named by the proposal that made them when there is one, and its pending proposals. Newest first. */
  private async proposals() {
    const { agentId } = await this.kit.ensureMember(ME), timeoutMs = 20_000, roster = await this.kit.call('agents.list', {}, { timeoutMs }).catch(() => undefined), lanes = (roster?.agents ?? []).map((a) => a.id).filter((id) => id === agentId || id === `byokit-key-${ME}`);
    const rows = (await Promise.all(lanes.map(async (lane) => {
      const [list, status] = await Promise.all(['skills.proposals.list', 'skills.status'].map((m) => (this.kit.call as any)(m, { agentId: lane }, { timeoutMs }).catch(() => undefined))) as any[], off = new Set((status?.skills ?? []).filter((k: any) => k.disabled).map((k: any) => k.skillKey));
      const made = (list?.proposals ?? []).map((p: any) => ({ id: String(p.id ?? ''), skill: String(p.skillName ?? p.title ?? ''), key: String(p.skillKey ?? ''), at: Date.parse(p.updatedAt ?? p.createdAt ?? '') || 0, state: String(p.status), lane }));
      return [...made.filter((p: any) => p.state === 'pending'), ...(list?.installedSkills ?? []).filter((k: any) => !off.has(k.skillKey))
        .map((k: any) => made.find((p: any) => p.state === 'applied' && p.key === k.skillKey) ?? { id: String(k.skillKey), skill: String(k.name), key: String(k.skillKey), at: 0, state: 'applied', lane })];
    }))).flat() as { id: string; skill: string; key: string; at: number; state: string; lane: string }[]; return rows.filter((p) => p.id && p.key).sort((a, b) => b.at - a.at);
  }
  /** What the person sees learned: one row per skill name, whichever lane learned it; the newest copy wins. */
  composioBegin() { return this.kit.beginComposioSignIn(); }
  composioDone() { return this.kit.completeComposioSignIn(); }
  composioSignOut() { return this.kit.signOutComposio(); }
  async learned() { const rows = await this.proposals(); return rows.filter((p, i) => rows.findIndex((q) => q.skill === p.skill) === i).map(({ id, skill, at, state }) => ({ id, skill, at, state })); }

  /** The member lane's learned-skills folder, and a lane's pre-change capture: crewhouse's own git versioning. A
   *  capture that cannot be verified throws, and the caller must refuse the change — the data stays. */
  workspaceOf() { return join(this.stateDir, 'openclaw/workspaces', ME, 'skills'); }
  captureLearned(dir = this.workspaceOf(), why = 'Before the skill collection review'): string {
    if (!existsSync(join(dir, '.git'))) mkdirSync(dir, { recursive: true });
    const hash = commit(dir, ['.'], why, true);
    if (!hash) throw new Error('the learned-skills capture failed; nothing was changed');
    return hash;
  }
  /** Bring one learned skill back from the capture history, byte for byte (`<name>/SKILL.md` directly under the skills root).
   *  The capture is read before anything is written: a restore that cannot be verified throws and leaves the workspace untouched. */
  restoreLearned(name: string, hash?: string, dir = this.workspaceOf()) {
    const git = (argv: string[]) => execFileSync('git', ['-c', 'user.name=Crewhouse', '-c', 'user.email=crewhouse@localhost', ...argv], { cwd: dir, stdio: 'pipe' }), at = (hash ?? git(['rev-parse', '--short', 'HEAD'])).toString().trim();
    let body: Buffer;
    try { body = git(['show', `${at}:${name}/SKILL.md`]); }
    catch { throw new Error(`no learned-skill capture holds "${name}"; nothing was restored`); }
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), body);
    commit(dir, ['.'], `Restored ${name} from ${at}`);
    return at;
  }

  /** The workshop window for the person's own collection review: its reconcile only, one call wide. The engine mints
   *  the reviewer's session key fresh per run (`incognito-<uuid>`), so the first qualifying call is the captured one. */
  armCuration(ms = 10 * 60_000) {
    this.kit.allowOnce({ keyPrefix: `agent:${ME}:skill-collection-review:`, tool: 'skill_workshop', input: (i) => i.action === 'reconcile' }, ms);
  }

  /** The collection review, on crewhouse's own boundary: capture first (refusing everything on failure), open the
   *  workshop window only for the person's own reviewer and its reconcile — one call wide — run the review, close
   *  it, and report kept/rewritten/dropped. */
  async runCollectionReview() {
    const capture = this.captureLearned(), jobs = await this.kit.call('cron.list', { limit: 100 }, { timeoutMs: 20_000 }) as { jobs?: { id: string; name: string; enabled: boolean }[] }, job = jobs.jobs?.find((j) => j.name === `skill-collection-review-${ME}`);
    if (!job?.enabled) throw new Error('the collection review is not enabled');
    this.armCuration();
    try {
      const kicked = await this.kit.call('cron.run', { id: job.id, mode: 'force' } as { id: string }, { timeoutMs: 30_000 }) as { runId?: string };
      for (const end = Date.now() + 240_000; Date.now() < end;) {
        await sleep(2000);
        const runs = await this.kit.call('cron.runs', { id: job.id }, { timeoutMs: 20_000 }).catch(() => undefined) as { entries?: { runId: string; status: string }[] } | undefined;
        if (runs?.entries?.some((e) => e.runId === kicked.runId && e.status === 'ok')) break;
      }
      const curator = await this.kit.call('skills.curator.status', {}, { timeoutMs: 20_000 }).catch(() => undefined) as any, outcome = curator?.collectionReview ?? {}, names = (v: any) => Array.isArray(v) ? v.map((x: any) => x?.name ?? x?.skill ?? x).filter(Boolean) : [];
      return { capture, kept: names(outcome.kept), written: names(outcome.written), dropped: names(outcome.dropped) };
    } finally { this.kit.disallowOnce(); }
  }

  /** The reviewed ClawHub starter set (starter-skills.json), with whether the engine already holds each; installs go through its own gate. */
  starterSkills() {
    return (JSON.parse(readFileSync(join(appDir, 'src/starter-skills.json'), 'utf8')).approved as any[]).map((s) => ({ slug: String(s.slug), name: String(s.name ?? s.slug), owner: String(s.owner), version: String(s.version), maturity: String(s.maturity),
      summary: String(s.summary), why: String(s.why), needs: (s.needs ?? []).map(String),
      on: existsSync(join(this.workspaceOf(), String(s.slug))) }));
  }
  /** Switch one starter skill the engine's own way (install through the trust gate, or disable); anything outside the reviewed set is refused. */
  async setStarter(slug: string, on: boolean) {
    const found = this.starterSkills().find((s) => s.slug === slug);
    if (!found) throw new Error(`“${slug}” is not one of the reviewed starter skills, so the crew leaves it alone.`);
    const { agentId } = await this.kit.ensureMember(ME);
    if (on) await this.kit.call('skills.install', { agentId, source: 'clawhub', slug: `@${found.owner}/${found.slug}`, version: found.version }, { timeoutMs: 120_000 });
    else await this.kit.call('skills.update', { skillKey: found.slug, enabled: false }, { timeoutMs: 60_000 });
  }
  /** Search the public skill and plugin catalogs the engine's own way (empty while it starts); a plugin only ever shows as not reviewed. */
  async searchSkills(query: string) {
    const [r, p] = await Promise.all([this.kit.call('skills.search', { query, limit: 10 }, { timeoutMs: 30_000 }).catch(() => undefined) as any, this.kit.call('plugins.search', { query, limit: 10 }, { timeoutMs: 30_000 }).catch(() => undefined)]), items = Array.isArray(r?.items) ? r.items : Array.isArray(r?.results) ? r.results : [], starter = this.starterSkills();
    // Reviewed means this publisher's skill: another owner's skill of the same name is not the one that was read.
    return [...items.slice(0, 10).map((i: any) => ({ slug: String(i.slug ?? ''), owner: String(i.ownerHandle ?? i.owner ?? ''), summary: String(i.summary ?? i.description ?? ''), version: String(i.version ?? i.latestVersion ?? '') }))
      .map((i: any) => ({ ...i, reviewed: starter.some((s) => s.slug === i.slug && s.owner === i.owner), on: starter.some((s) => s.on && s.slug === i.slug && s.owner === i.owner) })),
    ...(p?.results ?? []).map((i) => ({ slug: i.package.name, name: i.package.displayName, kind: 'plugin', summary: i.package.summary ?? '', version: i.package.latestVersion ?? '', reviewed: false, on: false }))].filter((i: any) => i.slug);
  }
  /** Forget one learned skill on every lane that holds it: a pending proposal is rejected, an installed one is switched off
   *  the engine's own way (`skills.entries.<key>.enabled: false`); its files stay, and switching it on again brings it back. */
  async forget(id: string, skill = '') {
    const rows = await this.proposals(), name = rows.find((p) => p.id === id)?.skill ?? skill, copies = rows.filter((p) => p.id === id || (name && p.skill === name)), timeoutMs = 20_000;
    if (!copies.length) throw Object.assign(new Error(`"${skill || id}" is no longer a learned skill; nothing was forgotten`), { status: 404 });
    for (const p of copies) {
      const at = { agentId: p.lane, proposalId: p.id };
      if (p.state === 'pending') await this.kit.call('skills.proposals.reject', { ...at, expectedRevisionHash: (await this.kit.call('skills.proposals.inspect', at, { timeoutMs })).revisionHash ?? '' }, { timeoutMs });
      else await this.kit.call('skills.update', { skillKey: p.key, enabled: false }, { timeoutMs });
    }
  }
}
